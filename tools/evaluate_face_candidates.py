"""Offline candidate evaluation on bundled public fixtures, never user biometrics.

Prepare with a Python that has cv2 + ultralytics. Run each candidate in its own
interpreter. Results are a tiny controlled probe, NOT population accuracy.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import statistics
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'work' / 'face-evaluation'

def prepare():
    import cv2
    import numpy as np
    OUT.mkdir(parents=True, exist_ok=True)
    runtime = (ROOT / 'web/vendor/human/human.js').read_text(encoding='utf-8')
    warmup = base64.b64decode(re.search(r'V0=`([^`]+)`', runtime)[1])
    asset = Path(importlib.util.find_spec('ultralytics').origin).parent / 'assets/zidane.jpg'
    data = asset.read_bytes()
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    # Visually verified regions in the bundled 1280x720 image, not detector labels.
    crops = {'A': cv2.imdecode(np.frombuffer(warmup, np.uint8), cv2.IMREAD_COLOR),
             'B': image[30:335, 870:1130], 'C': image[175:460, 450:705]}
    cases = []
    def save(name, frame, identity, condition, reference=False):
        encoded = cv2.imencode('.png', frame)[1].tobytes()
        (OUT / (name + '.png')).write_bytes(encoded)
        cases.append(dict(file=name + '.png', identity=identity, condition=condition,
                          reference=reference, sha256=hashlib.sha256(encoded).hexdigest()))
    for identity, crop in crops.items():
        normalized = cv2.resize(crop, (256, 256))
        for condition in ['reference', 'repeat', 'dim', 'rotate10', 'small', 'covered']:
            face = normalized.copy()
            if condition == 'dim': face = np.clip(face.astype(float) * .60, 0, 255).astype(np.uint8)
            if condition == 'rotate10':
                face = cv2.warpAffine(face, cv2.getRotationMatrix2D((128, 128), 10, 1), (256, 256), borderMode=cv2.BORDER_REFLECT)
            if condition == 'covered': face[155:] = (35, 35, 35)
            size = 128 if condition == 'small' else 256
            frame = np.full((360, 640, 3), (70, 53, 39), np.uint8)
            left, top = (640-size)//2, (360-size)//2
            frame[top:top+size, left:left+size] = cv2.resize(face, (size,size))
            save(identity + '-' + condition, frame, identity, condition, condition == 'reference')
    save('empty', np.full((360,640,3), (70,53,39), np.uint8), None, 'empty')
    multi = np.full((360,640,3), (70,53,39), np.uint8)
    for x, identity in [(40,'A'), (360,'B')]: multi[65:295,x:x+230] = cv2.resize(crops[identity], (230,230))
    save('multiple', multi, None, 'multiple')
    manifest = {'version':1, 'imageSize':[640,360], 'sourceHashes':{
        'humanWarmup':hashlib.sha256(warmup).hexdigest(), 'ultralyticsZidane':hashlib.sha256(data).hexdigest()},
        'cases':cases, 'limitations':'Three source identities; query variants reuse each original photo. No accuracy estimate, back-facing continuity or physical robot test.'}
    (OUT / 'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'prepared':len(cases),'output':str(OUT)}),flush=True)

def run(engine):
    import cv2
    import numpy as np
    cv2.setNumThreads(2)
    os.environ['DEEPFACE_HOME'] = str(OUT)
    os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
    os.environ['OMP_NUM_THREADS'] = '2'
    os.environ['TF_NUM_INTRAOP_THREADS'] = '2'
    os.environ['TF_NUM_INTEROP_THREADS'] = '2'
    manifest = json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    started = time.perf_counter()
    if engine == 'deepface-yunet':
        from deepface import DeepFace
        from deepface.modules.verification import find_threshold
        detector = 'yunet'
        DeepFace.build_model('SFace')
        DeepFace.build_model(detector, task='face_detector')
        threshold = 1 - find_threshold('SFace','cosine')
        version = importlib.metadata.version('deepface')
        def infer(frame):
            try:
                items = DeepFace.represent(frame, model_name='SFace', detector_backend=detector,
                    enforce_detection=True, align=True, normalization='base', anti_spoofing=False)
                return [np.asarray(item['embedding'],dtype=np.float32) for item in items]
            except ValueError as error:
                if 'Face could not be detected' in str(error): return []
                raise
    elif engine == 'insightface':
        from insightface.app import FaceAnalysis
        app = FaceAnalysis(name='buffalo_l', root=str(ROOT/'assets/insightface_models'),
                           providers=['CPUExecutionProvider'], allowed_modules=['detection','recognition'])
        app.prepare(ctx_id=-1,det_size=(320,320))
        threshold = .42
        version = importlib.metadata.version('insightface')
        def infer(frame): return [face.embedding for face in app.get(frame)]
    else: raise ValueError(engine)
    init_ms = (time.perf_counter()-started)*1000
    images = [cv2.imdecode(np.frombuffer((OUT/c['file']).read_bytes(),np.uint8),cv2.IMREAD_COLOR) for c in manifest['cases']]
    t = time.perf_counter()
    infer(images[0]) # one warmup; excluded from per-frame timings
    warmup_ms = (time.perf_counter()-t)*1000
    references, rows = {}, []
    for case, frame in zip(manifest['cases'],images):
        t = time.perf_counter(); embeddings = infer(frame); ms = (time.perf_counter()-t)*1000
        valid = [e/np.linalg.norm(e) for e in embeddings if np.isfinite(e).all() and np.linalg.norm(e)>0]
        if case['reference'] and len(valid)==1: references[case['identity']] = valid[0]
        row = {**case, 'faces':len(valid),'ms':round(ms,2),'embeddingLength':len(valid[0]) if valid else 0}
        row['_embeddings'] = valid; rows.append(row)
        print(f"{engine}: {case['file']}: {len(valid)} faces, {ms:.1f} ms",flush=True)
    for row in rows:
        vectors = row.pop('_embeddings'); scores = sorted(
            [(key,float(vectors[0] @ ref)) for key,ref in references.items()],key=lambda s:s[1],reverse=True) if len(vectors)==1 else []
        row['predicted'] = scores[0][0] if scores and scores[0][1]>=threshold else None
        row['scores'] = scores
    report = {'engine':engine, 'version':version,'initMs':round(init_ms,2), 'warmupMs':round(warmup_ms,2),
              'opencv':cv2.__version__, 'timing':'One sequential pass of 20 images, after one warmup; includes detection and embedding.',
              'thresholdCosineSimilarity':threshold,
              'references':list(references), 'rows':rows,'notes':manifest['limitations']}
    (OUT/(engine+'.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('RESULT',json.dumps({'engine':engine,'initMs':round(init_ms,2),'cases':len(rows)}),flush=True)

def summarize():
    manifest = json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    names = ['human-worker', 'deepface-yunet', 'insightface']
    reports = [json.loads((OUT/(name+'.json')).read_text(encoding='utf-8')) for name in names]
    # Compare latency on identical inputs that yielded one descriptor in all engines.
    common = set.intersection(*[{r['file'] for r in d['rows'] if r['faces']==1 and r['embeddingLength']>0} for d in reports])
    if not common: raise ValueError('No common single-face inputs for latency comparison')
    results = []
    for report in reports:
        rows = report['rows']
        if [r['sha256'] for r in rows] != [c['sha256'] for c in manifest['cases']]:
            raise ValueError('Fixtures changed between engines; rerun all candidates')
        queries = [r for r in rows if r['identity'] and not r['reference']]
        results.append({
            'engine':report['engine'], 'version':report['version'], 'initMs':report['initMs'],
            'warmupMs':report['warmupMs'], 'commonSingleFaceMedianMs':round(statistics.median(r['ms'] for r in rows if r['file'] in common),2),
            'detectedSingleFaceCases':sum(r['faces']==1 for r in rows if r['identity']),
            'singleFaceCases':sum(bool(r['identity']) for r in rows),
            'correctQueries':sum(r['predicted']==r['identity'] for r in queries),
            'wrongIdentityQueries':sum(bool(r['predicted'] and r['predicted']!=r['identity']) for r in queries),
            'queries':len(queries), 'referenceIdentities':report['references'],
            'emptySceneFaces':next(r['faces'] for r in rows if r['condition']=='empty'),
            'multipleSceneFaces':next(r['faces'] for r in rows if r['condition']=='multiple'),
            'rows':[{k:r[k] for k in ['file','condition','faces','embeddingLength','ms','predicted']} for r in rows],
        })
    summary = {'fixtures':len(manifest['cases']), 'commonLatencyCases':sorted(common),
        'limitations':manifest['limitations'], 'sourceHashes':manifest['sourceHashes'], 'results':results}
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps({**summary,'results':[{k:v for k,v in r.items() if k!='rows'} for r in results]},indent=2))

if __name__=='__main__':
    # DeepFace logs emoji during weight downloads; Windows pipes may use cp1252.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(); parser.add_argument('action',choices=['prepare','deepface-yunet','insightface','summarize'])
    args=parser.parse_args()
    if args.action=='prepare': prepare()
    elif args.action=='summarize': summarize()
    else: run(args.action)
