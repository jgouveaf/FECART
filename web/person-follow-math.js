/* Mode 2 only. Normalized image coordinates; predictions never authorize motion. */
(() => {
  "use strict";
  const appearance = typeof module !== 'undefined' && module.exports
    ? require('./person-appearance.js') : window.QuantumPersonAppearance;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const MAX_FRAME_AGE_MS = 600;
  const FACE_DROPOUT_GRACE_MS = 450;
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
  function headOnlyDetection(body, face) {
    // EfficientDet can classify a cropped head as "person". Human's expanded
    // face box may be larger than that detection; it is not a second person.
    return body.height <= face.height * 1.5 && overlap(body, face) >= .4;
  }

  function visiblePeople(people, faces, now) {
    if (!Number.isFinite(now)) return 0;
    const bodies = people.filter(p => validBox(p.box) && Number.isFinite(p.confidence) && p.confidence >= .5);
    const matched = new Set();
    let count = bodies.length;
    for (const face of faces) {
      if (!validBox(face.box) || !Number.isFinite(face.confidence) || face.confidence < .58
        || !Number.isFinite(face.capturedAt) || !Number.isFinite(now)
        || now < face.capturedAt || now - face.capturedAt > 800) continue;
      const index = bodies.findIndex((body, i) => !matched.has(i)
        && (containsFace(body.box, face.box) || headOnlyDetection(body.box, face.box)));
      if (index < 0) count++;
      else matched.add(index);
    }
    return count;
  }

  class PersonFollower {
    constructor() { this.select(null); }
    select(id) { this.id = id || null; this.anonymous = false; this.reset(); }
    selectNearest() { this.id = 'TESTE-PROXIMO'; this.anonymous = true; this.reset(); }
    reset() {
      this.box = null;
      this.seenAt = null;
      this.strongBodyAt = null;
      this.identifiedAt = null;
      this.lastSampleAt = -Infinity;
      this.lastFaceSampleAt = -Infinity;
      this.confirmedFrames = 0;
      this.confirmedSince = null;
      this.confirmedFaceSamples = 0;
      this.confirmedFaceAt = -Infinity;
      this.velocity = 0;
      this.smoothed = null;
      this.command = "PARAR";
      this.steering = 'FRENTE';
      this.turnCycleAt = null;
      this.holdDistance = false;
      this.holdSize = false;
      this.holdFaceSize = false;
      this.faceTrack = null;
      this.appearanceReference = null;
      this.appearanceSamples = 0;
      this.appearanceFaceAt = -Infinity;
      this.reidentifyAfter = -Infinity;
    }
    stop(state, extra = {}) {
      this.command = "PARAR";
      this.steering = 'FRENTE';
      this.turnCycleAt = null;
      return { visible: false, command: "PARAR", state, id: this.id, prediction: null, ...extra };
    }
    invalidate(now, state) {
      this.reset();
      if (Number.isFinite(now)) this.reidentifyAfter = now;
      return this.stop(state);
    }
    missing(now, state = "TARGET_LOST", cameraMoving = false) {
      this.faceTrack = null;
      this.confirmedFrames = 0;
      this.confirmedSince = null;
      this.confirmedFaceSamples = 0;
      this.confirmedFaceAt = -Infinity;
      const age = this.seenAt == null ? Infinity : now - this.seenAt;
      const prediction = this.box && age >= 0 && age <= 500 && !cameraMoving
        ? { x: clamp(center(this.box) + this.velocity * age / 1000, 0, 1), ageMs: age, estimated: true }
        : null;
      // A missing/late frame breaks continuity. Clothing cannot reacquire an ID.
      this.appearanceReference = null; this.appearanceSamples = 0;
      if (this.identifiedAt != null && Number.isFinite(now)) this.reidentifyAfter = Math.max(this.reidentifyAfter, now);
      this.identifiedAt = null;
      if (age > 500) { this.box = null; this.identifiedAt = null; this.velocity = 0; this.smoothed = null; }
      return this.stop(prediction ? "PREDICTED_STOP" : state, { prediction, reason: state });
    }
    holdFaceDropout(now, safety) {
      const track = this.faceTrack;
      const info = { box: null, faceBox: track.box, trackingSource: 'face',
        confidence: track.confidence, center: track.center, capturedAt: track.at,
        identityAgeMs: now - track.at, appearanceReady: false, dropout: true,
        trackingState: 'FACE_TRACKING', visualCommand: this.command };
      const blocked = this.proximityStop(info, track.box.height, safety, true);
      if (blocked) return blocked;
      return { ...info, steering: this.steering, visible: true, command: this.command,
        state: 'FACE_TRACKING', id: this.id, prediction: null };
    }
    update({ people = [], faces = [], now, capturedAt, cameraMoving = false, source = 'body',
      requireSensor = false, distance = null, sensorAgeMs = Infinity }) {
      if (!this.id) return this.stop("SELECT_TARGET");
      // The two workers finish independently. A fresh face must not invalidate
      // an earlier body capture that finishes next, or vice versa.
      const sampleKey = source === 'face' ? 'lastFaceSampleAt' : 'lastSampleAt';
      if (!Number.isFinite(now) || !Number.isFinite(capturedAt) || capturedAt > now
        || now - capturedAt > MAX_FRAME_AGE_MS || capturedAt <= this[sampleKey]) return this.missing(now, "STALE_FRAME", true);
      this[sampleKey] = capturedAt;
      // Expiry of a cached result is not a new observation of an empty scene.
      // Stop until fresh evidence arrives, retaining only the trajectory needed
      // to compare its real capture time. A capture gap still reacquires below.
      if (faces.length === 1 && faces[0].registered && faces[0].id === this.id
        && (people.length === 0 || people.length === 1 && people[0].confidence >= .5
          && validBox(people[0].box) && validBox(faces[0].box) && headOnlyDetection(people[0].box,faces[0].box))
        && Number.isFinite(faces[0].capturedAt) && now - faces[0].capturedAt > MAX_FRAME_AGE_MS) {
        return this.stop('STALE_FRAME', { capturedAt: faces[0].capturedAt, trackingSource: 'face' });
      }
      const observedBodies = people.filter(p => validBox(p.box) && Number.isFinite(p.confidence) && p.confidence >= 0.50);
      if (this.anonymous) return this.updateNearest(observedBodies, now, capturedAt, cameraMoving,
        { requireSensor, distance, sensorAgeMs });
      const observedFaces = faces.filter(f => validBox(f.box) && Number.isFinite(f.confidence) && f.confidence >= 0.58
        && Number.isFinite(f.capturedAt) && now - f.capturedAt >= 0 && now - f.capturedAt <= 800
        && (people.length === 0 || Math.abs(capturedAt - f.capturedAt) <= 500) && f.capturedAt > this.reidentifyAfter);
      const freshFaces = observedFaces.filter(f => f.registered);
      const targets = freshFaces.filter(f => f.id === this.id);
      if (targets.length > 1) return this.invalidate(now, "AMBIGUOUS");
      // Keep direct facial evidence separate from body history. A face box must
      // never become a body track that can continue after the face disappears.
      const directFace = targets.length === 1 && observedFaces.length === 1
        && now - targets[0].capturedAt <= MAX_FRAME_AGE_MS ? targets[0] : null;
      if (directFace && now - directFace.capturedAt <= MAX_FRAME_AGE_MS) {
        const previous = this.faceTrack;
        if (!previous || directFace.capturedAt < previous.at || directFace.capturedAt - previous.at > MAX_FRAME_AGE_MS
          || overlap(previous.box, directFace.box) < .35
          || Math.abs(center(previous.box) - center(directFace.box)) >= .18) {
          this.faceTrack = { box: { ...directFace.box }, at: directFace.capturedAt,
            since: directFace.capturedAt, samples: 1, center: center(directFace.box),
            confidence: directFace.confidence };
        } else if (directFace.capturedAt > previous.at) {
          this.faceTrack = { box: { ...directFace.box }, at: directFace.capturedAt,
            since: previous.since, samples: Math.min(2, previous.samples + 1),
            center: .55 * previous.center + .45 * center(directFace.box),
            confidence: directFace.confidence };
        }
      }
      const isolatedDropout = faces.length === 0 && people.length === 0 && this.faceTrack
        && this.faceTrack.samples >= 2 && this.command === 'FRENTE'
        && now - this.faceTrack.at >= 0 && now - this.faceTrack.at <= FACE_DROPOUT_GRACE_MS;
      if (!directFace && isolatedDropout) {
        return this.holdFaceDropout(now, { requireSensor, distance, sensorAgeMs });
      }
      if (!directFace) this.faceTrack = null;
      // No complete body is required. A single detection covering only this
      // head is compatible; conflicting/uncertain full bodies retain stop rules.
      const faceOnlyScene = people.length === 0 || (people.length === 1 && observedBodies.length === 1
        && directFace && headOnlyDetection(observedBodies[0].box, directFace.box));
      if (faceOnlyScene && this.faceTrack) {
        const track = this.faceTrack;
        const info = { box: null, faceBox: track.box, trackingSource: 'face',
          confidence: directFace.confidence, center: track.center, capturedAt: track.at,
          identityAgeMs: now - track.at, appearanceReady: false };
        if (track.samples < 2 || track.at - track.since < 120) return this.stop('CONFIRMING', info);
        return this.decideMotion(info, track.box.height, { requireSensor, distance, sensorAgeMs }, 'FACE_TRACKING');
      }
      // Confidence hysteresis only for an already verified continuous track.
      // Weak boxes cannot acquire a target, renew the strong observation time,
      // bridge a loss or continue for more than 500 ms without a strong box.
      const bodies = observedBodies.filter(p => p.confidence >= .55 || (this.box
        && this.confirmedFrames >= 2 && this.confirmedFaceSamples >= 2
        && this.strongBodyAt != null && capturedAt - this.strongBodyAt >= 0
        && capturedAt - this.strongBodyAt <= 500
        && overlap(p.box, this.box) >= .60 && Math.abs(center(p.box) - center(this.box)) < .06
        && ((targets.length === 1 && containsFace(p.box, targets[0].box))
          || (this.appearanceSamples >= 3 && appearance.similarity(this.appearanceReference, p.appearance) >= .88))));
      let chosen = null, appearanceScore = 0, appearanceTracking = false;
      if (targets.length === 1) {
        const matches = bodies.filter(p => containsFace(p.box, targets[0].box));
        if (observedBodies.filter(p => containsFace(p.box, targets[0].box)).length > 1) return this.invalidate(now, "AMBIGUOUS");
        chosen = matches[0] || null;
        if (chosen && this.box && this.confirmedFrames > 0 && (capturedAt - this.seenAt > MAX_FRAME_AGE_MS
          || overlap(chosen.box, this.box) < .35 || Math.abs(center(chosen.box) - center(this.box)) >= .18)) {
          return this.invalidate(now, 'REIDENTIFY');
        }
        if (chosen) this.identifiedAt = targets[0].capturedAt;
      } else if (this.box && this.seenAt != null && capturedAt - this.seenAt <= MAX_FRAME_AGE_MS
        && this.identifiedAt != null) {
        const matches = bodies.map(p => ({ p, score: overlap(p.box, this.box) }))
          .filter(p => p.score >= 0.35 && Math.abs(center(p.p.box) - center(this.box)) < 0.18)
          .sort((a, b) => b.score - a.score);
        if (matches.length > 1 && matches[0].score - matches[1].score < 0.18) {
          return this.invalidate(now, "AMBIGUOUS");
        }
        chosen = matches[0]?.p || null;
        if (chosen && this.appearanceSamples >= 3) {
          appearanceScore = appearance.similarity(this.appearanceReference, chosen.appearance);
          // Keep the face-verified template fixed; do not learn from guesses.
          if (appearance.valid(chosen.appearance) && appearanceScore < .88) {
            return this.invalidate(now, 'REIDENTIFY');
          }
          if (appearanceScore >= .88) {
            // Even geometrically distinct people with similar clothes invalidate
            // body-only continuation. Color is evidence, not unique identity.
            if (observedBodies.some(p => p !== chosen && appearance.similarity(this.appearanceReference, p.appearance) >= .82)) {
              return this.invalidate(now, 'AMBIGUOUS');
            }
            appearanceTracking = true;
          }
        }
        if (!appearanceTracking && capturedAt - this.identifiedAt > 3000) chosen = null;
      }
      if (!chosen) return this.missing(now, observedBodies.length && !bodies.length ? "LOW_BODY_CONFIDENCE"
        : bodies.length ? "REIDENTIFY" : "TARGET_LOST", cameraMoving);
      if (observedFaces.filter(f => containsFace(chosen.box, f.box)).length > 1
        || freshFaces.some(f => f.id !== this.id && containsFace(chosen.box, f.box))
        || observedBodies.some(p => p !== chosen && overlap(p.box, chosen.box) > 0.4)) {
        return this.invalidate(now, "AMBIGUOUS");
      }
      if (targets.length && this.appearanceSamples >= 3 && targets[0].capturedAt <= this.appearanceFaceAt
        && appearance.valid(chosen.appearance) && appearance.similarity(this.appearanceReference, chosen.appearance) < .88) {
        return this.invalidate(now, 'REIDENTIFY');
      }
      if (targets.length && targets[0].capturedAt > this.confirmedFaceAt) {
        this.confirmedFaceSamples = Math.min(2, this.confirmedFaceSamples + 1);
        this.confirmedFaceAt = targets[0].capturedAt;
      }
      if (chosen.confidence >= .55 && targets.length && targets[0].capturedAt > this.appearanceFaceAt
        && Math.abs(capturedAt - targets[0].capturedAt) <= 250 && appearance.valid(chosen.appearance)) {
        if (!this.appearanceReference || appearance.similarity(this.appearanceReference, chosen.appearance) < .88) {
          this.appearanceReference = chosen.appearance.slice();
          this.appearanceSamples = 0;
        }
        if (targets[0].capturedAt > this.appearanceFaceAt) {
          this.appearanceSamples = Math.min(3, this.appearanceSamples + 1);
          this.appearanceFaceAt = targets[0].capturedAt;
        }
      }
      const x = center(chosen.box), dt = this.seenAt == null ? 0 : (capturedAt - this.seenAt) / 1000;
      if (this.box && dt > 0.02 && dt < 0.5 && !cameraMoving) {
        // Short, bounded velocity estimate in the IMAGE, not a world position.
        this.velocity = clamp(0.6 * this.velocity + 0.4 * (x - center(this.box)) / dt, -0.6, 0.6);
      } else this.velocity = 0;
      this.smoothed = this.smoothed == null ? x : 0.55 * this.smoothed + 0.45 * x;
      this.box = { ...chosen.box };
      this.seenAt = capturedAt;
      if (chosen.confidence >= .55) this.strongBodyAt = capturedAt;
      this.confirmedFrames++;
      if (this.confirmedSince == null) this.confirmedSince = capturedAt;
      const info = { box: this.box, confidence: chosen.confidence, center: this.smoothed,
        identityAgeMs: capturedAt - this.identifiedAt, capturedAt,
        appearanceReady: this.appearanceSamples >= 3, appearanceScore };
      if (this.confirmedFrames < 2 || this.confirmedFaceSamples < 2 || capturedAt - this.confirmedSince < 120) return this.stop("CONFIRMING", info);
      return this.decideMotion(info, chosen.box.height, { requireSensor, distance, sensorAgeMs },
        targets.length ? 'FOLLOWING' : appearanceTracking ? 'APPEARANCE_TRACKING' : 'BODY_TRACKING');
    }
    updateNearest(observedBodies, now, capturedAt, cameraMoving, safety) {
      // Temporary bench-test mode: lock the largest (nearest-looking) body at
      // acquisition, then retain that track. A later larger person never
      // silently replaces it; uncertainty and loss stop the robot.
      const bodies = observedBodies.filter(p => p.confidence >= .50);
      if (!bodies.length) return this.missing(now, observedBodies.length ? 'LOW_BODY_CONFIDENCE' : 'TARGET_LOST', cameraMoving);
      const area = p => p.box.width * p.box.height;
      let chosen = null;
      if (!this.box || this.seenAt == null || capturedAt - this.seenAt > MAX_FRAME_AGE_MS) {
        chosen = [...bodies].sort((a, b) => area(b) - area(a))[0];
      } else {
        const matches = bodies.map(p => ({ p, score: overlap(p.box, this.box) }))
          .filter(item => item.score >= .35 && Math.abs(center(item.p.box) - center(this.box)) < .18)
          .sort((a, b) => b.score - a.score);
        if (matches.length > 1 && matches[0].score - matches[1].score < .18) return this.invalidate(now, 'AMBIGUOUS');
        chosen = matches[0]?.p || null;
      }
      if (!chosen) return this.missing(now, 'TARGET_LOST', cameraMoving);
      if (bodies.some(p => p !== chosen && overlap(p.box, chosen.box) > .4)) return this.invalidate(now, 'AMBIGUOUS');
      const x = center(chosen.box), dt = this.seenAt == null ? 0 : (capturedAt - this.seenAt) / 1000;
      if (this.box && dt > .02 && dt < .5 && !cameraMoving) {
        this.velocity = clamp(.6 * this.velocity + .4 * (x - center(this.box)) / dt, -.6, .6);
      } else this.velocity = 0;
      this.smoothed = this.smoothed == null ? x : .55 * this.smoothed + .45 * x;
      this.box = { ...chosen.box }; this.seenAt = capturedAt; this.strongBodyAt = capturedAt;
      this.confirmedFrames++; if (this.confirmedSince == null) this.confirmedSince = capturedAt;
      const info = { box: this.box, confidence: chosen.confidence, center: this.smoothed, capturedAt,
        identityAgeMs: null, appearanceReady: false, anonymous: true };
      // This is an operator-selected bench test, not identity following. The
      // first valid human detection must exercise the real USB path at once.
      // It intentionally drives straight; target centering and FaceID remain
      // part of the registered-person flow.
      this.steering = 'FRENTE'; this.command = 'FRENTE'; this.turnCycleAt = null;
      return { ...info, trackingState: 'NEAREST_TRACKING', visualCommand: 'FRENTE', steering: 'FRENTE',
        visible: true, command: 'FRENTE', state: 'NEAREST_TRACKING', id: this.id, prediction: null };
    }
    proximityStop(info, height, { requireSensor, distance, sensorAgeMs }, faceOnly) {
      if (requireSensor && (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(sensorAgeMs) || sensorAgeMs < 0 || sensorAgeMs > 700)) {
        return this.stop("SENSOR_WAIT", { ...info, distance, sensorAgeMs });
      }
      if (requireSensor) this.holdDistance = this.holdDistance ? distance < 40 : distance <= 30;
      else this.holdDistance = false;
      // Image coverage depends on camera framing and is not calibrated in cm.
      // Physical control requires a current sensor reading; visual proximity
      // remains a preview fallback only, never a substitute for a failed sensor.
      if (requireSensor) { this.holdFaceSize = false; this.holdSize = false; }
      else if (faceOnly) this.holdFaceSize = this.holdFaceSize ? height > .34 : height >= .40;
      else this.holdSize = this.holdSize ? height > .65 : height >= .75;
      if (this.holdDistance) return this.stop("KEEP_DISTANCE", { ...info, visible: true, reason: 'SENSOR_DISTANCE', distance });
      if (faceOnly ? this.holdFaceSize : this.holdSize) return this.stop("KEEP_DISTANCE", { ...info, visible: true, reason: 'VISUAL_DISTANCE' });
      return null;
    }
    decideMotion(info, height, safety, state) {
      const previous = this.steering;
      if (info.center < (previous === "ESQUERDA" ? 0.46 : 0.40)) this.steering = "ESQUERDA";
      else if (info.center > (previous === "DIREITA" ? 0.54 : 0.60)) this.steering = "DIREITA";
      else this.steering = "FRENTE";
      if (this.steering === 'FRENTE') {
        this.command = 'FRENTE'; this.turnCycleAt = null;
      } else {
        if (previous !== this.steering || this.turnCycleAt == null) this.turnCycleAt = info.capturedAt;
        const offset = Math.abs(info.center - .5);
        // Existing firmware curves forward with one wheel stopped. Short
        // corrections separated by forward motion reduce prolonged turning.
        // Only current observations schedule movement; there is no blind timer.
        const turnMs = clamp(120 + (offset - .1) * 800, 120, 320);
        const phase = Math.max(0, info.capturedAt - this.turnCycleAt) % 800;
        this.command = offset >= .35 || phase < turnMs ? this.steering : 'FRENTE';
      }
      // Preserve what current vision calculated, then apply motor protection.
      // Only command/visible authorize delivery; visualCommand is diagnostic.
      const visual = { ...info, trackingState: state, visualCommand: this.command };
      const blocked = this.proximityStop(visual, height, safety, state === 'FACE_TRACKING');
      if (blocked) return blocked;
      return { ...visual, steering: this.steering, visible: true, command: this.command, state,
        id: this.id, prediction: null };
    }
  }
  const api = Object.freeze({ PersonFollower, validBox, overlap, containsFace, headOnlyDetection, visiblePeople });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.QuantumPersonFollowMath = api;
})();
