'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FacePresenceValidator } = require('../web/face-presence.js');
const embedding = (id = 1) => Array(1024).fill(id);
function rig() {
  const validator = new FacePresenceValidator({ similarity: (a, b) => a[0] === b[0] ? .99 : .1 });
  const step = (t, changes = {}, now = t) => validator.update({ capturedAt: t, eligible: true,
    box: [100, 80, 180, 180], embedding: embedding(), real: .1, live: .1, yaw: 0, ...changes }, now);
  return { validator, step };
}
function approved() {
  const r = rig(); r.step(1000, { real: .9, live: .9 });
  assert.equal(r.step(1200, { real: .9, live: .9 }).accepted, true);
  return r;
}
function movement(r, start = 1200, sign = 1) {
  let result;
  for (const yaw of [0, .23 * sign, 0]) {
    r.step(start, { yaw }); result = r.step(start + 140, { yaw }); start += 240;
  }
  return result;
}
test('automatic presence needs two observations spaced by at least 180 ms', () => {
  const { step } = rig();
  assert.equal(step(1000, { real: .8, live: .8 }).accepted, false);
  assert.equal(step(1100, { real: .8, live: .8 }).accepted, false);
  assert.equal(step(1180, { real: .8, live: .8 }).method, 'AUTO');
});
test('confirmed presence remains valid through score oscillations during capture', () => {
  const { step } = approved();
  for (let t = 1300; t < 6000; t += 100) assert.equal(step(t).accepted, true);
});
for (const change of [{ eligible: false }, { embedding: embedding(2) }, { box: [800, 80, 180, 180] },
  { embedding: [] }, { capturedAt: 1200 }, { capturedAt: NaN }, { box: [0, 0, NaN, 20] }]) {
  test(`presence invalidates when evidence is lost or changed: ${JSON.stringify(change).slice(0, 60)}`, () => {
    assert.equal(approved().step(1400, change).accepted, false);
  });
}
test('presence cannot bridge a stale or missing camera interval', () => {
  assert.equal(approved().step(2100).accepted, false);
  assert.equal(approved().step(1500, {}, 2301).accepted, false);
});
test('confirmation allows time to enter a name but expires after 30 seconds', () => {
  const { step } = approved();
  for (let t = 1300; t <= 31200; t += 100) assert.equal(step(t).accepted, true);
  assert.equal(step(31300).accepted, false);
});
test('persistently low model scores never auto-approve or falsely report a live face', () => {
  const { step } = rig();
  let result;
  for (let t = 1000; t < 10000; t += 100) { result = step(t); assert.equal(result.accepted, false); }
  assert.match(result.message, /Confirmar por movimento/);
});
for (const sign of [1, -1]) test(`guided confirmation works with either initial turn direction ${sign}`, () => {
  const r = rig(); r.step(1000); assert.equal(r.validator.beginGuided(1000), true);
  const result = movement(r, 1200, sign);
  assert.equal(result.accepted, true); assert.equal(result.method, 'MOVEMENT');
});
test('movement does not authorize enrollment unless explicitly started', () => {
  const r = rig(); r.step(1000);
  assert.equal(movement(r).accepted, false);
});
test('holding the head still never completes the guided sequence', () => {
  const r = rig(); r.step(1000); r.validator.beginGuided(1000);
  for (let t = 1200; t <= 16000; t += 200) assert.equal(r.step(t).accepted, false);
  assert.equal(r.step(16200).state, 'TIMEOUT');
  assert.equal(r.validator.beginGuided(16200), true);
  assert.equal(movement(r, 16400).accepted, true);
});
test('one frame spikes and never returning to center cannot complete the challenge', () => {
  const r = rig(); r.step(1000); r.validator.beginGuided(1000);
  for (let t = 1100; t < 8000; t += 100) assert.equal(r.step(t, { yaw: t % 300 ? 0 : .25 }).accepted, false);
  for (let t = 8100; t < 12000; t += 150) assert.equal(r.step(t, { yaw: .23 }).accepted, false);
});
test('new face cannot inherit a guided sequence already in progress', () => {
  const r = rig(); r.step(1000); r.validator.beginGuided(1000);
  r.step(1100); r.step(1250); r.step(1350, { yaw: .23 }); r.step(1500, { yaw: .23 });
  assert.equal(r.step(1600, { embedding: embedding(2) }).accepted, false);
  assert.equal(r.validator.guidedAt, null);
});
test('invalid pose cannot complete movement confirmation', () => {
  const r = rig(); r.step(1000); r.validator.beginGuided(1000);
  for (let t = 1100; t < 5000; t += 200) assert.equal(r.step(t, { yaw: undefined }).accepted, false);
});
test('a stale button click cannot start a challenge from old camera evidence', () => {
  const r = rig(); r.step(1000); assert.equal(r.validator.beginGuided(1801), false);
});
