"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PersonFollower, validBox, overlap } = require("../web/person-follow-math.js");
const body = (x = .35, height = .6) => ({ confidence: .9, box: { x, y: .1, width: .3, height } });
const face = (now, x = .44, id = "QT-001") => ({ id, registered: true, confidence: .9, capturedAt: now, box: { x, y: .15, width: .12, height: .12 } });
function rig() {
  const f = new PersonFollower(); f.select("QT-001");
  const step = (t, overrides = {}) => f.update({ people: [body()], faces: [face(t)], now: t, capturedAt: t, ...overrides });
  return { f, step };
}
function running() { const r = rig(); r.step(1000); assert.equal(r.step(1200).command, "FRENTE"); return r; }
test("unselected/unknown identity never authorizes motion", () => {
  const { f, step } = rig(); f.select(null); assert.equal(step(1000).state, "SELECT_TARGET");
  f.select("other"); assert.equal(step(1200).command, "PARAR");
});
test("two fresh observations spanning 120 ms are required", () => {
  const { step } = rig(); assert.equal(step(1000).state, "CONFIRMING");
  assert.equal(step(1100).command, "PARAR"); assert.equal(step(1120).command, "FRENTE");
});
for (const [x, expected] of [[.05, "ESQUERDA"], [.35, "FRENTE"], [.65, "DIREITA"]]) {
  test(`unmirrored camera x=${x} requests ${expected}`, () => {
    const { step } = rig(), input = t => ({ people: [body(x)], faces: [face(t, x + .09)] });
    step(1000, input(1000)); assert.equal(step(1200, input(1200)).command, expected);
  });
}
test("short body-only continuity retains selected identity", () => {
  const { step } = running(); const s = step(1400, { faces: [] });
  assert.equal(s.state, "BODY_TRACKING"); assert.equal(s.id, "QT-001");
});
test("body continuity expires after three seconds without face evidence", () => {
  const { step } = running(); for (let t = 1400; t <= 4200; t += 200) assert.equal(step(t, { faces: [] }).command, "FRENTE");
  assert.equal(step(4400, { faces: [] }).command, "PARAR");
});
test("cached face cannot renew identity evidence time", () => {
  const { f, step } = running(); step(1400, { faces: [face(1200)] }); assert.equal(f.identifiedAt, 1200);
});
test("occlusion produces a bounded estimate but no motion", () => {
  const { f } = running(); const s = f.missing(1400);
  assert.equal(s.state, "PREDICTED_STOP"); assert.equal(s.command, "PARAR"); assert.equal(s.visible, false);
  assert.equal(s.prediction.estimated, true); assert.ok(s.prediction.x >= 0 && s.prediction.x <= 1);
  assert.equal(f.missing(1800).prediction, null);
});
test("rotation suppresses image-space prediction", () => { assert.equal(running().f.missing(1400, "TARGET_LOST", true).prediction, null); });
test("loss resets movement confirmation", () => {
  const { f, step } = running(); f.missing(1300); assert.equal(step(1400).state, "CONFIRMING"); assert.equal(step(1600).command, "FRENTE");
});
for (const change of [{ capturedAt: 1200 }, { capturedAt: 1000, now: 2000 }, { capturedAt: 2000 }, { capturedAt: NaN }, { now: NaN }]) {
  test(`stale/duplicate/invalid frame ${JSON.stringify(change)}`, () => {
    const { step } = running(); assert.equal(step(1400, change).command, "PARAR");
  });
}
for (const faces of [[], [face(0)], [face(2000)], [face(1000, .44, "QT-002")], [{ ...face(1000), registered: false }], [{ ...face(1000), confidence: NaN }]]) {
  test(`cannot acquire with invalid identity evidence ${JSON.stringify(faces)}`, () => {
    assert.equal(rig().step(1000, { faces }).command, "PARAR");
  });
}
test("duplicate same-ID faces are ambiguous", () => { assert.equal(running().step(1400, { faces: [face(1400), face(1400)] }).state, "AMBIGUOUS"); });
test("conflicting known face in selected body stops", () => { assert.equal(running().step(1400, { faces: [face(1400), face(1400, .5, "QT-002")] }).state, "AMBIGUOUS"); });
test("overlapping bodies never silently switch identity", () => { assert.equal(running().step(1400, { people: [body(), body(.4)] }).state, "AMBIGUOUS"); });
test("large discontinuous body jump cannot inherit target", () => { assert.equal(running().step(1400, { faces: [], people: [body(.01)] }).command, "PARAR"); });
test("changing selected person clears all motion history", () => {
  const { f, step } = running(); f.select("QT-002"); assert.equal(step(1400).command, "PARAR"); assert.equal(f.box, null);
});
for (const [distance, sensorAgeMs] of [[null, 0], [NaN, 0], [0, 0], [50, 701], [50, NaN], [50, -1], [50, Infinity]]) {
  test(`sensor invalid ${distance} age ${sensorAgeMs} blocks connected robot`, () => {
    assert.equal(running().step(1400, { requireSensor: true, distance, sensorAgeMs }).state, "SENSOR_WAIT");
  });
}
test("Mode 2 distance hysteresis stops at 30 and resumes at 40 cm", () => {
  const { step } = running(); const sensor = distance => ({ requireSensor: true, distance, sensorAgeMs: 0 });
  assert.equal(step(1400, sensor(30)).command, "PARAR"); assert.equal(step(1600, sensor(39)).command, "PARAR");
  assert.equal(step(1800, sensor(40)).command, "FRENTE");
});
test("large visual body stops even without serial; size hysteresis prevents chatter", () => {
  const { step } = running(); assert.equal(step(1400, { people: [body(.35, .8)] }).command, "PARAR");
  assert.equal(step(1600, { people: [body(.35, .7)] }).command, "PARAR"); assert.equal(step(1800).command, "FRENTE");
});
test("low confidence or invalid body boxes cannot initialize", () => {
  for (const p of [{ ...body(), confidence: .1 }, { ...body(), confidence: NaN }, { confidence: 1, box: { x: -1, y: 0, width: .3, height: .6 } }]) {
    assert.equal(rig().step(1000, { people: [p] }).command, "PARAR");
  }
  assert.equal(validBox({ x: 0, y: 0, width: Infinity, height: 1 }), false);
  assert.equal(overlap(body().box, body(.7).box), 0);
});
