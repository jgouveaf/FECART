'use strict';
// Real page, video and IndexedDB; deterministic model output and fake camera.
// Never opens a physical camera or USB port.
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
      window.__face = { yaw: 0, score: .1, id: 1, visible: true, fail: false, count: 0, usb: 0 };
      Object.defineProperty(navigator, 'serial', { value: { requestPort() { window.__face.usb++; throw Error('No hardware in test'); } } });
      window.Human = { Human: class {
        faceTriangulation = [0, 1, 2];
        tf = { dispose() {} };
        match = { similarity: (a, b) => a[0] === b[0] ? .99 : .1 };
        async load() {} async warmup() {}
        async detect() {
          const t = window.__face; t.count++;
          if (t.fail) throw Error('Injected camera processing error');
          const embedding = Array(1024).fill(t.id); embedding[1023] += t.count / 1000;
          const mesh = Array.from({ length: 468 }, () => [100, 90, 0]);
          mesh[1] = [180, 90, 0]; mesh[2] = [140, 170, 0];
          return { face: t.visible ? [{ box: [90, 70, 180, 180], mesh, embedding,
            faceScore: .99, real: t.score, live: t.score,
            rotation: { angle: { yaw: t.yaw, pitch: 0, roll: 0 } } }] : [], gesture: [] };
        }
      } };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const check = async (name, fn) => { await fn(); console.log(`ok - ${name}`); };
    const status = () => page.locator('#facePresenceStatus').textContent();
    const waitStatus = text => page.waitForFunction(text => document.getElementById('facePresenceStatus').textContent.includes(text), text);
    const set = changes => page.evaluate(changes => Object.assign(window.__face, changes), changes);
    const record = () => page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('quantum_tracker_biometrics', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, read = db.transaction('identities').objectStore('identities').getAll();
        read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error); };
    }));
    await page.goto(site, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.quantumCameraController);
    await page.evaluate(() => window.quantumCameraController.start());
    await page.locator('#personName').fill('Cadastro teste');
    await waitStatus('avaliação automática não confirmou');
    await check('low passive scores offer a usable guided route instead of endless checking', async () => {
      assert.equal(await page.locator('#confirmFacePresence').isEnabled(), true);
      assert.equal(await page.locator('#registerPerson').isEnabled(), false);
      assert.equal((await record()).length, 0);
    });
    await check('mesh is visible, mirrored once, with no rectangular face outline', async () => {
      const result = await page.evaluate(() => {
        const canvas = document.getElementById('identityCanvas'), ctx = canvas.getContext('2d');
        const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
        return { visible: !canvas.hidden && getComputedStyle(canvas).display !== 'none',
          edge: alpha(canvas.width - 140, 90), wrongSide: alpha(140, 90), box: alpha(canvas.width - 90, 120) };
      });
      assert.equal(result.visible, true); assert.ok(result.edge > 0);
      assert.equal(result.wrongSide, 0); assert.equal(result.box, 0);
    });
    await page.locator('#confirmFacePresence').click();
    await waitStatus('2/3');
    await page.waitForTimeout(700);
    await check('static face cannot complete a requested movement', async () => assert.match(await status(), /2\/3/));
    await set({ yaw: .23 }); await waitStatus('3/3');
    await set({ yaw: 0 }); await waitStatus('confirmada por movimento');
    await page.waitForFunction(() => !document.getElementById('registerPerson').disabled);
    await page.locator('#registerPerson').click();
    await page.waitForFunction(() => document.querySelectorAll('.person-card').length === 1);
    await check('movement saves five consistent samples despite persistently low passive scores', async () => {
      const saved = (await record())[0]; assert.equal(saved.embeddings.length, 5);
      assert.equal(saved.enrollment.presenceMethod, 'MOVEMENT'); assert.equal(saved.enrollment.real, .1);
      assert.ok(saved.photo.startsWith('data:image/jpeg')); assert.equal(saved.name, 'Cadastro teste');
    });
    await set({ visible: false }); await waitStatus('único rosto');
    await set({ visible: true, id: 2 });
    await page.locator('#personName').fill('Outra pessoa');
    await waitStatus('avaliação automática não confirmou');
    await check('a different face cannot inherit the previous confirmation', async () => {
      assert.equal(await page.locator('#registerPerson').isEnabled(), false);
    });
    await set({ score: .9 }); await waitStatus('confirmada automaticamente');
    await set({ score: .1 });
    await page.waitForFunction(() => !document.getElementById('registerPerson').disabled);
    await page.locator('#registerPerson').click();
    await page.waitForFunction(() => document.querySelectorAll('.person-card').length === 2);
    await check('automatic confirmation survives classifier oscillation through all five samples', async () => {
      const saved = (await record()).find(r => r.name === 'Outra pessoa');
      assert.equal(saved.embeddings.length, 5); assert.equal(saved.enrollment.presenceMethod, 'AUTO');
      assert.equal(saved.enrollment.live, .1);
    });
    await page.evaluate(() => document.getElementById('cameraVideo').pause());
    await waitStatus('único rosto');
    await check('frozen video clears stale mesh and disables enrollment', async () => {
      assert.equal(await page.locator('#registerPerson').isEnabled(), false);
      assert.equal(await page.locator('#confirmFacePresence').isEnabled(), false);
      assert.equal(await page.evaluate(() => { const c = document.getElementById('identityCanvas'); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v); }), false);
    });
    await page.evaluate(() => document.getElementById('cameraVideo').play());
    await waitStatus('avaliação automática não confirmou');
    await set({ fail: true });
    await waitStatus('único rosto');
    await check('inference failure clears presence UI and blocks the guided button', async () => {
      assert.equal(await page.locator('#confirmFacePresence').isEnabled(), false);
    });
    await page.evaluate(() => window.quantumCameraController.stop());
    await check('camera stop clears confirmation and no hardware was requested', async () => {
      assert.match(await status(), /Ative a câmera/);
      assert.equal(await page.evaluate(() => window.__face.usb), 0);
      assert.deepEqual(errors, []);
    });
    await set({ fail: false });
    await page.evaluate(() => window.quantumCameraController.start());
    await waitStatus('avaliação automática não confirmou');
    await check('camera restart requires fresh presence confirmation', async () => {
      assert.equal(await page.locator('#registerPerson').isEnabled(), false);
      assert.equal(await page.locator('#confirmFacePresence').isEnabled(), true);
    });
    await set({ score: .9 }); await waitStatus('confirmada automaticamente'); await set({ score: .1 });
    await page.locator('#handCameraTab').click();
    await page.locator('#faceCameraTab').click();
    await waitStatus('avaliação automática não confirmou');
    await check('switching camera tabs clears the old enrollment approval', async () => {
      assert.equal(await page.locator('#registerPerson').isEnabled(), false);
    });
    await set({ score: .9 }); await waitStatus('confirmada automaticamente');
    await page.evaluate(() => Object.defineProperty(document.getElementById('cameraVideo'), 'readyState', { configurable: true, get: () => 1 }));
    await waitStatus('único rosto');
    await check('a video that loses ready frames cannot keep presence approved', async () => {
      assert.equal(await page.locator('#confirmFacePresence').isEnabled(), false);
    });
    await page.evaluate(() => { delete document.getElementById('cameraVideo').readyState; });
    await page.evaluate(() => window.quantumCameraController.stop());
    console.log('PASS - 12 enrollment and mesh browser checks');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
