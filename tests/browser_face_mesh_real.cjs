'use strict';
// Human's bundled warmup image, real local models and application renderer.
// Verifies landmark drawing and direct enrollment, without an anti-photo challenge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const site = process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
const runtime = fs.readFileSync(path.join(__dirname, '../web/vendor/human/human.js'), 'utf8');
const fixture = /V0=`([^`]+)`/.exec(runtime);
assert.ok(fixture, 'Human 3.3.6 bundled face warmup fixture is available');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__face_warmup.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(fixture[1], 'base64') }));
    await page.addInitScript(() => {
      localStorage.setItem('quantumAuth:v1', 'ok');
      const mediaDevices = new EventTarget();
      mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'fixture', label: 'Local model fixture' }];
      mediaDevices.getUserMedia = async () => {
        const source = document.createElement('canvas'); source.width = 640; source.height = 480;
        const ctx = source.getContext('2d'); const image = new Image();
        image.src = new URL('__face_warmup.jpg', location.href).href; await image.decode();
        const render = () => { ctx.fillStyle = '#101c30'; ctx.fillRect(0, 0, 640, 480); ctx.drawImage(image, 110, 30, 420, 420); };
        render(); const timer = setInterval(render, 100);
        const stream = source.captureStream(10), track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
        return stream;
      };
      Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices });
    });
    await page.goto(site, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ url: new URL('web/vendor/human/human.js?v=3.3.6', site).href });
    await page.evaluate(() => {
      const original = window.QuantumFaceMesh.draw;
      window.QuantumFaceMesh = { draw(ctx, faces, triangles, w, h) {
        window.__meshModel = { points: faces[0]?.mesh?.length || 0, indices: triangles?.length || 0 };
        original(ctx, faces, triangles, w, h);
      } };
      return window.quantumCameraController.start();
    });
    await page.waitForFunction(() => window.__meshModel?.points >= 468, null, { timeout: 120000 });
    const result = await page.evaluate(() => {
      const c = document.getElementById('identityCanvas');
      return { ...window.__meshModel, visible: !c.hidden, pixels: c.getContext('2d').getImageData(0, 0, c.width, c.height).data.filter((v, i) => i % 4 === 3 && v > 0).length };
    });
    assert.ok(result.indices > 1000 && result.indices % 3 === 0);
    assert.ok(result.pixels > 1000); assert.equal(result.visible, true); assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
    await page.locator('.camera-stage').screenshot({ path: path.join(__dirname, 'artifacts/face-mesh-real.png') });
    await page.locator('#personName').fill('Fixture cadastro direto');
    await page.waitForFunction(() => !document.getElementById('registerPerson').disabled, null, { timeout: 60000 });
    await page.evaluate(() => {
      const progress = document.getElementById('sampleProgress');
      window.__capturedSamples = 0;
      new MutationObserver(() => {
        window.__capturedSamples = Math.max(window.__capturedSamples, parseInt(progress.textContent, 10) || 0);
      }).observe(progress, { childList: true });
    });
    await page.locator('#registerPerson').click();
    await page.waitForFunction(() => document.querySelectorAll('.person-card').length === 1, null, { timeout: 60000 });
    const saved = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('quantum_tracker_biometrics', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, read = db.transaction('identities').objectStore('identities').getAll();
        read.onsuccess = () => { db.close(); resolve(read.result[0]); }; read.onerror = () => reject(read.error);
      };
    }));
    assert.equal(saved.name, 'Fixture cadastro direto');
    assert.equal(await page.evaluate(() => window.__capturedSamples), 5);
    // An unchanged fixture may produce identical descriptors; existing storage
    // deduplicates them after all five acquisition steps have completed.
    assert.ok(saved.embeddings.length >= 1 && saved.embeddings.length <= 5);
    assert.ok(saved.embeddings.every(e => e.length === 1024 && e.every(Number.isFinite)));
    assert.equal(saved.enrollment.presenceMethod, 'NOT_REQUIRED');
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.quantumCameraController.stop());
    console.log('PASS - real Human facial mesh and five-sample direct enrollment', JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
