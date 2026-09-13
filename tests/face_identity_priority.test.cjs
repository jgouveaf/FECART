'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function rig() {
  let now = 1000, meshes = 0;
  const context2d = { drawImage() {}, fillRect() {}, getImageData: () => ({ data: new Uint8ClampedArray(320 * 320 * 4), width: 320, height: 320 }) };
  const scope = { self: {}, performance: { now: () => now }, OffscreenCanvas: class { getContext() { return context2d; } },
    ort: { Tensor: class { dispose() {} } },
    QuantumFaceONNXMath: { ENGINE: 'test-engine',
      decode: () => [{ box: [10, 10, 40, 40], keypoints: [[20, 20], [40, 20], [30, 30]] }],
      alignedRGB: () => new Float32Array(3 * 112 * 112), normalized: () => Array(128).fill(.1) } };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/face-onnx-engine.js'), 'utf8'), scope);
  const engine = new scope.self.QuantumFaceONNXEngine();
  engine.detectorCanvas = new scope.OffscreenCanvas();
  engine.detector = { inputNames: ['in'], outputNames: ['out'], async run() { now += 20; return { out: { dispose() {} } }; } };
  engine.recognizer = { inputNames: ['in'], outputNames: ['out'], async run() { now += 50; return { out: { data: [], dispose() {} } }; } };
  engine.mesh = { detect() { now += 40; meshes++; return { faceLandmarks: [] }; } };
  return { engine, bitmap: { width: 320, height: 320 }, meshes: () => meshes, advance: ms => { now += ms; } };
}

test('tracking publishes measured identity before optional mesh work', async () => {
  const r = rig(); let identity;
  const complete = await r.engine.detect(r.bitmap, result => {
    assert.equal(r.meshes(), 0);
    assert.equal(result.face[0].embedding.length, 128);
    identity = result;
  });
  assert.equal(identity.performance.total, 70);
  assert.equal(complete.performance.total, 110);
  assert.equal(r.meshes(), 1);
});

test('visual throttling never skips recognition and enrollment always gets the full result', async () => {
  const r = rig(); let identities = 0;
  const accept = () => { identities++; };
  await r.engine.detect(r.bitmap, accept);
  const second = await r.engine.detect(r.bitmap, accept);
  assert.equal(second.meshUpdated, false); assert.equal(r.meshes(), 1); assert.equal(identities, 2);
  r.advance(450); await r.engine.detect(r.bitmap, accept);
  assert.equal(r.meshes(), 2); assert.equal(identities, 3);
  await r.engine.detect(r.bitmap);
  assert.equal(r.meshes(), 3);
});

test('recognition failure cannot publish identity or fallback to visual geometry', async () => {
  const r = rig(); let published = false;
  r.engine.recognizer.run = async () => { throw Error('recognizer failure'); };
  await assert.rejects(r.engine.detect(r.bitmap, () => { published = true; }), /recognizer failure/);
  assert.equal(published, false); assert.equal(r.meshes(), 0);
});
