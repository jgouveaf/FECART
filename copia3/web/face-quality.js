(() => {
  "use strict";

  class FaceQualityStabilizer {
    constructor(options = {}) {
      this.alpha = options.alpha || 0.22;
      this.riseFrames = options.riseFrames || 5;
      this.fallFrames = options.fallFrames || 4;
      this.highEnter = options.highEnter || 0.84;
      this.highExit = options.highExit || 0.77;
      this.maxIdleMs = options.maxIdleMs || 2500;
      this.states = new Map();
    }

    update(key, sample, now = performance.now()) {
      this.prune(now);
      const stableKey = key || "FACE-UNTRACKED";
      const previous = this.states.get(stableKey) || {
        score: Number(sample.combined) || 0,
        acceptable: false,
        goodFrames: 0,
        badFrames: 0,
        label: "BAIXA",
        seenAt: now,
      };
      const rawScore = Number(sample.combined) || 0;
      previous.score += this.alpha * (rawScore - previous.score);
      previous.seenAt = now;

      if (sample.acceptable) {
        previous.goodFrames += 1;
        previous.badFrames = 0;
      } else {
        previous.badFrames += 1;
        previous.goodFrames = 0;
      }

      if (!previous.acceptable && previous.goodFrames >= this.riseFrames) previous.acceptable = true;
      if (previous.acceptable && previous.badFrames >= this.fallFrames) previous.acceptable = false;

      if (!previous.acceptable) {
        previous.label = "BAIXA";
      } else if (previous.label === "ALTA") {
        previous.label = previous.score >= this.highExit ? "ALTA" : "BOA";
      } else {
        previous.label = previous.score >= this.highEnter ? "ALTA" : "BOA";
      }

      this.states.set(stableKey, previous);
      return {
        ...sample,
        rawAcceptable: Boolean(sample.acceptable),
        acceptable: previous.acceptable,
        combined: previous.score,
        label: previous.label,
      };
    }

    prune(now = performance.now()) {
      for (const [key, state] of this.states) {
        if (now - state.seenAt > this.maxIdleMs) this.states.delete(key);
      }
    }

    reset() {
      this.states.clear();
    }
  }

  window.QuantumFaceQuality = Object.freeze({ FaceQualityStabilizer });
})();
