/* Mode 2 only. Normalized image coordinates; predictions never authorize motion. */
(() => {
  "use strict";
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const center = box => box.x + box.width / 2;
  function validBox(b) {
    return b && [b.x, b.y, b.width, b.height].every(Number.isFinite)
      && b.width > 0.02 && b.height > 0.02 && b.x >= 0 && b.y >= 0
      && b.x + b.width <= 1.01 && b.y + b.height <= 1.01;
  }
  function overlap(a, b) {
    const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
      * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return area / (a.width * a.height + b.width * b.height - area || 1);
  }
  function containsFace(body, face) {
    const x = center(face), y = face.y + face.height / 2;
    return x >= body.x && x <= body.x + body.width && y >= body.y
      && y <= body.y + body.height * 0.65 && face.width < body.width * 1.1;
  }

  class PersonFollower {
    constructor() { this.select(null); }
    select(id) { this.id = id || null; this.reset(); }
    reset() {
      this.box = null;
      this.seenAt = null;
      this.identifiedAt = null;
      this.lastSampleAt = -Infinity;
      this.confirmedFrames = 0;
      this.confirmedSince = null;
      this.velocity = 0;
      this.smoothed = null;
      this.command = "PARAR";
      this.holdDistance = false;
      this.holdSize = false;
    }
    stop(state, extra = {}) {
      this.command = "PARAR";
      return { visible: false, command: "PARAR", state, id: this.id, prediction: null, ...extra };
    }
    missing(now, state = "TARGET_LOST", cameraMoving = false) {
      this.confirmedFrames = 0;
      this.confirmedSince = null;
      const age = this.seenAt == null ? Infinity : now - this.seenAt;
      const prediction = this.box && age >= 0 && age <= 500 && !cameraMoving
        ? { x: clamp(center(this.box) + this.velocity * age / 1000, 0, 1), ageMs: age, estimated: true }
        : null;
      if (age > 500) { this.box = null; this.identifiedAt = null; this.velocity = 0; this.smoothed = null; }
      return this.stop(prediction ? "PREDICTED_STOP" : state, { prediction });
    }
    update({ people = [], faces = [], now, capturedAt, cameraMoving = false,
      requireSensor = false, distance = null, sensorAgeMs = Infinity }) {
      if (!this.id) return this.stop("SELECT_TARGET");
      if (!Number.isFinite(now) || !Number.isFinite(capturedAt) || capturedAt > now
        || now - capturedAt > 600 || capturedAt <= this.lastSampleAt) return this.missing(now, "STALE_FRAME", true);
      this.lastSampleAt = capturedAt;
      const bodies = people.filter(p => validBox(p.box) && Number.isFinite(p.confidence) && p.confidence >= 0.55);
      const freshFaces = faces.filter(f => validBox(f.box) && Number.isFinite(f.confidence) && f.confidence >= 0.58 && f.registered
        && Number.isFinite(f.capturedAt) && now - f.capturedAt >= 0 && now - f.capturedAt <= 800
        && Math.abs(capturedAt - f.capturedAt) <= 500);
      const targets = freshFaces.filter(f => f.id === this.id);
      if (targets.length > 1) { this.reset(); return this.stop("AMBIGUOUS"); }
      let chosen = null;
      if (targets.length === 1) {
        const matches = bodies.filter(p => containsFace(p.box, targets[0].box));
        if (matches.length > 1) { this.reset(); return this.stop("AMBIGUOUS"); }
        chosen = matches[0] || null;
        if (chosen) this.identifiedAt = targets[0].capturedAt;
      } else if (this.box && this.seenAt != null && capturedAt - this.seenAt <= 500
        && this.identifiedAt != null && capturedAt - this.identifiedAt <= 3000) {
        const matches = bodies.map(p => ({ p, score: overlap(p.box, this.box) }))
          .filter(p => p.score >= 0.35 && Math.abs(center(p.p.box) - center(this.box)) < 0.18)
          .sort((a, b) => b.score - a.score);
        if (matches.length > 1 && matches[0].score - matches[1].score < 0.18) {
          this.reset(); return this.stop("AMBIGUOUS");
        }
        chosen = matches[0]?.p || null;
      }
      if (!chosen) return this.missing(now, bodies.length ? "REIDENTIFY" : "TARGET_LOST", cameraMoving);
      if (freshFaces.some(f => f.id !== this.id && containsFace(chosen.box, f.box))
        || bodies.some(p => p !== chosen && overlap(p.box, chosen.box) > 0.4)) {
        this.reset(); return this.stop("AMBIGUOUS");
      }
      const x = center(chosen.box), dt = this.seenAt == null ? 0 : (capturedAt - this.seenAt) / 1000;
      if (this.box && dt > 0.02 && dt < 0.5 && !cameraMoving) {
        // Short, bounded velocity estimate in the IMAGE, not a world position.
        this.velocity = clamp(0.6 * this.velocity + 0.4 * (x - center(this.box)) / dt, -0.6, 0.6);
      } else this.velocity = 0;
      this.smoothed = this.smoothed == null ? x : 0.55 * this.smoothed + 0.45 * x;
      this.box = { ...chosen.box };
      this.seenAt = capturedAt;
      this.confirmedFrames++;
      if (this.confirmedSince == null) this.confirmedSince = capturedAt;
      const info = { box: this.box, confidence: chosen.confidence, center: this.smoothed,
        identityAgeMs: capturedAt - this.identifiedAt, capturedAt };
      if (this.confirmedFrames < 2 || capturedAt - this.confirmedSince < 120) return this.stop("CONFIRMING", info);
      if (requireSensor && (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(sensorAgeMs) || sensorAgeMs < 0 || sensorAgeMs > 700)) {
        return this.stop("SENSOR_WAIT", info);
      }
      if (requireSensor) this.holdDistance = this.holdDistance ? distance < 40 : distance <= 30;
      else this.holdDistance = false;
      this.holdSize = this.holdSize ? chosen.box.height > 0.65 : chosen.box.height >= 0.75;
      if (this.holdDistance || this.holdSize) return this.stop("KEEP_DISTANCE", { ...info, visible: true });
      const previous = this.command;
      if (this.smoothed < (previous === "ESQUERDA" ? 0.46 : 0.40)) this.command = "ESQUERDA";
      else if (this.smoothed > (previous === "DIREITA" ? 0.54 : 0.60)) this.command = "DIREITA";
      else this.command = "FRENTE";
      return { ...info, visible: true, command: this.command, state: targets.length ? "FOLLOWING" : "BODY_TRACKING",
        id: this.id, prediction: null };
    }
  }
  const api = Object.freeze({ PersonFollower, validBox, overlap, containsFace });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.QuantumPersonFollowMath = api;
})();
