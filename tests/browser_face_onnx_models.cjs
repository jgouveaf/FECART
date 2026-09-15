'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const site=process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/__onnx.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><script src="web/face-inference-client.js"></script><script src="web/face-onnx-math.js"></script>'}));
    const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../work/face-evaluation/manifest.json'),'utf8'));
    for (const c of manifest.cases) await page.route('**/__eval/'+c.file,r=>r.fulfill({contentType:'image/png',path:path.join(__dirname,'../work/face-evaluation',c.file)}));
    await page.goto(new URL('__onnx.html',site).href);
    page.on('console',m=>{if(m.text().startsWith('MODEL ')) console.log(m.text());});
    const report=await page.evaluate(async cases=>{
      const client=new QuantumFaceInference.FaceInferenceClient(),rows=[],refs={};
      try {
        const start=performance.now();await client.load({identityEngine:QuantumFaceONNXMath.ENGINE}); const initMs=performance.now()-start;
        for (const c of cases) {
          const img=new Image();img.src='__eval/'+c.file;await img.decode();
          const t=performance.now(),r=await client.detect(img,{filter:{width:640,height:360}}),ms=performance.now()-t;
          if(c.reference && r.face.length===1) refs[c.identity]=r.face[0].embedding;
          rows.push({...c,ms,faces:r.face.length,embedding:r.face[0]?.embedding,box:r.face[0]?.box,meshPoints:r.face[0]?.mesh?.length || 0});
          console.log('MODEL '+c.file+': '+r.face.length+' faces, '+Math.round(ms)+' ms');
        }
        for(const row of rows) {
          row.scores=row.embedding ? Object.entries(refs).map(([id,ref])=>[id,QuantumFaceONNXMath.cosine(row.embedding,ref)]) : [];
          row.embeddingLength=row.embedding?.length || 0;delete row.embedding;
        }
        const fast=[];
        for(const id of ['A','B','C']) {
          const img=new Image();img.src='__eval/'+id+'-reference.png';await img.decode();
          const cfg={identityFirst:true,allowDescriptorReuse:true,filter:{width:640,height:360}};
          const changed=await client.detect(img,cfg);
          if(changed.face[0]?.embeddingReused) throw Error('A different real face reused the preceding descriptor');
          const repeated=await client.detect(img,cfg);
          fast.push({id,reused:repeated.face[0]?.embeddingReused===true,
            self:QuantumFaceONNXMath.cosine(changed.face[0]?.embedding,repeated.face[0]?.embedding)});
        }
        return {initMs,rows,fast};
      } finally {client.close();}
    },manifest.cases);
    fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'artifacts/face-onnx-models.json'),JSON.stringify(report,null,2));
    for (const id of ['A','B','C']) {
      const ref=report.rows.find(r=>r.file===id+'-reference.png');
      assert.equal(ref.faces,1,id+' reference detected');assert.equal(ref.embeddingLength,128);
      const repeat=report.rows.find(r=>r.file===id+'-repeat.png');
      assert.ok(repeat.scores.find(s=>s[0]===id)[1]>.99);
      assert.ok(repeat.scores.filter(s=>s[0]!==id).every(s=>s[1]<.5));
    }
    assert.equal(report.rows.find(r=>r.condition==='empty').faces,0);
    assert.ok(report.rows.find(r=>r.file==='A-reference.png').meshPoints>=468);
    assert.equal(report.rows.find(r=>r.condition==='multiple').faces,2);
    assert.ok(report.fast.every(row=>row.self>.99),'Fast path and full inference agree for the same reference');
    console.log('PASS - real SCRFD/SFace in browser: frontal/profile identities, repeat, empty and multiple scenes');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
