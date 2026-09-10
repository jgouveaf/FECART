'use strict';
// Exercise the actual scheduling function with deterministic time, no inference/IO.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../web/face-identities.js'), 'utf8');
const schedule = source.slice(source.indexOf('  function scheduleDetection('), source.indexOf('  async function startIdentification('));
async function nextDelay(overrides = {}) {
  let now = 0, task, delay;
  const context = { cameraActive: true, activeView: 'face', inferenceSuspended: false, detectionTimer: 0,
    nextDetectionDelayMs: 70, DETECTION_DELAY_MS: 70, registering: false, consecutiveInferenceErrors: 0,
    control: { state: { mode: { id: 2, phase: 'ACTIVE' } } }, performance: { now: () => now },
    clearTimeout() {}, window: { setTimeout(fn, ms) { task = fn; delay = ms; return 1; } },
    detectFaces: async () => { now += 200; }, ...overrides };
  vm.createContext(context); vm.runInContext(schedule + '\nscheduleDetection();', context);
  assert.equal(delay, context.nextDetectionDelayMs);
  await task(); return delay;
}
test('Mode 2 avoids an extra 70 ms pause after a slow successful face inference', async () => assert.equal(await nextDelay(), 20));
test('fast Mode 2 inference still respects the minimum start interval', async () => assert.equal(await nextDelay({ detectFaces: async () => {} }), 70));
test('registration retains its existing cadence', async () => assert.equal(await nextDelay({ registering: true }), 70));
test('other modes retain their existing cadence', async () => {
  for (const id of [1, 3]) assert.equal(await nextDelay({ control: { state: { mode: { id, phase: 'ACTIVE' } } } }), 70);
});
test('inference errors retain recovery backoff', async () => assert.equal(await nextDelay({ consecutiveInferenceErrors: 1, nextDetectionDelayMs: 500 }), 500));
