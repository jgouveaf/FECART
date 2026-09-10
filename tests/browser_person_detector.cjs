"use strict";
// Real MediaPipe model + classic Worker. Only an existing local fixture, no live camera/USB.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const site = process.env.QT_SITE_URL || "http://127.0.0.1:9876/";
const fixture = process.env.QT_PERSON_IMAGE;
if (!fixture) throw new Error("Set QT_PERSON_IMAGE to a local photo with people (e.g. Ultralytics assets/bus.jpg).");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/__person_fixture.jpg", route => route.fulfill({ path: fixture, contentType: "image/jpeg" }));
    await page.goto(site);
    const result = await page.evaluate(async () => {
      const img = new Image(); img.src = "__person_fixture.jpg"; await img.decode();
      const bitmap = await createImageBitmap(img);
      return new Promise((resolve, reject) => {
        const worker = new Worker("web/person-detector.worker.js?v=3");
        const timer = setTimeout(() => { worker.terminate(); reject(new Error("Worker timeout")); }, 30000);
        worker.onerror = e => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message)); };
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") worker.postMessage({ type: "frame", bitmap, id: 1, capturedAt: performance.now() }, [bitmap]);
          else { clearTimeout(timer); worker.terminate(); resolve(data); }
        };
        worker.postMessage({ type: "init" });
      });
    });
    assert.equal(result.type, "result", JSON.stringify(result));
    assert.ok(result.people.length >= 2, JSON.stringify(result));
    assert.ok(result.people.every(p => p.confidence >= .5 && p.box.width > 0 && p.box.height > 0));
    const appearance = require('../web/person-appearance.js');
    assert.ok(result.people.some(p => appearance.valid(p.appearance)), 'Real pixels provide a clothing descriptor for at least one complete body');
    assert.ok(result.people.every(p => p.appearance === null || appearance.valid(p.appearance)));
    console.log(JSON.stringify({ realModel: "EfficientDet Lite0 int8 v1", people: result.people.length,
      usableClothingSamples: result.people.filter(p => appearance.valid(p.appearance)).length }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
