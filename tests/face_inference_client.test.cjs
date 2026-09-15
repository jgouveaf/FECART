'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../web/face-inference-client.js'), 'utf8');
function rig() {
  const workers = [], timers = new Map(); let serial = 0;
  const context = { window: {}, performance, document: { baseURI: 'http://localhost/' }, URL,
    setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); },
    createImageBitmap: async () => ({ closed: 0, close() { this.closed++; } }),
    Worker: class {
      constructor() { this.messages = []; this.terminated = false; workers.push(this); }
      postMessage(message) { this.messages.push(message); }
      terminate() { this.terminated = true; }
      reply(data) { this.onmessage({ data: { id: this.messages.at(-1).id, ...data } }); }
    } };
  vm.createContext(context); vm.runInContext(source, context);
  const client = new context.window.QuantumFaceInference.FaceInferenceClient();
  const ready = async () => { const loaded = client.load({}); workers.at(-1).reply({ type: 'ready' }); await loaded; };
  return { client, workers, timers, context, ready };
}
const cfg = { filter: { width: 640, height: 360 } };
test('simultaneous model loads share one worker and one request', async () => {
  const r = rig(), first = r.client.load({}), second = r.client.load({});
  assert.equal(first, second); assert.equal(r.workers.length, 1);
  r.workers[0].reply({ type: 'ready' }); await first;
  assert.equal(r.client.ready, true); assert.equal(r.timers.size, 0);
});
test('one image in flight; additional calls cannot queue stale frames', async () => {
  const r = rig(); await r.ready(); const pending = r.client.detect({}, cfg);
  await assert.rejects(r.client.detect({}, cfg), /ocupado/);
  await new Promise(setImmediate);
  const w = r.workers[0]; assert.equal(w.messages.length, 2);
  w.reply({ result: { face: [], gesture: [] } }); const result = await pending;
  assert.equal(result.face.length, 0); assert.equal(r.client.capturing, false); assert.equal(r.timers.size, 0);
});
test('worker timeout cancels the request and terminates the stalled worker', async () => {
  const r = rig(); await r.ready(); const pending = r.client.detect({}, cfg); await new Promise(setImmediate);
  const rejected = assert.rejects(pending, /esgotado/);
  [...r.timers.values()][0](); await rejected;
  assert.equal(r.client.ready, false); assert.equal(r.workers[0].terminated, true);
  await r.ready(); assert.equal(r.client.ready, true);
});
test('closing while a bitmap is being captured does not send it to a restarted worker', async () => {
  const r = rig(); await r.ready(); let finish;
  const bitmap = { closed: 0, close() { this.closed++; } };
  r.context.createImageBitmap = () => new Promise(resolve => { finish = resolve; });
  const pending = r.client.detect({}, cfg); r.client.close(); await r.ready(); finish(bitmap);
  await assert.rejects(pending, /cancelada/);
  assert.equal(bitmap.closed, 1); assert.equal(r.workers[1].messages.length, 1);
});
test('late messages from a terminated worker cannot satisfy new requests', async () => {
  const r = rig(); await r.ready(); const old = r.workers[0]; r.client.close();
  const loading = r.client.load({}); const current = r.workers[1];
  old.onmessage({ data: { id: current.messages[0].id, type: 'ready' } });
  assert.equal(r.client.ready, false); current.reply({ type: 'ready' }); await loading;
  assert.equal(r.client.ready, true);
});
test('model errors reject the frame instead of inventing observations', async () => {
  const r = rig(); await r.ready(); const pending = r.client.detect({}, cfg); await new Promise(setImmediate);
  r.workers[0].reply({ error: 'modelo falhou' }); await assert.rejects(pending, /modelo falhou/);
  assert.equal(r.timers.size, 0); assert.equal(r.client.capturing, false);
});

test('identity resolves before optional mesh; old mesh cannot finish another request', async () => {
  const r = rig(); await r.ready(); const meshes = []; r.client.onMesh = data => meshes.push(data.id);
  const first = r.client.detect({}, cfg); await new Promise(setImmediate);
  const worker = r.workers[0], firstId = worker.messages.at(-1).id;
  worker.reply({ type: 'result', result: { face: [{ embedding: [1] }] } });
  assert.equal((await first).frameId, firstId);
  const second = r.client.detect({}, cfg); await new Promise(setImmediate);
  const secondId = worker.messages.at(-1).id;
  worker.onmessage({ data: { id: firstId, type: 'mesh', faces: [] } });
  assert.equal(r.client.pending.id, secondId);
  assert.deepEqual(meshes, [firstId]);
  worker.reply({ type: 'result', result: { face: [] } }); await second;
  worker.onmessage({ data: { id: firstId, type: 'mesh', faces: [] } });
  assert.deepEqual(meshes, [firstId], 'Old geometry cannot overwrite the new frame');
  r.client.close(); worker.onmessage({ data: { id: secondId, type: 'mesh', faces: [] } });
  assert.deepEqual(meshes, [firstId], 'Closed camera/model cannot receive a visual update');
});

test('the CPU slot stays held through optional mesh and closes safely on cancellation',async()=>{
  const r=rig();let releases=0;
  r.context.window.QuantumVisionScheduler={acquire:async()=>()=>{releases++;}};
  const loading=r.client.load({identityEngine:'scrfd-sface-2021dec-v1'});
  r.workers[0].reply({type:'ready'});await loading;
  const promise=r.client.detect({},{...cfg,identityFirst:true});await new Promise(setImmediate);
  const worker=r.workers[0],id=worker.messages.at(-1).id;
  worker.reply({type:'result',result:{face:[]}});await promise;assert.equal(releases,0);
  worker.onmessage({data:{id,type:'mesh',faces:[]}});assert.equal(releases,0);
  worker.onmessage({data:{id,type:'complete'}});assert.equal(releases,1);
  worker.onmessage({data:{id,type:'complete'}});assert.equal(releases,1);
  const second=r.client.detect({},cfg);await new Promise(setImmediate);
  const rejected=assert.rejects(second,/encerrado/);r.client.close();await rejected;
  assert.equal(releases,2);
});
