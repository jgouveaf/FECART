'use strict';
// Run the production controller with virtual time and a slow fake worker.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const personMath = require('../web/person-follow-math.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../web/person-follow.js'), 'utf8');
function rig(latency = 120, selected = true) {
  let now = 1000, id = 0, inFlight = 0, maxInFlight = 0;
  const tasks = new Map(), listeners = {}, starts = [], elements = new Map(), watchdogs=[];
  const setTimeout = (callback, delay = 0) => { tasks.set(++id, { callback, at: now + delay }); return id; };
  const canvasContext = { clearRect() {}, strokeRect() {}, fillText() {} };
  function element(name) {
    if (!elements.has(name)) elements.set(name, { textContent: '', addEventListener() {},
      getContext: () => canvasContext, width: 960, height: 540 });
    return elements.get(name);
  }
  const video = element('cameraVideo');
  Object.assign(video, { readyState: 2, videoWidth: 960, videoHeight: 540 });
  Object.defineProperty(video, 'currentTime', { get: () => now / 1000 });
  const control = { state: { mode: { id: 2, phase: 'ACTIVE' }, robot: {}, safety: {} }, patch() {}, subscribe() {} };
  const context = { performance: { now: () => now }, setTimeout, clearTimeout: id => tasks.delete(id),
    setInterval: callback => { watchdogs.push(callback);return watchdogs.length; }, clearInterval() {}, URL,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    createImageBitmap: async () => ({ close() {} }),
    document: { baseURI: 'http://localhost/', hidden: false, getElementById: element, addEventListener() {} },
    window: { QuantumControl: control, QuantumPersonFollowMath: personMath,
      addEventListener(type, callback) { listeners[type] = callback; }, dispatchEvent() {} },
    Worker: class {
      postMessage(data) {
        if (data.type === 'init') { setTimeout(() => this.onmessage({ data: { type: 'ready' } })); return; }
        starts.push(now); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => { inFlight--; this.onmessage({ data: { type: 'result', id: data.id, capturedAt: data.capturedAt, people: [] } }); }, latency);
      }
      terminate() {}
    },
  };
  vm.createContext(context); vm.runInContext(source, context);
  if (selected) listeners['quantum:face-observations']({ detail: { selectedId: 'QT-001', faces: [] } });
  listeners['quantum:camera-started']();
  async function advance(until) {
    for (;;) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      tasks.delete(next[0]); now = next[1].at;
      await next[1].callback();
      // Drain cross-realm async bitmap continuations before advancing the clock.
      await new Promise(setImmediate);
    }
    now = until;
  }
  return { advance, starts, max: () => maxInFlight, stop: () => listeners['quantum:camera-stopped'](), context,
    delay:ms=>{latency=ms;},watchdog:()=>watchdogs.forEach(callback=>callback()),
    observe: faces => listeners['quantum:face-observations']({ detail: { selectedId: 'QT-001', faces } }) };
}
test('slow body inference resumes at completion without waiting for polling', async () => {
  const r = rig(120); await r.advance(1700);
  assert.deepEqual(r.starts, [1000, 1120, 1240, 1360, 1480, 1600]);
  assert.equal(r.max(), 1, 'Never queue a second image during inference');
});

test('camera without a selected target does not spend CPU on body inference', async () => {
  const r = rig(120, false); await r.advance(2000); assert.deepEqual(r.starts, []);
});
test('fast body inference retains a 100 ms minimum start interval', async () => {
  const r = rig(25); await r.advance(1350);
  assert.deepEqual(r.starts, [1000, 1100, 1200, 1300]); assert.equal(r.max(), 1);
});
test('fresh target faces reduce body CPU work, with fast cadence restored on loss', async () => {
  const r = rig(25);
  r.observe([{ id: 'QT-001', registered: true, capturedAt: 1000, confidence: .9,
    box: { x: .44, y: .15, width: .12, height: .16 } }]);
  await r.advance(1500); assert.deepEqual(r.starts, [1000, 1300]);
  r.observe([]); await r.advance(1850);
  assert.deepEqual(r.starts, [1000, 1300, 1600, 1700, 1800]);
  assert.equal(r.max(), 1);
});
test('fresh identity can command between body frames, but never after camera stop', async () => {
  const r = rig(25), face = capturedAt => [{ id: 'QT-001', registered: true, capturedAt, confidence: .9,
    box: { x: .44, y: .15, width: .12, height: .16 } }];
  r.observe(face(1000)); await r.advance(1130);
  assert.deepEqual(r.starts, [1000], 'The next body frame has not started');
  r.observe(face(1130));
  assert.equal(r.context.window.quantumPersonFollower.snapshot.command, 'FRENTE');
  r.stop(); await r.advance(1250); r.observe(face(1250));
  assert.equal(r.context.window.quantumPersonFollower.snapshot.command, 'PARAR');
});
test('a late worker reply after camera stop cannot schedule another image', async () => {
  const r = rig(120); await r.advance(1050); r.stop(); await r.advance(1600);
  assert.deepEqual(r.starts, [1000]);
});
test('a mode change during publication cannot restart the old frame loop', async () => {
  const r = rig(120); await r.advance(1050);
  r.context.window.dispatchEvent = () => r.stop();
  await r.advance(1700); assert.deepEqual(r.starts, [1000]);
});

test('a current identified face survives a slow empty body cycle, but stale video still stops',async()=>{
  const r=rig(25),face=capturedAt=>[{id:'QT-001',registered:true,capturedAt,confidence:.9,
    box:{x:.44,y:.15,width:.12,height:.16}}];
  r.observe(face(1000));await r.advance(1130);r.observe(face(1130));
  assert.equal(r.context.window.quantumPersonFollower.snapshot.command,'FRENTE');
  r.delay(1200);await r.advance(1650);r.observe(face(1650));r.watchdog();
  assert.equal(r.context.window.quantumPersonFollower.snapshot.command,'FRENTE','A torso timeout cannot cancel a newly measured face');
  await r.advance(2251);r.watchdog();
  assert.equal(r.context.window.quantumPersonFollower.snapshot.command,'PARAR','Old facial timestamps are never renewed by the scheduler');
  assert.equal(r.context.window.quantumPersonFollower.snapshot.state,'STALE_FRAME');
  r.stop();
});
