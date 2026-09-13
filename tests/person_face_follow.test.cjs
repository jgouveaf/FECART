'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PersonFollower, visiblePeople } = require('../web/person-follow-math.js');
const face = (t, x = .5, id = 'QT-001', height = .16) => ({ id, registered: true,
  confidence: .95, capturedAt: t, box: { x: x - .07, y: .15, width: .14, height } });
const body = { confidence: .9, box: { x: .32, y: .1, width: .36, height: .6 } };
function rig(x = .5) {
  const f = new PersonFollower(); f.select('QT-001');
  const step = (t, changes = {}) => f.update({ now: t, capturedAt: t, people: [], faces: [face(t, x)], ...changes });
  return { f, step };
}
function running(x = .5) { const r = rig(x); r.step(1000); r.step(1200); return r; }

for (const [x, command] of [[.25, 'ESQUERDA'], [.5, 'FRENTE'], [.75, 'DIREITA']]) {
  test(`selected visible face at ${x} drives ${command} without a body`, () => {
    const { f, step } = rig(x);
    assert.equal(step(1000).command, 'PARAR');
    const result = step(1200);
    assert.equal(result.command, command); assert.equal(result.state, 'FACE_TRACKING');
    assert.equal(result.trackingSource, 'face'); assert.equal(result.id, 'QT-001');
    assert.equal(result.visible, true); assert.equal(result.prediction, null);
    assert.equal(result.box, null); assert.equal(f.box, null, 'Never invent a body from the face');
  });
}
test('facial evidence observed with a body avoids reconfirming on intermittent empty body results', () => {
  const { step } = rig(); step(1000, { people: [body] }); step(1200, { people: [body] });
  assert.equal(step(1400).command, 'FRENTE');
  assert.equal(step(1500, { people: [body] }).command, 'FRENTE');
  assert.equal(step(1600).state, 'FACE_TRACKING');
});
test('no selected target or a different/unknown identity cannot drive', () => {
  const { f, step } = running(); f.select(null); assert.equal(step(1400).command, 'PARAR');
  f.select('QT-002'); assert.equal(step(1600).command, 'PARAR');
  f.select('QT-001');
  for (const t of [1800, 2000]) assert.equal(step(t, { faces: [{ ...face(t), registered: false }] }).command, 'PARAR');
});
test('one cached face observation never becomes two confirmations', () => {
  const { step } = rig(); step(1000);
  for (const t of [1100, 1300, 1500]) assert.equal(step(t, { faces: [face(1000)] }).command, 'PARAR');
});
test('two confirmations must span at least 120 ms', () => {
  const { step } = rig(); step(1000); assert.equal(step(1100).command, 'PARAR');
  assert.equal(step(1120).command, 'FRENTE');
});
test('cached face expires after 600 ms despite fresh body-worker frames', () => {
  const { step } = running();
  assert.equal(step(1700, { now: 1800, faces: [face(1200)] }).command, 'FRENTE');
  assert.equal(step(1701, { now: 1801, faces: [face(1200)] }).command, 'PARAR');
});
test('one isolated face dropout keeps the current face command briefly', () => {
  const { step } = running();
  const r = step(1400, { faces: [] });
  assert.equal(r.command, 'FRENTE'); assert.equal(r.visible, true); assert.equal(r.dropout, true);
  assert.equal(step(1701, { faces: [] }).command, 'PARAR');
});
test('face disappearing does not invent a body continuation', () => {
  const { step } = running();
  assert.equal(step(1400, { faces: [], people: [body] }).command, 'PARAR');
  assert.equal(step(1600, { faces: [], people: [body] }).command, 'PARAR');
});
test('a body that appears after direct face following needs its own acquisition', () => {
  const { step } = running(); assert.equal(step(1400, { people: [body] }).command, 'PARAR');
  assert.equal(step(1600, { people: [body] }).state, 'FOLLOWING');
  assert.equal(step(1800, { people: [body], faces: [] }).state, 'BODY_TRACKING');
});
test('a face jump or long gap requires new confirmations', () => {
  const r = running(); assert.equal(r.step(1400, { faces: [face(1400, .75)] }).command, 'PARAR');
  assert.equal(r.step(1600, { faces: [face(1600, .75)] }).command, 'DIREITA');
  assert.equal(r.step(2301, { faces: [face(2301, .75)] }).command, 'PARAR');
});
test('a second face, including an unknown person, stops direct tracking', () => {
  for (const id of ['QT-001', 'QT-002', 'TEMP-1']) {
    const { step } = running();
    assert.equal(step(1400, { faces: [face(1400), { ...face(1400, .75, id), registered: id !== 'TEMP-1' }] }).command, 'PARAR');
  }
});
test('invalid, future and low-confidence face evidence cannot drive', () => {
  for (const bad of [{ ...face(1400), confidence: NaN }, { ...face(1400), confidence: .1 },
    face(2000), { ...face(1400), box: { x: NaN, y: 0, width: .1, height: .1 } }]) {
    assert.equal(running().step(1400, { faces: [bad] }).command, 'PARAR');
  }
});
test('sensor invalidity and obstacles override direct face commands', () => {
  for (const [distance, sensorAgeMs] of [[null, 0], [0, 0], [NaN, 0], [60, 701], [60, -1], [60, NaN], [25, 0]]) {
    assert.equal(running().step(1400, { requireSensor: true, distance, sensorAgeMs }).command, 'PARAR');
  }
  const { step } = running();
  for (const [t, distance, command] of [[1400, 30, 'PARAR'], [1600, 39, 'PARAR'], [1800, 40, 'FRENTE']]) {
    assert.equal(step(t, { requireSensor: true, distance, sensorAgeMs: 0 }).command, command);
  }
});
test('a large face stops with separate size hysteresis', () => {
  const { step } = rig();
  const sample = (t, height) => step(t, { faces: [face(t, .5, 'QT-001', height)] });
  sample(1000, .4); assert.equal(sample(1200, .4).state, 'KEEP_DISTANCE');
  assert.equal(sample(1400, .36).command, 'PARAR');
  assert.equal(sample(1600, .33).command, 'FRENTE');
});
test('weak or conflicting bodies do not bypass the existing stop rules through the face path', () => {
  for (const people of [[{ ...body, confidence: .49 }], [body, { ...body }]]) {
    assert.equal(running().step(1400, { people }).command, 'PARAR');
  }
});
test('count includes faces before selection and does not double-count face and body', () => {
  assert.equal(visiblePeople([], [face(1000)], 1000), 1);
  assert.equal(visiblePeople([body], [face(1000)], 1000), 1);
  assert.equal(visiblePeople([body], [face(1000), face(1000, .85)], 1000), 2);
  assert.equal(visiblePeople([body], [face(1000), face(1000, .54)], 1000), 2);
  assert.equal(visiblePeople([], [face(1000)], 1801), 0);
  assert.equal(visiblePeople([], [face(2000)], 1000), 0);
});

