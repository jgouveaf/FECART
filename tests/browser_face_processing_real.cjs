'use strict';
// Real models compare the existing WebGL descriptors with the new local worker.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const path = require('node:path');
const site = process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
const source = fs.readFileSync(path.join(__dirname, '../web/face-identities.js'), 'utf8');
const config = /const humanConfig = (\{[\s\S]+?\n  \});/.exec(source)[1];
const fixture = /V0=`([^`]+)`/.exec(fs.readFileSync(path.join(__dirname, '../web/vendor/human/human.js'), 'utf8'))[1];
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const external = [], errors = [], unusedModels = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/\.wasm|models\//.test(r.url()) && new URL(r.url()).origin !== new URL(site).origin) external.push(r.url()); });
    page.on('request', r => { if (/models\/(iris|antispoof|liveness)\./.test(r.url())) unusedModels.push(r.url()); });
    await page.route('**/__profile.jpg', r => r.fulfill({ contentType: 'image/jpeg', body: Buffer.from(fixture, 'base64') }));
    await page.goto(site, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ url: new URL('web/vendor/human/human.js?v=3.3.6', site).href });
    const result = await page.evaluate(async configText => {
      const img = new Image(); img.src = new URL('__profile.jpg', document.baseURI).href; await img.decode();
      const surface = document.createElement('canvas'); surface.width = 1280; surface.height = 720;
      const ctx = surface.getContext('2d'); ctx.fillStyle = '#273546'; ctx.fillRect(0, 0, 1280, 720); ctx.drawImage(img, 360, 80, 560, 560);
      const cfg = Function('MODEL_URL', 'return (' + configText + ')')(new URL('web/vendor/human/models/', document.baseURI).href);
      const human = new Human.Human(cfg); await human.load(); await human.warmup();
      const old = await human.detect(surface);
      const client = new QuantumFaceInference.FaceInferenceClient(); await client.load(cfg);
      try {
        const enrollment = QuantumFaceProcessing.plan({ width: 1280, height: 720, modeTwo: true, enrolling: true });
        const tracking = QuantumFaceProcessing.plan({ width: 1280, height: 720, modeTwo: true, enrolling: false });
        const first = await client.detect(surface, enrollment.config);
        const followed = await client.detect(surface, tracking.config);
        const again = await client.detect(surface, enrollment.config);
        const match = r => human.match.similarity(old.face[0].embedding, r.face[0].embedding, { order: 2, multiplier: 25, min: .2, max: .8 });
        return { backend: followed.backend, firstSimilarity: match(first), trackingSimilarity: match(followed),
          restoredSimilarity: match(again), points: followed.face[0].mesh.length, embedding: followed.face[0].embedding.length,
          enrollmentConfidence: again.face[0].faceScore,
          faceBox: QuantumFaceProcessing.restore(followed.face[0], tracking.scaleX, tracking.scaleY).box, referenceBox: old.face[0].box };
      } finally { client.close(); }
    }, config);
    assert.equal(result.backend, 'wasm'); assert.equal(result.embedding, 1024); assert.ok(result.points >= 468);
    assert.ok(result.firstSimilarity >= .8 && result.trackingSimilarity >= .8 && result.restoredSimilarity >= .8, JSON.stringify(result));
    assert.ok(result.enrollmentConfidence >= .58); assert.deepEqual(unusedModels, []);
    assert.ok(result.faceBox.every((v, i) => Math.abs(v - result.referenceBox[i]) < 40), 'Projection remains aligned at camera resolution');
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    console.log('PASS - real descriptor compatibility and enrollment restoration', JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
