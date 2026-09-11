'use strict';
// Real Human + EfficientDet, canvas video from Human's bundled warmup image.
// No physical camera, USB port or motor is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const site = process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
const fixture = /V0=`([^`]+)`/.exec(fs.readFileSync(path.join(__dirname, '../web/vendor/human/human.js'), 'utf8'))[1];
(async () => {
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/\.wasm|models\//.test(r.url()) && new URL(r.url()).origin !== new URL(site).origin) external.push(r.url()); });
    await page.route('**/__target.jpg', r => r.fulfill({ contentType: 'image/jpeg', body: Buffer.from(fixture, 'base64') }));
    await page.addInitScript(() => {
      localStorage.setItem('quantumAuth:v1', 'ok');
      window.__fixture = { x: .5, visible: true, bodyCount: null, events: [], usbRequests: 0 };
      addEventListener('quantum:person-tracking', e => window.__fixture.events.push(e.detail));
      addEventListener('quantum:face-observations', e => { window.__fixture.faces = e.detail.faces; });
      const RealWorker = Worker;
      window.Worker = class {
        constructor(url, options) {
          const worker = new RealWorker(url, options);
          if (String(url).includes('person-detector.worker.js')) worker.addEventListener('message', ({ data }) => {
            if (data.type === 'result') { window.__fixture.bodyCount = data.people.length; window.__fixture.people = data.people; }
          });
          return worker;
        }
      };
      Object.defineProperty(navigator, 'serial', { value: { requestPort() { window.__fixture.usbRequests++; throw Error('No hardware allowed'); } } });
      const media = new EventTarget();
      media.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'fixture', label: 'Local fixture' }];
      media.getUserMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext('2d'), img = new Image(); img.src = new URL('__target.jpg', document.baseURI).href; await img.decode();
        const draw = () => {
          ctx.fillStyle = '#273546'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (window.__fixture.visible) ctx.drawImage(img, window.__fixture.x * canvas.width - 100, 210, 200, 200);
        };
        draw(); const timer = setInterval(draw, 100);
        const stream = canvas.captureStream(10), track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
        return stream;
      };
      Object.defineProperty(navigator, 'mediaDevices', { value: media });
    });
    await page.goto(site, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.quantumCameraController.start());
    await page.locator('#personName').fill('Alvo do teste local');
    await page.waitForFunction(() => !document.getElementById('registerPerson').disabled, null, { timeout: 60000 });
    assert.equal(await page.locator('#personCount').textContent(), '1');
    assert.equal(await page.evaluate(() => window.quantumPersonFollower.snapshot.id), null);
    await page.locator('#registerPerson').click();
    await page.waitForFunction(() => document.querySelectorAll('.follow-person').length === 1, null, { timeout: 60000 });
    await page.locator('.follow-person').click();
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.command === 'FRENTE', null, { timeout: 60000 });
    const result = await page.evaluate(() => ({ ...window.quantumPersonFollower.snapshot,
      bodyCount: window.__fixture.bodyCount, personCount: document.getElementById('personCount').textContent }));
    assert.equal(result.state, 'FACE_TRACKING'); assert.equal(result.bodyCount, 0);
    assert.equal(result.personCount, '1'); assert.equal(result.id, 'QT-001');
    for (const [x, turn] of [[.25, 'ESQUERDA'], [.75, 'DIREITA']]) {
      await page.evaluate(x => { window.__fixture.x = x; window.__fixture.events = []; }, x);
      await page.waitForFunction(turn => window.__fixture.events.some(e => e.command === turn && e.state === 'FACE_TRACKING'), turn, { timeout: 30000 });
      await page.waitForFunction(() => window.__fixture.events.some(e => e.command === 'FRENTE' && e.state === 'FACE_TRACKING'), null, { timeout: 30000 });
    }
    await page.evaluate(() => { window.__fixture.visible = false; });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot.command === 'PARAR' && document.getElementById('personCount').textContent === '0');
    assert.equal(await page.evaluate(() => window.__fixture.usbRequests), 0);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await page.evaluate(() => window.quantumCameraController.stop());
    console.log('PASS - real models count and follow a face with zero detected bodies, curve both ways and stop on loss', JSON.stringify(result));
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ status: document.getElementById('personFollowStatus').textContent,
      hint: document.getElementById('faceHint').textContent, face: document.getElementById('currentFaceId').textContent,
      quality: document.getElementById('faceQuality').textContent, similarity: document.getElementById('faceSimilarity').textContent,
      bodyCount: window.__fixture?.bodyCount, people: window.__fixture?.people, faces: window.__fixture?.faces,
      snapshot: window.quantumPersonFollower?.snapshot, performance: window.quantumFacePerformance })));
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
