'use strict';
// 13 families x 630 deterministic variations. This is a software stress test,
// not a measured recognition accuracy or a substitute for physical testing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PersonFollower } = require('../web/person-follow-math.js');
let seed = 8190;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function input(t, x = .5) {
  return { now: t + random() * 80, capturedAt: t, requireSensor: true, distance: 50 + random() * 50, sensorAgeMs: random() * 200,
    people: [{ confidence: .56 + random() * .43, box: { x: x - .18, y: .1, width: .36, height: .6 } }],
    faces: [{ id: 'QT-001', registered: true, confidence: .6 + random() * .39, capturedAt: t,
      box: { x: x - .04, y: .14, width: .08, height: .12 } }] };
}
const cases = [
  ['no target selected', (f, s) => { f.select(null); }],
  ['expired body frame', (f, s) => { s.now = s.capturedAt + 601 + random() * 5000; }],
  ['duplicate body frame', (f, s) => { s.capturedAt = 1200; }],
  ['missing person', (f, s) => { s.people = []; }],
  ['duplicate selected faces', (f, s) => { s.faces.push({ ...s.faces[0] }); }],
  ['different registered face in the tracked body', (f, s) => { s.faces[0].id = 'QT-002'; }],
  ['invalid distance', (f, s, n) => { s.distance = [null, NaN, 0, -random() * 100, Infinity][n % 5]; }],
  ['old distance reading', (f, s) => { s.sensorAgeMs = 701 + random() * 2000; }],
  ['obstacle within stop distance', (f, s) => { s.distance = 1 + random() * 29; }],
  ['unreliable body detection', (f, s) => { s.people[0].confidence = random() * .499; }],
  ['future frame timestamp', (f, s) => { s.capturedAt = s.now + 1 + random() * 1000; }],
  ['body without prior facial acquisition', (f, s) => { f.reset(); s.faces = []; }],
  ['valid target and clear sensor', () => {}],
];
let count = 0;
for (const [family, mutate] of cases) test(`630 variants: ${family}`, () => {
  for (let n = 0; n < 630; n++) {
    const position = n % 3, x = [.25, .5, .75][position] + (random() - .5) * .015;
    const f = new PersonFollower(); f.select('QT-001');
    f.update(input(1000, x)); f.update(input(1200, x));
    const sample = input(1400, x); mutate(f, sample, n);
    const result = f.update(sample);
    const safe = family === 'valid target and clear sensor';
    assert.equal(result.command, safe ? ['ESQUERDA', 'FRENTE', 'DIREITA'][position] : 'PARAR', `${family} #${n}`);
    if (safe) assert.equal(result.visible, true);
    if (result.prediction) assert.equal(result.command, 'PARAR');
    count++;
  }
});
test('exactly 8190 generated scenarios executed', () => assert.equal(count, 8190));
