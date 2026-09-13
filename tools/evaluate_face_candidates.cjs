'use strict';
// Same fixture manifest as the Python probe. No camera, USB or user database.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'work/face-evaluation');
const site = process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'web/face-identities.js'), 'utf8');
const config = /const humanConfig = (\{[\s\S]+?\n  \});/.exec(source)[1];
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.text().startsWith('EVAL ')) console.log(msg.text()); });
    await page.route('**/__evaluation.html', route => route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><meta charset="utf-8"><script src="web/vendor/human/human.js"></script><script src="web/face-inference-client.js"></script>' }));
    for (const item of manifest.cases) {
      await page.route('**/__eval/' + item.file, route => route.fulfill({ contentType: 'image/png', path: path.join(out, item.file) }));
    }
    await page.goto(new URL('__evaluation.html', site).href);
    const result = await page.evaluate(async ({ manifest, config }) => {
      const MODEL_URL = new URL('web/vendor/human/models/', document.baseURI).href;
      const cfg = Function('MODEL_URL', 'return ' + config)(MODEL_URL);
      // Independent images: never reuse a descriptor from the preceding person.
      cfg.cacheSensitivity = 0;
      Object.assign(cfg.face.detector, { skipFrames: 0, skipTime: 0 });
      Object.assign(cfg.face.description, { skipFrames: 0, skipTime: 0 });
      const human = new Human.Human(cfg);
      const client = new QuantumFaceInference.FaceInferenceClient();
      const frameConfig = { filter: { width: 640, height: 360, return: false } };
      const start = performance.now();
      await client.load(cfg);
      const initMs = performance.now() - start;
      const images = await Promise.all(manifest.cases.map(async c => {
        const image = new Image(); image.src = '__eval/' + c.file; await image.decode(); return image;
      }));
      const warmupAt = performance.now(); await client.detect(images[0], frameConfig);
      const warmupMs = performance.now() - warmupAt;
      const rows = [], references = {};
      try {
        for (let i = 0; i < images.length; i++) {
          const started = performance.now(), result = await client.detect(images[i], frameConfig);
          const ms = performance.now() - started;
          const vectors = result.face.map(f => f.embedding).filter(e => e?.length && e.every(Number.isFinite));
          const c = manifest.cases[i];
          if (c.reference && vectors.length === 1) references[c.identity] = vectors[0];
          rows.push({ ...c, faces: result.face.length, embeddings: vectors.length, ms, backend: result.backend,
            embeddingLength: vectors[0]?.length || 0, _embeddings: vectors });
          console.log('EVAL ' + c.file + ': ' + result.face.length + ' faces, ' + ms.toFixed(1) + ' ms');
        }
        for (const row of rows) {
          const vectors = row._embeddings; delete row._embeddings;
          row.scores = vectors.length === 1 ? Object.entries(references).map(([id, ref]) =>
            [id, human.match.similarity(vectors[0], ref, { order: 2, multiplier: 25, min: .2, max: .8 })])
            .sort((a, b) => b[1] - a[1]) : [];
          row.predicted = row.faces === 1 && row.scores[0]?.[1] >= .8 &&
            row.scores[0][1] - (row.scores[1]?.[1] || 0) >= .05 ? row.scores[0][0] : null;
        }
        return { engine: 'human-worker', version: human.version, initMs, warmupMs,
          thresholdHumanSimilarity: .8, margin: .05, references: Object.keys(references), rows,
          timing: 'One sequential pass after warmup; includes bitmap transfer, worker detection, mesh and embedding. Descriptor reuse disabled.',
          notes: manifest.limitations };
      } finally { client.close(); }
    }, { manifest, config });
    if (errors.length) throw Error(errors.join('\n'));
    result.browser = browser.version();
    fs.writeFileSync(path.join(out, 'human-worker.json'), JSON.stringify(result, null, 2));
    console.log('RESULT ' + JSON.stringify({ engine: result.engine, initMs: result.initMs, cases: result.rows.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
