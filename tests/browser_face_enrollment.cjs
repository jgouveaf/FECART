'use strict';
// Real page, video and IndexedDB; deterministic model output, no physical camera/USB.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const site = process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['camera'] });
  await require('./face_inference_double.cjs')(context);
  const errors = [];
  try {
    await context.addInitScript(() => {
      localStorage.setItem('quantumAuth:v1', 'ok');
      window.__face = { yaw: 0, score: 0, id: 1, visible: true, fail: false, count: 0, usb: 0,
        size: 180, confidence: .99, invalid: false, multiple: false };
      Object.defineProperty(navigator, 'serial', { value: { requestPort() { window.__face.usb++; throw Error('No hardware in test'); } } });
      window.Human = { Human: class {
        faceTriangulation = [0, 1, 2];
        tf = { dispose() {} };
        match = { similarity: (a, b) => a[0] === b[0] ? .99 : .1 };
        async load() {} async warmup() {}
        async detect(video, config) {
          const t = window.__face; t.count++; t.config = config;
          if (t.fail) throw Error('Injected processing error');
          const embedding = Array(1024).fill(t.id); embedding[1023] += t.count / 1000;
          if (t.invalid) embedding[10] = NaN;
          const mesh = Array.from({ length: 468 }, () => [100, 90, 0]);
          mesh[1] = [180, 90, 0]; mesh[2] = [140, 170, 0];
          const face = { box: [90, 70, t.size, t.size], mesh, embedding, faceScore: t.confidence,
            real: t.score, live: t.score, rotation: { angle: { yaw: t.yaw, pitch: 0, roll: 0 } } };
          return { face: t.visible ? t.multiple ? [face, { ...face, embedding: Array(1024).fill(3) }] : [face] : [], gesture: [] };
        }
      } };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let checks = 0;
    const check = async (name, fn) => { await fn(); checks++; console.log(`ok - ${name}`); };
    const set = changes => page.evaluate(changes => Object.assign(window.__face, changes), changes);
    const enabled = () => page.waitForFunction(() => !document.getElementById('registerPerson').disabled);
    const disabled = () => page.waitForFunction(() => document.getElementById('registerPerson').disabled);
    const record = () => page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('quantum_tracker_biometrics', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, read = db.transaction('identities').objectStore('identities').getAll();
        read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error); };
    }));
    await page.goto(site, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.quantumCameraController);
    await page.evaluate(() => window.quantumCameraController.start());
    await page.locator('#personName').fill('Cadastro direto'); await enabled();
    await check('a still face with zero presence scores can register without blinking or turning', async () => {
      assert.equal(await page.locator('#checkReal, #checkLive, #checkBlink, #confirmFacePresence, #facePresenceStatus').count(), 0);
      for (const key of ['iris', 'antispoof', 'liveness']) assert.equal(await page.evaluate(key => window.__face.config.face[key].enabled, key), false);
    });
    await check('mesh remains visible and mirrored once without a rectangular face outline', async () => {
      const r = await page.evaluate(() => { const c = document.getElementById('identityCanvas'), ctx = c.getContext('2d');
        const a = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
        return { visible: !c.hidden, edge: a(c.width - 140, 90), wrongSide: a(140, 90), box: a(c.width - 90, 120) }; });
      assert.equal(r.visible, true); assert.ok(r.edge > 0); assert.equal(r.wrongSide, 0); assert.equal(r.box, 0);
    });
    for (const [name, bad, good] of [
      ['two faces', { multiple: true }, { multiple: false }],
      ['small face', { size: 80 }, { size: 180 }],
      ['side pose', { yaw: .8 }, { yaw: 0 }],
      ['low confidence', { confidence: .2 }, { confidence: .99 }],
      ['invalid descriptor', { invalid: true }, { invalid: false }],
    ]) {
      await set(bad); await disabled();
      await check(`${name} still blocks enrollment`, async () => assert.equal((await record()).length, 0));
      await set(good); await enabled();
    }
    await page.locator('#registerPerson').click();
    await page.waitForFunction(() => document.querySelectorAll('.person-card').length === 1);
    await check('five samples persist without falsely recording presence as confirmed', async () => {
      const saved = (await record())[0]; assert.equal(saved.embeddings.length, 5); assert.equal(saved.enrollment.presenceMethod, 'NOT_REQUIRED');
      assert.equal('real' in saved.enrollment, false); assert.equal('live' in saved.enrollment, false);
      assert.ok(saved.photo.startsWith('data:image/jpeg'));
    });
    await set({ id: 2, score: undefined });
    await page.locator('#personName').fill('Cadastro sem escores'); await enabled();
    await page.locator('#registerPerson').click();
    await page.waitForFunction(() => document.querySelectorAll('.person-card').length === 2);
    await check('missing liveness scores do not block a new consistent face', async () => {
      const saved = (await record()).find(r => r.name === 'Cadastro sem escores');
      assert.equal(saved.embeddings.length, 5); assert.equal(saved.enrollment.presenceMethod, 'NOT_REQUIRED');
    });
    await page.locator('#personName').fill('Cadastro sem escores'); await enabled();
    await page.evaluate(() => document.getElementById('cameraVideo').pause()); await disabled();
    await check('frozen video still clears the mesh and disables registration', async () => {
      assert.equal(await page.evaluate(() => { const c = document.getElementById('identityCanvas'); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v); }), false);
    });
    await page.evaluate(() => document.getElementById('cameraVideo').play()); await enabled();
    await set({ fail: true }); await disabled();
    await check('inference error cannot leave registration enabled', async () => assert.equal((await record()).length, 2));
    await page.evaluate(() => window.quantumCameraController.stop()); await set({ fail: false });
    await check('camera stop and restart require fresh readings, without requesting USB', async () => {
      assert.equal(await page.locator('#registerPerson').isEnabled(), false);
      await page.evaluate(() => window.quantumCameraController.start()); await enabled();
      assert.equal(await page.evaluate(() => window.__face.usb), 0); assert.deepEqual(errors, []);
    });
    await page.evaluate(() => window.quantumCameraController.stop());
    console.log(`PASS - ${checks} enrollment and mesh browser checks`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
