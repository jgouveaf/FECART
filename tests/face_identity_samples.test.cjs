'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeSamples, chooseIdentity } = require('../web/face-identity-math.js');
const sample = n => Array(1024).fill(n);
test('a still person keeps five captured samples and can satisfy recognition', () => {
  const saved = mergeSamples([], Array.from({ length: 5 }, () => sample(1)));
  assert.equal(saved.length, 5);
  assert.equal(chooseIdentity([{ identity: { id: 'QT-001' }, scores: saved.map(() => .95) }]).accepted, true);
});
test('importing the same backup repeatedly does not multiply samples', () => {
  const a = [sample(1), sample(1), sample(2), sample(3), sample(3)];
  const once = mergeSamples(a, a); assert.deepEqual(once, a);
  assert.deepEqual(mergeSamples(once, a), a);
});
test('completing an old deduplicated record restores its captured sample count', () => {
  assert.equal(mergeSamples([sample(1)], Array.from({ length: 5 }, () => sample(1))).length, 5);
});
test('merge preserves differing samples, rejects invalid numbers and respects the existing cap', () => {
  const bad = sample(1); bad[10] = NaN;
  const samples = mergeSamples(Array.from({ length: 12 }, (_, i) => sample(i)), [sample(12), sample(13), sample(14), sample(15), bad, [1]]);
  assert.equal(samples.length, 15); assert.equal(samples.at(-1)[0], 15);
});