test('a head classified as a partial person does not block face tracking or count twice', () => {
  const partial = { confidence: .9, box: { x: .425, y: .15, width: .15, height: .17 } };
  const { step } = rig(); step(1000, { people: [partial] });
  assert.equal(step(1200, { people: [partial] }).state, 'FACE_TRACKING');
  assert.equal(visiblePeople([partial], [face(1200)], 1200), 1);
  assert.equal(step(1400, { people: [partial, partial] }).command, 'PARAR');
});

test('an off-center target receives short curves separated by forward motion', () => {
  for (const [x, turn] of [[.25, 'ESQUERDA'], [.75, 'DIREITA']]) {
    const { step } = running(x), commands = [];
    for (let t = 1300; t <= 2700; t += 100) commands.push(step(t).command);
    assert.ok(commands.includes(turn)); assert.ok(commands.includes('FRENTE'));
    assert.ok(commands.every(c => c === turn || c === 'FRENTE'));
  }
});
test('steering hysteresis survives the forward part of a correction', () => {
  const { step } = running(.39);
  assert.equal(step(1400).command, 'FRENTE');
  assert.equal(step(1500, { faces: [face(1500, .42)] }).steering, 'ESQUERDA');
});
test('larger deviations get more curve time, while centered jitter stays straight', () => {
  const curves = x => {
    const { step } = running(x); let count = 0;
    for (let t = 1201; t < 2000; t += 50) if (step(t).command === 'ESQUERDA') count++;
    return count;
  };
  assert.ok(curves(.25) > curves(.39));
  const { step } = running();
  for (let t = 1300; t < 3000; t += 100) assert.equal(step(t, { faces: [face(t, t % 200 ? .47 : .53)] }).command, 'FRENTE');
});
test('losing the target or an obstacle stops during either phase of a curve', () => {
  for (const t of [1400, 1700]) {
    const loss = running(.25);
    loss.step(t, { faces: [] });
    assert.equal(loss.step(t + 501, { faces: [] }).command, 'PARAR');
    assert.equal(running(.25).step(t, { requireSensor: true, distance: 20, sensorAgeMs: 0 }).command, 'PARAR');
  }
});
