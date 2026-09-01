(() => {
  "use strict";

  const MIN_SIMILARITY = 0.80;
  const AMBIGUITY_MARGIN = 0.05;
  const TOP_SAMPLE_COUNT = 3;

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

  function chooseIdentity(candidates) {
    const ranked = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => ({
        ...candidate,
        similarity: aggregateSimilarity(candidate.scores),
      }))
      .sort((first, second) => second.similarity - first.similarity);

    const best = ranked[0] || null;
    const second = ranked[1] || null;
    const similarity = best?.similarity || 0;
    const margin = second ? similarity - second.similarity : 1;
    const accepted = Boolean(best && similarity >= MIN_SIMILARITY && margin >= AMBIGUITY_MARGIN);

    return {
      accepted,
      identity: accepted ? best.identity : null,
      similarity,
      secondSimilarity: second?.similarity || 0,
      margin,
      ranked,
      reason: !best
        ? "NO_IDENTITIES"
        : similarity < MIN_SIMILARITY
          ? "BELOW_THRESHOLD"
          : margin < AMBIGUITY_MARGIN
            ? "AMBIGUOUS"
            : "MATCH",
    };
  }

  const api = Object.freeze({
    MIN_SIMILARITY,
    AMBIGUITY_MARGIN,
    TOP_SAMPLE_COUNT,
    aggregateSimilarity,
    chooseIdentity,
  });

  if (typeof window !== "undefined") window.QuantumFaceIdentityMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
