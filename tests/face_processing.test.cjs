'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plan, restore } = require('../web/face-processing.js');
test('tracking caps input while keeping registration models out of the follow loop', () => {
  const p = plan({ width: 1280, height: 720, modeTwo: true, enrolling: false });
  assert.equal(p.config.filter.width, 640); assert.equal(p.config.filter.height, 360);
  assert.equal(p.config.identityFirst, true);
  for (const key of ['iris', 'antispoof', 'liveness']) assert.equal(p.config.face[key].enabled, false);
  assert.equal(p.config.face.detector.return, false);
  assert.equal(p.config.face.detector.minSize * p.scaleX, 70);
});
test('enrollment restores full resolution without re-enabling presence classifiers', () => {
  for (const flags of [{ modeTwo: true, enrolling: true }, { modeTwo: false, enrolling: false }]) {
    const p = plan({ width: 1280, height: 720, ...flags });
    assert.equal(p.config.filter.width, 1280); assert.equal(p.config.filter.height, 720);
    assert.equal(p.config.identityFirst, false);
    for (const key of ['iris', 'antispoof', 'liveness']) assert.equal(p.config.face[key].enabled, false);
  }
});
test('small and portrait cameras keep their aspect ratio and are never upscaled', () => {
  const small = plan({ width: 320, height: 240, modeTwo: true });
  assert.equal(small.scaleX, 1); assert.equal(small.scaleY, 1);
  const portrait = plan({ width: 720, height: 1280, modeTwo: true });
  assert.equal(portrait.config.filter.width, 360); assert.equal(portrait.config.filter.height, 640);
});
test('landmarks and face bounds return to video coordinates without mutating cached results', () => {
  const f = { box: [100, 50, 80, 90], mesh: [[120, 70, -10]], embedding: [1, 2], rotation: { angle: { yaw: .2 } } };
  const original = structuredClone(f), first = restore(f, 2, 2), second = restore(f, 2, 2);
  assert.deepEqual(first.box, [200, 100, 160, 180]); assert.deepEqual(first.mesh, [[240, 140, -20]]);
  assert.equal(first.embedding, f.embedding); assert.equal(first.rotation, f.rotation);
  assert.deepEqual(f, original); assert.deepEqual(first, second);
});
