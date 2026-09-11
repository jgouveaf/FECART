"use strict";
// Real site, IndexedDB, video frames, controller and Serial streams; inference and USB are doubles.
// This test NEVER requests a physical camera or serial port.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const site = process.env.QT_SITE_URL || "http://127.0.0.1:9876/";
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const context = await browser.newContext({ permissions: ["camera"] });
  try {
    await context.addInitScript(() => {
      localStorage.setItem("quantumAuth:v1", "ok");
      window.__test = { x: .5, people: true, face: true, embedding: 1, frames: 0, workers: 0, writes: [], distance: 60, failFace: false, events: [], appearance: false, outfit: 0, rival: false };
      addEventListener("quantum:person-tracking", e => window.__test.events.push(e.detail));
      window.Human = { Human: class {
        tf = { dispose() {} };
        match = { similarity(a, b) { return a[0] === b[0] ? .99 : .1; } };
        async load() {} async warmup() {}
        async detect(video) {
          if (window.__test.failFace) throw new Error("injected face failure");
          const t = window.__test, w = video.videoWidth, h = video.videoHeight;
          const embedding = Array(1024).fill(t.embedding); embedding[1023] += ++t.frames / 1000;
          const faces = t.face ? [{ box: [t.x * w - 80, .13 * h, 160, 160],
            faceScore: .99, real: .99, live: .99, embedding,
            rotation: { angle: { yaw: 0, pitch: 0, roll: 0 } } }] : [];
          if (t.extraUnknownFace && faces.length) faces.push({ ...faces[0], box: [t.x * w + 10, .13 * h, 160, 160], embedding: Array(1024).fill(2) });
          return { face: faces, gesture: [{ gesture: "facing center" }] };
        }
      } };
      const RealWorker = window.Worker;
      window.Worker = class {
        constructor(url, options) {
          if (!String(url).includes("person-detector.worker.js")) return new RealWorker(url, options);
          window.__test.workers++; this.closed = false;
        }
        postMessage(data) {
          data.bitmap?.close();
          setTimeout(() => {
            if (this.closed) return;
            const t = window.__test;
            const rgba = new Uint8ClampedArray(24 * 48 * 4);
            for (let i = 0; i < 24 * 48; i++) rgba.set([...(i < 24 * 24 ? (t.outfit ? [30, 220, 30] : [220, 30, 30]) : [30, 50, 170]), 255], i * 4);
            const clothing = window.QuantumPersonAppearance.describe(rgba, 24, 48);
            const confidence = t.confidenceOscillation && data.capturedAt % 500 < 300 ? .53 : .92;
            const people = t.people ? [{ confidence, box: { x: t.x - .18, y: .1, width: .36, height: .6 }, appearance: t.appearance ? clothing : null }] : [];
            if (t.rival) people.push({ confidence: .92, box: { x: .75, y: .1, width: .24, height: .6 }, appearance: clothing });
            if (data.type === "frame" && t.failWorker) { this.onmessage?.({ data: { type: "error", message: "injected worker error" } }); return; }
            this.onmessage?.({ data: data.type === "init" ? { type: "ready" } : {
              type: "result", id: data.id, capturedAt: data.capturedAt,
              people,
            } });
          }, window.__test.bodyLatency || 25);
        }
        terminate() { if (!this.closed) window.__test.workers--; this.closed = true; }
      };
      const serial = new EventTarget();
      serial.requestPort = async () => {
        let receive, timer, mode = 1, command = "PARAR", emergency = true;
        const send = line => { try { receive.enqueue(new TextEncoder().encode(line + "\n")); } catch {} };
        const telemetry = () => send(`QT|MODE:${mode}|DIST:${window.__test.distance}|CMD:${command}|STATE:${emergency ? "ESTOP" : "SEGUINDO"}`);
        return {
          async open() {
            this.readable = new ReadableStream({ start(c) { receive = c; } });
            this.writable = new WritableStream({ write(bytes) {
              const line = new TextDecoder().decode(bytes).trim(); window.__test.writes.push(line);
              if (line === "HELLO") send("QT:READY:V7");
              else if (line === "STATUS") telemetry();
              else {
                if (line.startsWith("MODE:")) mode = Number(line.split(":")[1]);
                if (line === "ESTOP") { emergency = true; command = "PARAR"; }
                if (line === "RESET_ESTOP") emergency = false;
                if (line.startsWith("CMD:")) command = emergency ? "PARAR" : line.slice(4);
                send(`OK:${line}`);
              }
            } });
            timer = setInterval(telemetry, 200);
          }, async close() { clearInterval(timer); },
        };
      };
      Object.defineProperty(navigator, "serial", { value: serial });
    });
    const page = await context.newPage(), errors = [], results = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", dialog => dialog.accept());
    const check = async (name, fn) => { await fn(); results.push(name); console.log(`ok - ${name}`); };
    const snap = () => page.evaluate(() => window.quantumPersonFollower.snapshot);
    const waitCommand = cmd => page.waitForFunction(cmd => window.quantumPersonFollower.snapshot?.command === cmd, cmd, { timeout: 12000 });
    const dbRecords = () => page.evaluate(() => new Promise((resolve, reject) => {
      const r = indexedDB.open("quantum_tracker_biometrics", 1);
      r.onsuccess = () => { const db = r.result, get = db.transaction("identities").objectStore("identities").getAll(); get.onsuccess = () => { db.close(); resolve(get.result); }; get.onerror = () => reject(get.error); };
    }));
    await page.goto(site, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.quantumPersonFollower);
    await check("Mode 1 does not start body model", async () => assert.equal(await page.evaluate(() => window.__test.workers), 0));
    await page.evaluate(() => window.quantumCameraController.start());
    await page.locator("#personName").fill("Pessoa de teste");
    await page.waitForFunction(() => !document.getElementById("registerPerson").disabled);
    await page.locator("#registerPerson").click();
    await page.waitForFunction(() => document.querySelectorAll(".follow-person").length === 1);
    await check("registration commits five samples and a photo", async () => {
      const records = await dbRecords(); assert.equal(records.length, 1); assert.equal(records[0].embeddings.length, 5);
      assert.equal(records[0].embeddings[0].length, 1024); assert.ok(records[0].photo.startsWith("data:image/jpeg"));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".follow-person").length === 1);
    await check("registration survives page reload with same ID", async () => assert.equal((await dbRecords())[0].id, "QT-001"));
    await page.locator(".follow-person").click();
    await page.locator("#preparePersonFollow").click();
    await waitCommand("FRENTE");
    await check("chosen face associates with body and follows in preview", async () => {
      assert.equal((await snap()).id, "QT-001"); assert.equal((await snap()).state, "FOLLOWING");
      assert.equal(await page.evaluate(() => window.__test.writes.length), 0);
    });
    await check("face mesh layer and body tracking remain available without drawing a face box", async () => {
      const overlays = await page.evaluate(() => {
        const face = document.getElementById("identityCanvas"), body = document.getElementById("personCanvas");
        return { faceVisible: !face.hidden && getComputedStyle(face).display !== "none",
          faceDrawn: face.getContext("2d").getImageData(0, 0, face.width, face.height).data.some(v => v !== 0),
          bodyVisible: getComputedStyle(body).display !== "none",
          bodyDrawn: body.getContext("2d").getImageData(0, 0, body.width, body.height).data.some(v => v !== 0),
          identified: document.getElementById("currentFaceId").textContent };
      });
      assert.equal(overlays.faceVisible, true);
      assert.equal(overlays.faceDrawn, false, 'No invented mesh or bounding box when model has no landmarks');
      assert.equal(overlays.bodyVisible, true);
      assert.equal(overlays.bodyDrawn, true);
      assert.equal(overlays.identified, "QT-001");
    });
    await page.locator("#connectRobot").click();
    await page.waitForFunction(() => window.quantumRobot.connected);
    await check("connecting never releases ESTOP automatically", async () => {
      assert.equal(await page.evaluate(() => window.QuantumControl.state.safety.emergency), true);
      assert.equal(await page.evaluate(() => window.__test.writes.includes("RESET_ESTOP")), false);
    });
    await page.locator("#emergencyStop").click();
    await page.waitForFunction(() => window.__test.writes.includes("CMD:FRENTE"));
    await check("Mode 2 decision reaches existing Web Serial controller", async () => assert.ok(await page.evaluate(() => window.__test.writes.includes("MODE:2"))));
    await check('confidence oscillation preserves movement over simulated USB', async () => {
      await waitCommand('FRENTE');
      await page.evaluate(() => { window.__test.events = []; window.__test.writes = []; window.__test.confidenceOscillation = true; });
      await page.waitForTimeout(2200);
      const observed = await page.evaluate(() => ({ events: window.__test.events, writes: window.__test.writes }));
      assert.ok(observed.events.length >= 5);
      assert.ok(observed.events.every(event => event.command === 'FRENTE'), JSON.stringify(observed.events));
      assert.ok(observed.writes.includes('CMD:FRENTE'));
      assert.ok(!observed.writes.includes('CMD:PARAR'));
      await page.evaluate(() => { window.__test.confidenceOscillation = false; });
    });
    await check('slow pending inference stops expired movement without restarting identification', async () => {
      await page.evaluate(() => { window.__test.bodyLatency = 350; window.__test.events = []; });
      await page.waitForTimeout(2400);
      const observed = await page.evaluate(() => window.__test.events);
      assert.ok(observed.some(event => event.state === 'STALE_FRAME'));
      assert.ok(observed.some(event => event.command === 'FRENTE'));
      assert.ok(observed.filter(event => event.state === 'STALE_FRAME').every(event => event.command === 'PARAR' && !event.visible));
      assert.ok(!observed.some(event => ['CONFIRMING', 'REIDENTIFY', 'TARGET_LOST'].includes(event.state)), JSON.stringify(observed));
      await page.evaluate(() => { window.__test.bodyLatency = 25; });
      await waitCommand('FRENTE');
    });
    await check('diagnostic export is bounded and contains no biometric records', async () => {
      await page.locator('.person-follow-diagnostics > summary').click();
      assert.match(await page.locator('#personLastStop').textContent(), /Imagem atrasada/);
      const pendingDownload = page.waitForEvent('download');
      await page.locator('#downloadPersonDiagnostics').click();
      const download = await pendingDownload;
      const report = JSON.parse(require('node:fs').readFileSync(await download.path(), 'utf8'));
      assert.equal(report.version, 1);
      assert.ok(report.transitions.length > 0 && report.transitions.length <= 60);
      assert.ok(report.frameAgeMs >= 0);
      assert.equal(report.lastStop.reason, 'STALE_FRAME');
      assert.doesNotMatch(JSON.stringify(report), /Pessoa de teste|embedding|photo|data:image|QT-001/);
      const count = await page.evaluate(() => {
        const copy = window.quantumPersonFollower.diagnostics; copy.transitions.length = 0;
        return window.quantumPersonFollower.diagnostics.transitions.length;
      });
      assert.ok(count > 0, 'Consumers cannot mutate internal diagnostic history');
      await page.locator('.person-follow-diagnostics').screenshot({ path: 'tests/artifacts/mode-two-diagnostics.png' });
      await page.locator('.person-follow-diagnostics > summary').click();
    });
    for (const [x, command] of [[.25, "ESQUERDA"], [.75, "DIREITA"], [.5, "FRENTE"]]) {
      await page.evaluate(x => { window.__test.x = x; window.__test.writes = []; }, x);
      await waitCommand(command);
      await page.waitForFunction(command => window.__test.writes.includes(`CMD:${command}`), command);
      await check(`${command} is acknowledged over simulated USB`, async () => assert.equal((await snap()).command, command));
    }
    await page.evaluate(() => { window.__test.extraUnknownFace = true; window.__test.writes = []; });
    await page.waitForFunction(() => window.__test.events.some(e => e.state === 'AMBIGUOUS') && window.__test.writes.includes('CMD:PARAR'));
    await check('two faces in one body, including an unknown person, request STOP over USB', async () => assert.equal((await snap()).command, 'PARAR'));
    await page.evaluate(() => { window.__test.extraUnknownFace = false; }); await waitCommand('FRENTE');
    // Prediction is intentionally suppressed while telemetry still says the camera is turning.
    await page.waitForFunction(() => window.QuantumControl.state.robot.command === "FRENTE");
    await page.evaluate(() => { window.__test.people = false; window.__test.face = false; window.__test.writes = []; });
    await waitCommand("PARAR");
    await page.waitForFunction(() => window.__test.writes.includes("CMD:PARAR"));
    await check("lost person produces estimate but only STOP", async () => {
      assert.ok(await page.evaluate(() => window.__test.events.some(e => e.prediction && e.command === "PARAR" && !e.visible)));
      await page.waitForTimeout(700); assert.equal((await snap()).prediction, null);
    });
    await page.evaluate(() => { window.__test.people = true; window.__test.face = true; }); await waitCommand("FRENTE");
    await page.evaluate(() => { window.__test.distance = 25; });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.state === "KEEP_DISTANCE");
    await check("Mode 2 stops at conservative obstacle distance", async () => assert.equal((await snap()).command, "PARAR"));
    await page.evaluate(() => { window.__test.distance = 60; }); await waitCommand("FRENTE");
    await page.evaluate(() => { window.__test.failWorker = true; });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.state === "ERROR");
    await check("body worker failure stops and exposes explicit retry", async () => {
      assert.equal((await snap()).command, "PARAR"); assert.equal(await page.evaluate(() => window.__test.workers), 0);
      assert.equal(await page.locator("#retryPersonDetection").isVisible(), true);
    });
    await page.evaluate(() => { window.__test.failWorker = false; });
    await page.locator("#retryPersonDetection").click(); await waitCommand("FRENTE");
    await check("body worker recovers only through retry and new evidence", async () => assert.equal((await snap()).state, "FOLLOWING"));
    await page.evaluate(() => { window.__test.failFace = true; });
    await waitCommand("PARAR");
    await page.waitForFunction(() => !document.getElementById("retryFaceDetection").hidden);
    await check("face inference circuit breaker clears target evidence", async () => assert.equal((await snap()).command, "PARAR"));
    await page.evaluate(() => { window.__test.failFace = false; });
    await page.locator("#retryFaceDetection").click(); await waitCommand("FRENTE");
    await check("face retry reacquires selected body without changing ID", async () => assert.equal((await snap()).id, "QT-001"));
    await page.evaluate(() => { window.__test.face = false; });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.state === "BODY_TRACKING");
    await check("body retains target briefly when face turns away", async () => assert.equal((await snap()).command, "FRENTE"));
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.command === "PARAR", null, { timeout: 6000 });
    await check("body identity expires and cannot run indefinitely", async () => assert.equal((await snap()).command, "PARAR"));
    await page.evaluate(() => { window.__test.face = true; }); await waitCommand("FRENTE");
    await page.evaluate(() => { window.__test.appearance = true; });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.appearanceReady);
    await page.evaluate(() => { window.__test.face = false; window.__test.writes = []; });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.state === 'APPEARANCE_TRACKING');
    await page.waitForTimeout(4000);
    await check('body and clothing maintain the selected target beyond the old face timeout', async () => {
      const result = await snap(); assert.equal(result.state, 'APPEARANCE_TRACKING'); assert.equal(result.command, 'FRENTE'); assert.equal(result.id, 'QT-001');
      assert.ok(await page.evaluate(() => window.__test.writes.includes('CMD:FRENTE')));
    });
    await page.evaluate(() => { window.__test.rival = true; window.__test.writes = []; });
    await waitCommand('PARAR');
    await page.waitForFunction(() => window.__test.writes.includes('CMD:PARAR'));
    await check('similar clothing on another body requests stop over simulated USB', async () => assert.equal((await snap()).command, 'PARAR'));
    await page.evaluate(() => { window.__test.rival = false; }); await page.waitForTimeout(700);
    await check('removing the competing body does not silently reacquire by clothing', async () => assert.equal((await snap()).command, 'PARAR'));
    await page.evaluate(() => { window.__test.face = true; }); await waitCommand('FRENTE');
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.appearanceReady);
    await page.evaluate(() => { window.__test.face = false; });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.state === 'APPEARANCE_TRACKING');
    await page.evaluate(() => { window.__test.outfit = 8; }); await waitCommand('PARAR');
    await check('incompatible clothing stops instead of transferring the target ID', async () => assert.equal((await snap()).command, 'PARAR'));
    await page.evaluate(() => { window.__test.face = true; window.__test.outfit = 0; }); await waitCommand('FRENTE');
    await page.evaluate(() => {
      const v = document.getElementById("cameraVideo"), frozen = v.currentTime;
      Object.defineProperty(v, "currentTime", { configurable: true, get: () => frozen });
    });
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.state === "STALE_FRAME");
    await check("frozen video cannot keep refreshing motion", async () => assert.equal((await snap()).command, "PARAR"));
    await page.evaluate(() => { delete document.getElementById("cameraVideo").currentTime; }); await waitCommand("FRENTE");
    await page.locator("#personName").fill("Pessoa de teste");
    await page.waitForFunction(() => !document.getElementById("registerPerson").disabled);
    await page.locator("#registerPerson").click();
    await page.waitForFunction(() => window.quantumPersonFollower.snapshot?.state === "ENROLLING");
    await check("enrollment pauses follow before collecting samples", async () => assert.equal((await snap()).command, "PARAR"));
    await page.waitForTimeout(1800);
    await page.locator("#pausePersonFollow").click();
    await check("manual pause stops worker and movement", async () => { assert.equal((await snap()).command, "PARAR"); assert.equal(await page.evaluate(() => window.__test.workers), 0); });
    const downloadPromise = page.waitForEvent("download"); await page.locator("#exportIdentities").click(); const download = await downloadPromise;
    const fs = require("node:fs"); const backup = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    await check("backup contains committed enrollment", async () => { assert.equal(backup.identities.length, 1); assert.ok(backup.identities[0].embeddings.length >= 5); });
    await page.getByRole("button", { name: "Excluir", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".follow-person").length === 0);
    await check("explicit deletion removes local identity and selected target", async () => { assert.equal((await dbRecords()).length, 0); assert.equal((await snap()).command, "PARAR"); });
    await page.locator("#identityBackupFile").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => document.querySelectorAll(".follow-person").length === 1);
    await check("backup restores enrollment without silently selecting it", async () => assert.equal((await snap()).id, null));
    const invalidBackup = structuredClone(backup); invalidBackup.identities[0].embeddings.forEach(e => { e[3] = "not a number"; });
    // The live face panel also writes this hint. Observe the rejection when it
    // happens, instead of depending on a polling interval catching transient text.
    await page.evaluate(() => {
      window.__test.importRejected = false;
      const hint = document.getElementById('faceHint');
      const observer = new MutationObserver(() => {
        if (hint.textContent.includes('Falha ao importar')) { window.__test.importRejected = true; observer.disconnect(); }
      });
      observer.observe(hint, { childList: true, characterData: true, subtree: true });
    });
    await page.locator("#identityBackupFile").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalidBackup)) });
    await page.waitForFunction(() => window.__test.importRejected);
    await check("malformed numeric embeddings are rejected without modifying enrollment", async () => assert.equal((await dbRecords())[0].embeddings[0][3], 1));
    await page.evaluate(() => { window.__test.embedding = 2; });
    await page.locator("#personName").fill("Cadastro interrompido");
    await page.waitForFunction(() => !document.getElementById("registerPerson").disabled);
    await page.locator("#registerPerson").click();
    await page.evaluate(async () => { await window.quantumCameraController.stop(); await window.quantumCameraController.start(); });
    await page.waitForTimeout(1500);
    await check("camera restart cancels incomplete enrollment instead of resuming it", async () => assert.equal((await dbRecords()).length, 1));
    await page.locator("#personName").fill("");
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      await check(`Mode 2 layout fits ${width}px viewport`, async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false));
    }
    await page.locator(".person-follow-panel").evaluate(e => e.scrollIntoView({ block: "center" }));
    await page.locator(".person-follow-panel").screenshot({ path: "tests/artifacts/mode-two-panel.png" });
    await page.evaluate(() => window.quantumRobot.requestMode(1, "test"));
    await page.waitForFunction(() => window.QuantumControl.state.mode.id === 1 && window.QuantumControl.state.mode.phase === "ACTIVE");
    await check("return to Mode 1 releases body worker", async () => assert.equal(await page.evaluate(() => window.__test.workers), 0));
    // Avoid loading the gesture model in this integration test; its own real-model smoke covers it.
    await page.evaluate(() => { window.quantumGestureController = { selectView: async () => {}, enableGestures: async () => {} }; });
    await page.evaluate(() => window.quantumRobot.requestMode(3, "test"));
    await page.waitForFunction(() => window.QuantumControl.state.mode.id === 3 && window.QuantumControl.state.mode.phase === "ACTIVE");
    await page.evaluate(() => { window.__test.events = []; }); await page.waitForTimeout(700);
    await check("Mode 3 receives no person-follow events or worker", async () => {
      assert.equal(await page.evaluate(() => window.__test.workers), 0); assert.equal(await page.evaluate(() => window.__test.events.length), 0);
    });
    await page.locator("#disconnectRobot").click();
    await page.waitForFunction(() => !window.quantumRobot.usbBusy);
    assert.deepEqual(errors, []);
    console.log(`${results.length} browser scenarios passed (mock inference/USB, real persistence and controller).`);
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
