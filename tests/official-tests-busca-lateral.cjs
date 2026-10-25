"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PersonFollower } = require("../web/person-follow-math.js");

const body = x => ({ confidence: .9, box: { x, y: .1, width: .2, height: .55 } });
const sizedBody = (x, height) => ({ confidence: .9, box: { x, y: .1, width: .2, height } });

function followerAtEdge(x) {
  const follower = new PersonFollower();
  follower.selectNearest();
  follower.update({ people: [body(x)], faces: [], now: 1000, capturedAt: 1000 });
  follower.update({ people: [body(x)], faces: [], now: 1200, capturedAt: 1200 });
  return follower;
}

test("starts the bounded search toward the side where the target left", () => {
  for (const [x, direction] of [[.03, "ESQUERDA"], [.78, "DIREITA"]]) {
    const follower = followerAtEdge(x);
    const result = follower.update({ people: [], faces: [], now: 1700, capturedAt: 1700 });
    assert.equal(result.searching, true);
    assert.equal(result.command, direction);
    assert.equal(result.visible, false);
  }
});

test("brief empty frames preserve a confirmed lateral exit until the search starts", () => {
  const follower = followerAtEdge(.78);
  const first = follower.update({ people: [], faces: [], now: 1300, capturedAt: 1300,
    cameraMoving: true });
  assert.equal(first.command, "PARAR");
  assert.equal(first.searching, undefined);
  const second = follower.update({ people: [], faces: [], now: 1500, capturedAt: 1500 });
  assert.equal(second.command, "PARAR");
  const search = follower.update({ people: [], faces: [], now: 1700, capturedAt: 1700,
    cameraMoving: true });
  assert.equal(search.searching, true);
  assert.equal(search.command, "DIREITA");
  const continued = follower.update({ people: [], faces: [], now: 1800, capturedAt: 1800,
    cameraMoving: true });
  assert.equal(continued.command, "DIREITA");
});

test("a confirmed face-only target also starts the lateral search", () => {
  const follower = new PersonFollower();
  follower.select('ALVO');
  const face = at => ({ id: 'ALVO', registered: true, confidence: .9, capturedAt: at,
    box: { x: .75, y: .15, width: .14, height: .20 } });
  follower.update({ people: [], faces: [face(1000)], now: 1000, capturedAt: 1000,
    source: 'face' });
  const visible = follower.update({ people: [], faces: [face(1200)], now: 1200,
    capturedAt: 1200, source: 'face' });
  assert.equal(visible.command, 'DIREITA');
  follower.update({ people: [], faces: [], now: 1300, capturedAt: 1300, source: 'face',
    cameraMoving: true });
  const search = follower.update({ people: [], faces: [], now: 1700, capturedAt: 1700,
    source: 'face', cameraMoving: true });
  assert.equal(search.searching, true);
  assert.equal(search.command, 'DIREITA');
});

test("stale or uncertain observations cancel a pending search", () => {
  const follower = followerAtEdge(.03);
  follower.update({ people: [], faces: [], now: 1300, capturedAt: 1300 });
  const stale = follower.update({ people: [], faces: [], now: 2000, capturedAt: 1300 });
  assert.equal(stale.command, "PARAR");
  const later = follower.update({ people: [], faces: [], now: 2100, capturedAt: 2100 });
  assert.equal(later.searching, undefined);
  assert.equal(later.command, "PARAR");
});

test("stops after the bounded full-scan time without a new observation", () => {
  const follower = followerAtEdge(.03);
  follower.update({ people: [], faces: [], now: 1700, capturedAt: 1700 });
  const result = follower.update({ people: [], faces: [], now: 6700, capturedAt: 6700 });
  assert.equal(result.state, "SEARCH_TIMEOUT");
  assert.equal(result.command, "PARAR");
});

test("a fresh observation cancels the search and resumes normal tracking", () => {
  const follower = followerAtEdge(.03);
  follower.update({ people: [], faces: [], now: 1700, capturedAt: 1700 });
  const result = follower.update({ people: [body(.38)], faces: [], now: 1900, capturedAt: 1900 });
  assert.equal(result.searching, undefined);
  assert.equal(result.state, "NEAREST_TRACKING");
  assert.notEqual(result.command, "PARAR");
});

test("a target that disappears from the center never starts a directional scan", () => {
  const follower = followerAtEdge(.03);
  [[1400, .12], [1600, .2], [1800, .28], [2000, .36], [2200, .4]].forEach(([at, x]) => {
    follower.update({ people: [body(x)], faces: [], now: at, capturedAt: at });
  });
  const result = follower.update({ people: [], faces: [], now: 2800, capturedAt: 2800 });
  assert.equal(result.command, "PARAR");
  assert.equal(result.searching, undefined);
});

test("a lateral-only target keeps turning until it returns to the center", () => {
  const follower = new PersonFollower(); follower.selectNearest();
  const commands = [1000, 1200, 1500, 1800].map(at => follower.update({
    people: [body(.75)], now: at, capturedAt: at
  }).command);
  assert.deepEqual(commands, ["DIREITA", "DIREITA", "DIREITA", "DIREITA"]);
  let centered;
  [.7, .65, .6, .55, .5, .45, .4, .4].forEach((x, i) => {
    const at = 1900 + i * 100;
    centered = follower.update({ people: [body(x)], now: at, capturedAt: at });
  });
  assert.equal(centered.command, "FRENTE");
});

test("a target receding sideways requests a smooth forward curve", () => {
  const follower = new PersonFollower(); follower.selectNearest();
  const commands = [[1000, .55], [1100, .53], [1200, .51], [1420, .49]].map(([at, height]) =>
    follower.update({ people: [sizedBody(.75, height)], now: at, capturedAt: at }).command);
  assert.deepEqual(commands, ["DIREITA", "DIREITA", "FRENTE_DIREITA", "FRENTE_DIREITA"]);
});

test("a target receding on the left requests the matching forward curve", () => {
  const follower = new PersonFollower(); follower.selectNearest();
  const commands = [[1000, .55], [1100, .53], [1200, .51], [1420, .49]].map(([at, height]) =>
    follower.update({ people: [sizedBody(.03, height)], now: at, capturedAt: at }).command);
  assert.deepEqual(commands, ["ESQUERDA", "ESQUERDA", "FRENTE_ESQUERDA", "FRENTE_ESQUERDA"]);
});
