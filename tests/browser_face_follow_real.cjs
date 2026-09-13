'use strict';
// Real SCRFD/SFace + EfficientDet, canvas video from Human's bundled warmup image.
// No physical camera, USB port or motor is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const site = process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
const mockedUSB = process.env.QT_TEST_USB === '1';
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
    await page.addInitScript(({ mockedUSB }) => {
      localStorage.setItem('quantumAuth:v1', 'ok');
      window.__fixture = { x: .5, visible: true, bodyCount: null, events: [], usbRequests: 0, writes: [], stops: [], distance: 100 };
      addEventListener('quantum:person-tracking', e => window.__fixture.events.push(e.detail));
      addEventListener('quantum:face-observations', e => { window.__fixture.faces = e.detail.faces; });
      const RealWorker = Worker;
      window.Worker = class {
        constructor(url, options) {
          const worker = new RealWorker(url, options);
          if (String(url).includes('person-detector.worker.js')) worker.addEventListener('message', ({ data }) => {
            if (data.type === 'result') { window.__fixture.bodyCount = data.people.length;
              window.__fixture.people = data.people; window.__fixture.bodyAt = data.capturedAt; }
          });
          return worker;
        }
      };
      const serial = new EventTarget();
      serial.requestPort = async () => {
        window.__fixture.usbRequests++;
        if (!mockedUSB) throw Error('No hardware allowed');
        let receive, timer, mode=1, command='PARAR', emergency=true;
        const send=line=>{try {receive.enqueue(new TextEncoder().encode(line+'\n'));} catch {}};
        const telemetry=()=>send(`QT|MODE:${mode}|DIST:${window.__fixture.distance}|CMD:${command}|STATE:${emergency?'ESTOP':'SEGUINDO'}`);
        return {
          async open() {
            this.readable=new ReadableStream({start(c){receive=c;}});
            this.writable=new WritableStream({write(bytes){
              const line=new TextDecoder().decode(bytes).trim();window.__fixture.writes.push(line);
              if(line==='CMD:PARAR') window.__fixture.stops.push({at:performance.now(),
                follow:window.quantumPersonFollower?.snapshot,performance:window.quantumFacePerformance,
                bodyAt:window.__fixture.bodyAt,
                reason:document.getElementById('personLastStop')?.textContent,phase:window.QuantumControl?.state.mode});
              if(line==='HELLO') send('QT:READY:V7');
              else if(line==='STATUS') telemetry();
              else {
                if(line.startsWith('MODE:')) mode=Number(line.split(':')[1]);
                if(line==='ESTOP'){emergency=true;command='PARAR';}
                if(line==='RESET_ESTOP') emergency=false;
                if(line.startsWith('CMD:')) command=emergency?'PARAR':line.slice(4);
                send(`OK:${line}`);
              }
            }});
            timer=setInterval(telemetry,200);
          },async close(){clearInterval(timer);},
        };
      };
      Object.defineProperty(navigator, 'serial', { value: serial });
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
    }, { mockedUSB });
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
    if (mockedUSB) {
      page.on('dialog',dialog=>dialog.accept());
      await page.locator('#connectRobot').click();
      await page.waitForFunction(()=>window.quantumRobot.connected);
      assert.equal(await page.evaluate(()=>window.QuantumControl.state.safety.emergency),true);
      assert.equal(await page.evaluate(()=>window.__fixture.writes.includes('RESET_ESTOP')),false);
      await page.locator('#emergencyStop').click();
      await page.waitForFunction(()=>window.__fixture.writes.includes('CMD:FRENTE'),null,{timeout:15000});
      await page.evaluate(()=>{
        window.__fixture.writes=[];window.__fixture.stops=[];window.__fixture.gaps=[];let previous=performance.now();
        window.__fixture.timer=setInterval(()=>{const now=performance.now();window.__fixture.gaps.push(now-previous);previous=now;},25);
      });
      await page.waitForTimeout(8000);
      const steady=await page.evaluate(()=>{
        clearInterval(window.__fixture.timer);return {writes:window.__fixture.writes,stops:window.__fixture.stops,maxUiGapMs:Math.max(...window.__fixture.gaps),performance:window.quantumFacePerformance};
      });
      console.log('STEADY - eight seconds of real inference and mocked USB',JSON.stringify(steady));
      assert.ok(steady.writes.filter(line => line === 'CMD:FRENTE').length >= 5,
        'A recognized stationary target must keep producing forward requests');
      // Real inference has variable latency. A safety stop on an actually
      // expired capture is required; a false loss/reacquisition loop is not.
      // Deterministic fast-frame tests separately require zero STOP commands.
      for (const stop of steady.stops) {
        assert.equal(stop.follow.state, 'STALE_FRAME', 'No unexplained stop for a stable recognized target');
        const evidenceAt = stop.follow.capturedAt ?? stop.bodyAt;
        assert.ok(Number.isFinite(evidenceAt) && stop.at - evidenceAt > 600,
          'STOP must be supported by an expired capture, never just slow mesh rendering');
      }
      await page.waitForFunction(() => window.quantumPersonFollower.snapshot.command === 'FRENTE', null, { timeout: 5000 });
    }
    await page.locator('#camera-gestos').scrollIntoViewIfNeeded();
    fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'artifacts/official-mode-two.png')});
    for (const [x, turn] of [[.25, 'ESQUERDA'], [.75, 'DIREITA']]) {
      await page.evaluate(x => { window.__fixture.x = x; window.__fixture.events = []; }, x);
      await page.waitForFunction(turn => window.__fixture.events.some(e => e.command === turn && e.state === 'FACE_TRACKING'), turn, { timeout: 30000 });
      await page.waitForFunction(() => window.__fixture.events.some(e => e.command === 'FRENTE' && e.state === 'FACE_TRACKING'), null, { timeout: 30000 });
      if(mockedUSB) await page.waitForFunction(turn=>window.__fixture.writes.includes('CMD:'+turn),turn,{timeout:15000});
    }
    if(mockedUSB) {
      await page.evaluate(()=>{window.__fixture.x=.5;window.__fixture.distance=20;window.__fixture.writes=[];});
      await page.waitForFunction(()=>window.__fixture.writes.includes('CMD:PARAR'));
      await page.evaluate(()=>{window.__fixture.distance=100;window.__fixture.writes=[];});
      await page.waitForFunction(()=>window.__fixture.writes.includes('CMD:FRENTE'));
    }
    await page.evaluate(() => { window.__fixture.visible = false; window.__fixture.writes=[]; });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot.command === 'PARAR' && document.getElementById('personCount').textContent === '0');
    assert.equal(await page.evaluate(() => window.__fixture.usbRequests), mockedUSB ? 1 : 0);
    if(mockedUSB) {
      await page.waitForFunction(()=>window.__fixture.writes.includes('CMD:PARAR'));
      await page.locator('#disconnectRobot').click();
    }
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await page.evaluate(() => window.quantumCameraController.stop());
    console.log('PASS - real models count and follow a face with zero detected bodies, curve both ways and stop on loss', JSON.stringify({...result,mockedUSB}));
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ status: document.getElementById('personFollowStatus').textContent,
      hint: document.getElementById('faceHint').textContent, face: document.getElementById('currentFaceId').textContent,
      quality: document.getElementById('faceQuality').textContent, similarity: document.getElementById('faceSimilarity').textContent,
      bodyCount: window.__fixture?.bodyCount, people: window.__fixture?.people, faces: window.__fixture?.faces,
      snapshot: window.quantumPersonFollower?.snapshot, performance: window.quantumFacePerformance })));
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
