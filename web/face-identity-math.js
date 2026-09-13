(() => {
  "use strict";

  const MIN_SIMILARITY = 0.80;
  const AMBIGUITY_MARGIN = 0.05;
  const TOP_SAMPLE_COUNT = 3;
  const MIN_REFERENCE_SAMPLES = 3;

  function mergeSamples(existing = [], incoming = [], limit = 15, length = 1024) {
    const valid = sample => Array.isArray(sample) && sample.length === length && sample.every(Number.isFinite);
    const previous = existing.filter(valid), next = incoming.filter(valid);
    const merged = previous.slice(), available = new Map();
    for (const sample of previous) {
      const key = sample.join(','); available.set(key, (available.get(key) || 0) + 1);
    }
    // Preserve repeated samples within a completed capture. On backup import,
    // match existing occurrences so importing the same set stays idempotent.
    for (const sample of next) {
      const key = sample.join(','), count = available.get(key) || 0;
      if (count) available.set(key, count - 1);
      else merged.push(sample);
    }
    return merged.slice(-limit);
  }

  function validScores(scores) {
    return (Array.isArray(scores) ? scores : [])
      .map(Number)
      .filter(Number.isFinite)
      .map((score) => Math.max(0, Math.min(1, score)))
      .sort((first, second) => second - first);
  }

  function aggregateSimilarity(scores) {
    const strongest = validScores(scores).slice(0, TOP_SAMPLE_COUNT);
    if (!strongest.length) return 0;
    return strongest.reduce((total, score) => total + score, 0) / strongest.length;
  }

  function chooseIdentity(candidates, { threshold = MIN_SIMILARITY, ambiguityMargin = AMBIGUITY_MARGIN } = {}) {
    const ranked = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => ({
        ...candidate,
        similarity: aggregateSimilarity(candidate.scores),
        referenceCount: validScores(candidate.scores).length,
      }))
      .sort((first, second) => second.similarity - first.similarity);

    const best = ranked[0] || null;
    const second = ranked[1] || null;
    const similarity = best?.similarity || 0;
    const margin = second ? similarity - second.similarity : 1;
    const accepted = Boolean(best && best.referenceCount >= MIN_REFERENCE_SAMPLES
      && similarity >= threshold && margin >= ambiguityMargin);

    return {
      accepted,
      identity: accepted ? best.identity : null,
      similarity,
      secondSimilarity: second?.similarity || 0,
      margin,
      ranked,
      reason: !best
        ? "NO_IDENTITIES"
        : best.referenceCount < MIN_REFERENCE_SAMPLES
          ? "INSUFFICIENT_SAMPLES"
          : similarity < threshold
            ? "BELOW_THRESHOLD"
            : margin < ambiguityMargin
              ? "AMBIGUOUS"
              : "MATCH",
    };
  }

  // Hysteresis applies only to an already confirmed, continuously measured
  // face. Weak matches never refresh the strict reference or its expiry.
  class FaceIdentityTracker {
    constructor() { this.reset(); }
    reset() { this.track = null; }
    update({ candidates, profile, box, capturedAt, now, single, confidence, referenceSimilarity }) {
      const decision = chooseIdentity(candidates, profile);
      const previous = this.track;
      const valid = single && Number.isFinite(confidence) && confidence >= .58
        && box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
        && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
        && Number.isFinite(capturedAt) && Number.isFinite(now)
        && capturedAt <= now && now - capturedAt <= 600 && (!previous || capturedAt > previous.at);
      // A strict match can still be displayed with its original timestamp;
      // the follower enforces freshness. It must not seed temporal continuity.
      if (!valid) { this.reset(); return decision; }
      const intersection = previous ? Math.max(0, Math.min(box.x + box.width, previous.box.x + previous.box.width) - Math.max(box.x, previous.box.x))
        * Math.max(0, Math.min(box.y + box.height, previous.box.y + previous.box.height) - Math.max(box.y, previous.box.y)) : 0;
      const iou = previous ? intersection / (box.width * box.height + previous.box.width * previous.box.height - intersection || 1) : 0;
      const continuous = previous && previous.engine === profile.engine && capturedAt > previous.at
        && capturedAt - previous.at <= 600 && iou >= .5;
      if (decision.accepted) {
        const same = continuous && previous.id === decision.identity.id;
        this.track = { id: decision.identity.id, engine: profile.engine, box: { ...box }, at: capturedAt,
          strictAt: capturedAt, since: same ? previous.since : capturedAt,
          samples: same ? Math.min(2, previous.samples + 1) : 1 };
        return decision;
      }
      const best = decision.ranked[0];
      const retain = continuous && previous.samples >= 2 && previous.strictAt - previous.since >= 120
        && now - previous.strictAt <= 800 && decision.reason === 'BELOW_THRESHOLD'
        && best?.identity.id === previous.id && best.referenceCount >= MIN_REFERENCE_SAMPLES
        && decision.margin >= profile.ambiguityMargin && decision.similarity >= profile.continuationThreshold
        && Number.isFinite(referenceSimilarity) && referenceSimilarity >= profile.referenceThreshold;
      if (retain) {
        this.track = { ...previous, box: { ...box }, at: capturedAt };
        return { ...decision, accepted: true, identity: best.identity, reason: 'CONTINUITY_MATCH' };
      }
      this.reset();
      return decision;
    }
  }

  const api = Object.freeze({
    MIN_SIMILARITY,
    AMBIGUITY_MARGIN,
    TOP_SAMPLE_COUNT,
    MIN_REFERENCE_SAMPLES,
    mergeSamples,
    aggregateSimilarity,
    chooseIdentity,
    FaceIdentityTracker,
  });

  if (typeof window !== "undefined") window.QuantumFaceIdentityMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
