'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PersonFollower } = require('../web/person-follow-math.js');
const appearance = require('../web/person-appearance.js');
const pixels = new Uint8ClampedArray(24 * 48 * 4);
for (let i = 0; i < 24 * 48; i++) pixels.set([...(i < 576 ? [210, 40, 40] : [40, 50, 180]), 255], i * 4);
const clothing = appearance.describe(pixels, 24, 48);
const body = (confidence = .9, x = .35) => ({ confidence, box: { x, y: .1, width: .3, height: .6 }, appearance: clothing });
const face = t => ({ id: 'QT-001', registered: true, confidence: .9, capturedAt: t, box: { x: .44, y: .15, width: .12, height: .12 } });
function rig() {
  const follower = new PersonFollower(); follower.select('QT-001');
  const step = (t, overrides = {}) => follower.update({ people: [body()], faces: [face(t)], capturedAt: t, now: t, ...overrides });
  return { follower, step };
}
function running() {
  const r = rig(); r.step(1000); r.step(1200);
  assert.equal(r.step(1400).command, 'FRENTE'); return r;
}

test('a 550 ms observation interval inside the freshness budget does not reacquire every frame', () => {
  const { step } = running();
  for (let t = 1950; t < 6000; t += 550) assert.equal(step(t).command, 'FRENTE');
});
test('small confidence oscillations do not cause a repeated identify/stop cycle', () => {
  const { step } = running();
  for (let t = 1500; t < 6500; t += 100) {
    const confidence = t % 500 < 300 ? .53 : .9;
    assert.equal(step(t, { people: [body(confidence)] }).command, 'FRENTE', `t=${t}`);
  }
});
test('weak detections cannot acquire a new identity', () => {
  const { step } = rig();
  for (let t = 1000; t <= 3000; t += 100) assert.equal(step(t, { people: [body(.53)] }).command, 'PARAR');
});
test('weak detections must return to strong confidence within 500 ms', () => {
  const { step } = running();
  for (let t = 1500; t <= 1900; t += 100) assert.equal(step(t, { people: [body(.53)] }).command, 'FRENTE');
  assert.equal(step(2000, { people: [body(.53)] }).command, 'PARAR');
});
test('weak detection with a changed outfit and no face cannot inherit identity', () => {
  const { step } = running();
  assert.equal(step(1500, { people: [{ ...body(.53), appearance: null }], faces: [] }).command, 'PARAR');
});
test('weak detection with a discontinuous position never keeps motion', () => {
  assert.equal(running().step(1500, { people: [body(.53, .1)], faces: [] }).command, 'PARAR');
});
test('low-confidence overlapping competitor still stops a selected strong body', () => {
  assert.equal(running().step(1500, { people: [body(), body(.53, .4)] }).command, 'PARAR');
});
test('confidence below the detector floor never keeps motion', () => {
  assert.equal(running().step(1500, { people: [body(.49)] }).command, 'PARAR');
});
test('back-facing continuity uses confirmed clothing through brief weak detections', () => {
  const { step } = running();
  for (let t = 1500; t < 5500; t += 100) {
    const confidence = t % 500 < 300 ? .53 : .9;
    assert.equal(step(t, { people: [body(confidence)], faces: [] }).state, 'APPEARANCE_TRACKING');
  }
});
test('a cached face without matching clothes cannot authorize weak body continuation', () => {
  const { step } = running();
  step(1700); step(2000);
  assert.equal(step(2200, { people: [{ ...body(.53), appearance: null }], faces: [face(1400)] }).command, 'PARAR');
});
test('a similar-clothed weak competitor cannot be discarded to make continuation look unique', () => {
  const { step } = running();
  assert.equal(step(1500, { people: [body(), { ...body(.53, .75), box: { x: .75, y: .1, width: .2, height: .6 } }], faces: [] }).command, 'PARAR');
});
test('observation freshness boundary is inclusive at 600 ms and stops after it', () => {
  assert.equal(running().step(2000).command, 'FRENTE');
  assert.equal(running().step(2001).command, 'PARAR');
  assert.equal(running().step(1600, { now: 2201 }).command, 'PARAR');
});

const source = fs.readFileSync(path.join(__dirname, '../web/person-follow.js'), 'utf8');
const watchdog = source.slice(source.indexOf('  const watchdog ='), source.indexOf('  window.addEventListener("quantum:face-observations"'));
function poll(follower, now) {
  const output = [];
  const context = { performance: { now: () => now }, enabled: () => true, worker: {}, ready: true,
    enrolling: false, pending: { capturedAt: 1800 }, lastFrameAt: 1400,
    follower, directFaceReady: () => false, movingCamera: () => false, publish: r => output.push(r), fail: assert.fail,
    control: { state: { robot: { connected: false } } },
    updateCount() {}, updateSensor() {}, setInterval: callback => callback() };
  vm.runInNewContext(watchdog, context);
  return output;
}
test('watchdog stops an old decision without deleting evidence for a pending fresh frame', () => {
  const { follower, step } = running();
  const result = poll(follower, 2050);
  assert.equal(result.at(-1).command, 'PARAR');
  assert.equal(result.at(-1).visible, false);
  assert.equal(step(1800, { now: 2050, faces: [] }).state, 'APPEARANCE_TRACKING');
});
test('watchdog never extends motion and cannot bridge a true observation gap', () => {
  const { follower, step } = running();
  for (const now of [2050, 2200, 2600]) assert.equal(poll(follower, now).at(-1).command, 'PARAR');
  assert.equal(step(2500, { now: 2650, faces: [] }).command, 'PARAR');
  assert.equal(step(2700, { faces: [] }).command, 'PARAR');
});
