(() => {
  "use strict";

  const VALID_VIEWS = new Set(["PALM", "BACK", "SIDE"]);

  function cleanLandmarks(points) {
    if (!Array.isArray(points) || points.length !== 21) return null;
    return points.map((point) => ({
      x: Number(point?.x) || 0,
      y: Number(point?.y) || 0,
      z: Number(point?.z) || 0,
      visibility: Number.isFinite(Number(point?.visibility)) ? Number(point.visibility) : null,
    }));
  }

  class GestureCalibrationRecorder {
    constructor({ targetSamples = 20 } = {}) {
      this.targetSamples = Math.max(5, Math.min(60, Number(targetSamples) || 20));
      this.samples = [];
      this.session = null;
    }

    start({ expectedCount, view }) {
      const count = Number(expectedCount);
      const normalizedView = String(view || "").toUpperCase();
      if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error("Escolha a quantidade real de dedos (1 a 5).");
      if (!VALID_VIEWS.has(normalizedView)) throw new Error("Escolha palma, dorso ou lateral.");
      this.session = { expectedCount: count, view: normalizedView, captured: 0 };
      return this.snapshot();
    }

    ingest(frame) {
      if (!this.session) return this.snapshot();
      const imageLandmarks = cleanLandmarks(frame?.imageLandmarks);
      if (!imageLandmarks) return this.snapshot();
      const worldLandmarks = cleanLandmarks(frame?.worldLandmarks);
      this.samples.push({
        capturedAt: new Date().toISOString(),
        frameTimeMs: Number(frame?.frameTimeMs) || 0,
        expectedCount: this.session.expectedCount,
        view: this.session.view,
        handedness: frame?.handedness || null,
        camera: frame?.camera || null,
        imageLandmarks,
        worldLandmarks,
        detector: frame?.detector || null,
      });
      this.session.captured += 1;
      if (this.session.captured >= this.targetSamples) this.session = null;
      return this.snapshot();
    }

    clear() {
      this.samples = [];
      this.session = null;
      return this.snapshot();
    }

    cancel() {
      this.session = null;
      return this.snapshot();
    }

    snapshot() {
      return {
        active: Boolean(this.session),
        captured: this.session?.captured || 0,
        target: this.targetSamples,
        total: this.samples.length,
        expectedCount: this.session?.expectedCount || null,
        view: this.session?.view || null,
      };
    }

    toJSON() {
      return {
        schema: "quantum-tracker/gesture-calibration-v1",
        exportedAt: new Date().toISOString(),
        privacy: "Somente landmarks numéricos; nenhuma foto ou quadro de vídeo.",
        sampleCount: this.samples.length,
        samples: this.samples,
      };
    }
  }

  window.QuantumGestureCalibration = Object.freeze({ GestureCalibrationRecorder });
})();
