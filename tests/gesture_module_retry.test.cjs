const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../web/camera-gestures.js'), 'utf8');
const retrySource = source.slice(source.indexOf('  async function importGestureModule()'), source.indexOf('  async function loadModel()'));
function rig(importer) {
  const calls = [];
  const ctx = { URL, Date, document: { baseURI: 'https://example.test/FECART/' }, control: { log() {} }, setDetectorStatus() {}, importer: async url => { calls.push(url); return importer(url, calls.length); } };
  vm.createContext(ctx);
  vm.runInContext('let moduleImportAttempt = 0;\n' + retrySource.replace('import(moduleUrl)', 'importer(moduleUrl)'), ctx);
  return { load: () => ctx.importGestureModule(), calls };
}
test('failed module download retries on a new URL in the same origin', async () => {
  const h = rig((url, n) => { if (n === 1) throw new TypeError('Failed to fetch dynamically imported module'); return { HandLandmarker: 'ready' }; });
  assert.equal((await h.load()).HandLandmarker, 'ready');
  assert.equal(h.calls.length, 2);
  assert.notEqual(h.calls[0], h.calls[1]);
  for (const url of h.calls) assert.equal(new URL(url).pathname, '/FECART/web/vendor/mediapipe/vision_bundle.js');
  assert.equal(new URL(h.calls[1]).origin, 'https://example.test');
});
test('persistent download failure is bounded and manual retry uses fresh URLs', async () => {
  const h = rig(() => { throw new TypeError('Failed to fetch dynamically imported module'); });
  await assert.rejects(h.load(), /Confira a conexão/);
  assert.equal(h.calls.length, 2);
  await assert.rejects(h.load(), /Confira a conexão/);
  assert.equal(new Set(h.calls).size, 4);
});
test('syntax and initialization errors are not retried as network failures', async () => {
  const error = new SyntaxError('Unexpected token');
  const h = rig(() => { throw error; });
  await assert.rejects(h.load(), e => e === error);
  assert.equal(h.calls.length, 1);
});
