const assert = require("node:assert/strict");
const matcher = require("../web/face-identity-math.js");

assert.equal(matcher.MIN_SIMILARITY, 0.80);
assert.equal(matcher.aggregateSimilarity([0.92, 0.88, 0.85, 0.30]), (0.92 + 0.88 + 0.85) / 3);

const ana = { id: "QT-001", name: "Ana" };
const bia = { id: "QT-002", name: "Bia" };

const accepted = matcher.chooseIdentity([
  { identity: ana, scores: [0.91, 0.89, 0.86, 0.72, 0.68] },
  { identity: bia, scores: [0.63, 0.61, 0.58, 0.55, 0.50] },
]);
assert.equal(accepted.accepted, true);
assert.equal(accepted.identity, ana);

const belowThreshold = matcher.chooseIdentity([
  { identity: ana, scores: [0.79, 0.78, 0.77] },
]);
assert.equal(belowThreshold.accepted, false);
assert.equal(belowThreshold.reason, "BELOW_THRESHOLD");

const ambiguous = matcher.chooseIdentity([
  { identity: ana, scores: [0.86, 0.84, 0.82] },
  { identity: bia, scores: [0.84, 0.83, 0.81] },
]);
assert.equal(ambiguous.accepted, false);
assert.equal(ambiguous.reason, "AMBIGUOUS");

console.log("Face identity matching: OK");
