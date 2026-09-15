'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FaceIdentityTracker } = require('../web/face-identity-math.js');
const profiles = require('../web/face-identity-profiles.js');
const { cosine } = require('../web/face-onnx-math.js');
const { PersonFollower } = require('../web/person-follow-math.js');
const target = { id: 'QT-001' }, rival = { id: 'QT-002' };
const box = { x: .43, y: .15, width: .14, height: .16 };
function rig(engine = profiles.ONNX) {
  const tracker = new FaceIdentityTracker(), follower = new PersonFollower(); follower.select(target.id);
  const profile = profiles.profile(engine);
  return { tracker, read(t, score = .6, overrides = {}) {
    const input = { candidates: [{ identity: target, scores: [score, score, score] }], profile,
      box, capturedAt: t, now: t + 50, single: true, confidence: .95, referenceSimilarity: .96, ...overrides };
    const result = tracker.update(input);
    const motion = follower.update({ people: [], faces: [{ id: result.identity?.id || 'TEMP-01',
      registered: result.accepted, box: input.box, capturedAt: input.capturedAt, confidence: .95 }],
      now: input.now, capturedAt: input.capturedAt });
    return { ...result, motion };
  } };
}
test('near-threshold facial readings retain a confirmed target and forward motion', () => {
  const r = rig();
  assert.equal(r.read(1000).motion.command, 'PARAR');
  assert.equal(r.read(1200).motion.command, 'FRENTE');
  for (const [t, score] of [[1400,.48],[1600,.47],[1800,.55],[2000,.49]]) {
    const result = r.read(t, score);
    assert.equal(result.accepted, true);
    assert.equal(result.motion.command, 'FRENTE');
    assert.equal(result.reason, score < .5 ? 'SESSION_MATCH' : 'MATCH');
  }
});
test('a live reference confirms each fresh frame without an 800 ms gallery expiry', () => {
  const r = rig();
  assert.equal(r.read(1000).captureReference, false);
  assert.equal(r.read(1200).captureReference, true);
  for (let t = 1400; t <= 61400; t += 200) {
    const result = r.read(t, .48);
    assert.equal(result.reason, 'SESSION_MATCH');
    assert.equal(result.motion.command, 'FRENTE');
    assert.equal(result.captureReference, false, 'Session matches must never train their own reference');
  }
  assert.equal(r.tracker.track.referenceAt, 1200);
  assert.equal(r.read(61600).captureReference, true, 'Only a new strict gallery match may refresh the reference');
  assert.equal(r.read(61800, .48, { referenceSimilarity: .79 }).accepted, false);
  assert.equal(r.read(62000, .48).accepted, false, 'A mismatch cancels the session');
});
test('weak gallery evidence cannot acquire or move without a confirmed live reference', () => {
  const r = rig(); assert.equal(r.read(1000,.49).accepted, false);
  r.read(1200); assert.equal(r.read(1400,.49).accepted, false, 'One strict frame is insufficient');
  r.read(1600); r.read(1800);
  assert.equal(r.read(2000,.48,{referenceSimilarity:.79}).accepted, false);
  assert.equal(r.read(3000,.48).accepted, false);
});
test('SFace session comparisons cannot drift by learning from each accepted session frame', () => {
  const r = rig();
  const vector = (score, angle = 0) => [score, Math.sqrt(1 - score * score) * Math.cos(angle),
    Math.sqrt(1 - score * score) * Math.sin(angle), ...Array(125).fill(0)];
  const reference = vector(.6);
  r.read(1000); r.read(1200);
  let previous = reference, lost = false;
  for (let i = 1; i <= 10; i++) {
    const current = vector(.48, i * .1);
    assert.ok(cosine(previous, current) > .98, 'Consecutive frames look alike');
    const result = r.read(1200 + i * 200, .48, { referenceSimilarity: cosine(reference, current) });
    assert.equal(result.captureReference, false);
    if (cosine(reference, current) < .8) {
      assert.equal(result.accepted, false);
      assert.equal(result.motion.command, 'PARAR');
      lost = true;
    }
    previous = current;
  }
  assert.equal(lost, true, 'The original gallery-confirmed reference must reject accumulated drift');
});
test('a different face in the same position cannot inherit the target', () => {
  for (const overrides of [
    { referenceSimilarity: .4 }, { referenceSimilarity: NaN }, { confidence: .3 },
    { box: { ...box, x: .1 } }, { box: { ...box, width: NaN } },
    { single: false }, { now: 2101 }, { capturedAt: 1200 }, { capturedAt: 2000 },
    { candidates: [{ identity: target, scores: [.49,.49,.49] }, { identity: rival, scores: [.46,.46,.46] }] },
    { candidates: [{ identity: rival, scores: [.49,.49,.49] }, { identity: target, scores: [.46,.46,.46] }] },
    { candidates: [{ identity: target, scores: [.49,.49] }] },
  ]) {
    const r = rig(); r.read(1000); r.read(1200);
    assert.equal(r.read(1400,.49,overrides).accepted, false, JSON.stringify(overrides));
  }
});
test('a clear mismatch or reset cancels continuity immediately', () => {
  const r = rig(); r.read(1000); r.read(1200);
  assert.equal(r.read(1400,.2).accepted, false);
  assert.equal(r.read(1600,.49).accepted, false);
  r.read(1800); r.read(2000); r.tracker.reset();
  assert.equal(r.read(2200,.49).accepted, false);
});
test('a late strict match retains its real age and cannot seed continued recognition', () => {
  const r = rig(); r.read(1000); r.read(1200);
  const late = r.read(1400,.6,{now:2050});
  assert.equal(late.accepted,true);
  assert.equal(late.motion.state,'STALE_FRAME');
  assert.equal(late.motion.command,'PARAR');
  assert.equal(r.tracker.track,null);
  assert.equal(r.read(2100,.49).accepted,false);
});
test('continuity cannot switch identity and Human uses its own thresholds', () => {
  const r = rig(profiles.HUMAN); r.read(1000,.9); r.read(1200,.9);
  assert.equal(r.read(1400,.78).accepted, true);
  assert.equal(r.read(1600,.74).accepted, false);
  const other = rig(); other.read(1000); other.read(1200);
  const switched = other.read(1400,.6,{candidates:[{identity:rival,scores:[.8,.8,.8]}]});
  assert.equal(switched.identity.id, rival.id);
  assert.equal(switched.motion.command, 'PARAR');
  assert.equal(other.read(1600,.49).accepted, false);
});

test('reused descriptors update position only inside an established session', () => {
  const cached={descriptorFresh:false,descriptorAgeMs:200};
  const r=rig();assert.equal(r.read(1000,.6,cached).accepted,false);
  r.read(1200);assert.equal(r.read(1350,.6,cached).accepted,false,'One sample cannot acquire from a cache');
  r.read(1600);r.read(1800);
  const result=r.read(2000,.6,cached);
  assert.equal(result.accepted,true);assert.equal(result.captureReference,false);
  assert.equal(result.reason,'VISUAL_CONTINUITY');assert.equal(r.tracker.track.referenceAt,1800);
  assert.equal(r.read(2200,.6,{...cached,descriptorAgeMs:451}).accepted,false);
  assert.equal(r.read(2400,.6,cached).accepted,false,'Expired cache cannot resurrect a session');
});
