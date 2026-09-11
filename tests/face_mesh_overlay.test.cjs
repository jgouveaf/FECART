'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { draw } = require('../web/face-mesh-overlay.js');
function rig() {
  const calls = [];
  const ctx = Object.fromEntries(['clearRect', 'save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke']
    .map(key => [key, (...args) => calls.push([key, ...args])]));
  const mesh = Array.from({ length: 468 }, (_, i) => [100 + i, 50 + i, 0]);
  return { calls, ctx, mesh };
}
test('draws mirrored model edges once without boxes, labels or extra inference', () => {
  const { calls, ctx, mesh } = rig();
  draw(ctx, [{ mesh }], [0, 1, 2, 2, 1, 3], 640, 480);
  assert.equal(calls.filter(c => c[0] === 'lineTo').length, 5);
  assert.deepEqual(calls.find(c => c[0] === 'moveTo'), ['moveTo', 540, 50]);
  assert.deepEqual(calls.find(c => c[0] === 'lineTo'), ['lineTo', 539, 51]);
  assert.equal(calls.filter(c => c[0] === 'stroke').length, 1);
});
test('empty, missing or incomplete mesh clears previous face without inventing a square', () => {
  for (const faces of [[], [{}], [{ mesh: [[10, 20]] }]]) {
    const { calls, ctx } = rig(); draw(ctx, faces, [0, 1, 2], 640, 480);
    assert.deepEqual(calls[0], ['clearRect', 0, 0, 640, 480]);
    assert.equal(calls.filter(c => c[0] === 'lineTo').length, 0);
  }
});
test('invalid topology and non-finite points cannot poison the canvas', () => {
  const { calls, ctx, mesh } = rig(); mesh[0] = [NaN, 1]; mesh[1] = null;
  draw(ctx, [{ mesh }], [0, 1, 2, -1, 5, 6, 468, 5, 6], 640, 480);
  assert.equal(calls.filter(c => c[0] === 'lineTo').length, 0);
});
test('missing runtime topology still clears the overlay', () => {
  const { calls, ctx, mesh } = rig(); draw(ctx, [{ mesh }], undefined, 640, 480);
  assert.deepEqual(calls, [['clearRect', 0, 0, 640, 480]]);
});
