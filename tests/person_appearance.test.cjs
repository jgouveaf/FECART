'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const appearance = require('../web/person-appearance.js');
const { PersonFollower } = require('../web/person-follow-math.js');
function pixels(top = [220, 30, 30], bottom = [30, 50, 170]) {
  const rgba = new Uint8ClampedArray(24 * 48 * 4);
  for (let i = 0; i < 24 * 48; i++) rgba.set([...(i < 24 * 24 ? top : bottom), 255], i * 4);
  return rgba;
}
const redBlue = appearance.describe(pixels(), 24, 48);
const greenBlue = appearance.describe(pixels([30, 220, 30]), 24, 48);
function rig(descriptor = redBlue) {
  const f = new PersonFollower(); f.select('QT-001');
  const body = (x = .35, app = descriptor) => ({ confidence: .9, box: { x, y: .1, width: .3, height: .6 }, appearance: app });
  const face = t => ({ id: 'QT-001', registered: true, confidence: .9, capturedAt: t, box: { x: .44, y: .15, width: .12, height: .12 } });
  const step = (t, extra = {}) => f.update({ people: [body()], faces: [face(t)], now: t, capturedAt: t, ...extra });
  return { f, step, body, face };
}
function trained() { const r = rig(); r.step(1000); r.step(1200); assert.equal(r.step(1400).appearanceReady, true); return r; }
test('descriptor compares clothing with moderate exposure changes', () => {
  const dimmer = appearance.describe(pixels([170, 23, 23], [23, 38, 131]), 24, 48);
  assert.ok(appearance.valid(redBlue)); assert.ok(appearance.similarity(redBlue, dimmer) >= .88);
  assert.ok(appearance.similarity(redBlue, greenBlue) < .88);
});
test('matching upper clothes cannot hide a different lower body', () => {
  const redGreen = appearance.describe(pixels([220, 30, 30], [30, 220, 30]), 24, 48);
  assert.ok(appearance.similarity(redBlue, redGreen) < .88);
});
for (const [before, after] of [[63, 64], [127, 128], [191, 192]]) {
  test(`neutral clothing stays compatible across brightness boundary ${before}/${after}`, () => {
    const a = appearance.describe(pixels([before, before, before]), 24, 48);
    const b = appearance.describe(pixels([after, after, after]), 24, 48);
    assert.ok(appearance.similarity(a, b) > .99);
  });
}
test('same hue with very different brightness is not the same clothing evidence', () => {
  const darkRed = appearance.describe(pixels([60, 8, 8]), 24, 48);
  assert.ok(appearance.similarity(redBlue, darkRed) < .82);
});
test('white and black clothes remain distinct', () => {
  const white = appearance.describe(pixels([235, 235, 235]), 24, 48);
  const black = appearance.describe(pixels([20, 20, 20]), 24, 48);
  assert.ok(appearance.similarity(white, black) < .82);
});
test('invalid or transparent samples cannot provide continuity evidence', () => {
  for (const bad of [null, [], Array(40).fill(.05), Array(56).fill(NaN), Array(56).fill(0), Array(56).fill(1), Array(56).fill(-1)]) {
    assert.equal(appearance.valid(bad), false); assert.equal(appearance.similarity(redBlue, bad), 0);
  }
  assert.equal(appearance.describe(new Uint8ClampedArray(24 * 48 * 4), 24, 48), null);
});
test('continuous moving body and clothing retain target for one minute without face', () => {
  const { step, body } = trained(); const commands = new Set();
  for (let t = 1600; t < 62000; t += 200) {
    const width = .25 + .05 * Math.cos(t / 2000), x = .5 + .2 * Math.sin((t - 1600) / 3000);
    const movingBody = body(); movingBody.box = { x: x - width / 2, y: .1, width, height: .6 };
    const result = step(t, { faces: [], people: [movingBody] });
    assert.equal(result.state, 'APPEARANCE_TRACKING'); assert.equal(result.id, 'QT-001'); assert.notEqual(result.command, 'PARAR');
    commands.add(result.command);
  }
  assert.deepEqual([...commands].sort(), ['DIREITA', 'ESQUERDA', 'FRENTE']);
});
test('cached face cannot train a clothing template', () => {
  const { step, face } = rig(); step(1000);
  assert.equal(step(1200, { faces: [face(1000)] }).appearanceReady, false);
  assert.equal(step(1400, { faces: [face(1000)] }).appearanceReady, false);
  for (let t = 1600; t <= 4000; t += 200) step(t, { faces: [] });
  assert.equal(step(4200, { faces: [] }).command, 'PARAR');
});
test('a different outfit at the same location stops instead of inheriting ID', () => {
  const { step, body } = trained();
  assert.equal(step(1600, { faces: [], people: [body(.35, greenBlue)] }).state, 'REIDENTIFY');
  assert.equal(step(1800, { faces: [] }).command, 'PARAR');
});
test('two people with similar clothing stop even without overlapping boxes', () => {
  const { step, body } = trained();
  assert.equal(step(1600, { faces: [], people: [body(), body(.7)] }).state, 'AMBIGUOUS');
});
test('distinct distant clothes do not interrupt a continuous target', () => {
  const { step, body } = trained();
  assert.equal(step(1600, { faces: [], people: [body(), body(.7, greenBlue)] }).state, 'APPEARANCE_TRACKING');
});
test('loss requires a new face; matching clothes cannot reacquire the target', () => {
  const { step, face } = trained();
  assert.equal(step(1600, { faces: [], people: [] }).dropout, true);
  // Loss must outlast the existing 450 ms facial dropout grace.
  assert.equal(step(2000, { faces: [], people: [] }).command, 'PARAR');
  assert.equal(step(2200, { faces: [] }).command, 'PARAR');
  assert.equal(step(2400, { faces: [face(1400)] }).command, 'PARAR');
  assert.equal(step(2600).state, 'CONFIRMING');
  assert.equal(step(2800).command, 'FRENTE');
});
test('delayed facial inference can reacquire after repeated missing observations', () => {
  const { step, face } = trained(); step(2000, { people: [], faces: [] }); step(2200, { faces: [] });
  assert.equal(step(2400, { faces: [face(2100)] }).state, 'CONFIRMING');
  assert.equal(step(2600, { faces: [face(2300)] }).command, 'FRENTE');
});
test('missing descriptor keeps the existing three-second bound', () => {
  const { step, body } = trained();
  for (let t = 1600; t <= 4400; t += 200) step(t, { faces: [], people: [body(.35, null)] });
  assert.equal(step(4600, { faces: [], people: [body(.35, null)] }).command, 'PARAR');
});
test('body-only evidence never updates the face-verified template', () => {
  const { f, step } = trained(); const reference = [...f.appearanceReference];
  for (let t = 1600; t <= 5000; t += 200) step(t, { faces: [] });
  assert.deepEqual(f.appearanceReference, reference); assert.equal(f.identifiedAt, 1400);
});
test('a cached face cannot replace the clothing reference with a later body sample', () => {
  const { f, step, body, face } = trained();
  assert.equal(step(1600, { faces: [face(1400)], people: [body(.35, greenBlue)] }).command, 'PARAR');
  assert.equal(f.appearanceReference, null);
  assert.equal(step(1800, { faces: [], people: [body(.35, greenBlue)] }).command, 'PARAR');
});
test('extended continuation still stops for obstacle, stale sensor and frozen image', () => {
  for (const condition of [{ requireSensor: true, distance: 25, sensorAgeMs: 0 }, { requireSensor: true, distance: 60, sensorAgeMs: 900 }, { capturedAt: 1400 }]) {
    const { step } = trained(); assert.equal(step(1600, { faces: [], ...condition }).command, 'PARAR');
  }
});
test('changing target clears clothing evidence', () => {
  const { f, step } = trained(); f.select('QT-002'); assert.equal(f.appearanceReference, null);
  assert.equal(step(1600, { faces: [] }).command, 'PARAR');
});
