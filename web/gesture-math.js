(() => {
  "use strict";

  const EPSILON = 1e-6;
  const FINGER_NAMES = Object.freeze(["Polegar", "Indicador", "Médio", "Anelar", "Mínimo"]);
  const FINGER_THRESHOLDS = Object.freeze([0.54, 0.52, 0.52, 0.52, 0.52]);
  const UNCERTAIN_MARGIN = 0.055;

  function validLandmarks(points) {
    return Array.isArray(points) && points.length === 21 && points.every(point =>
      point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && (point.z === undefined || Number.isFinite(point.z)));
  }

  function imageInUniformUnits(points, size) {
    if (!validLandmarks(points)) return null;
    // MediaPipe: x/z usam largura; y usa altura. Unificar antes da geometria.
    const ratio = size?.width > 0 && size?.height > 0 ? size.height / size.width : 1;
    return points.map(point => ({ x: point.x, y: point.y * ratio, z: point.z ?? 0 }));
  }

  function distance(first, second) {
    const dx = Number(first?.x || 0) - Number(second?.x || 0);
    const dy = Number(first?.y || 0) - Number(second?.y || 0);
    const dz = Number(first?.z || 0) - Number(second?.z || 0);
    return Math.hypot(dx, dy, dz);
  }

  function jointAngle(first, joint, last) {
    const a = {
      x: Number(first?.x || 0) - Number(joint?.x || 0),
      y: Number(first?.y || 0) - Number(joint?.y || 0),
      z: Number(first?.z || 0) - Number(joint?.z || 0),
    };
    const b = {
      x: Number(last?.x || 0) - Number(joint?.x || 0),
      y: Number(last?.y || 0) - Number(joint?.y || 0),
      z: Number(last?.z || 0) - Number(joint?.z || 0),
    };
    const length = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
    if (length < EPSILON) return 0;
    const cosine = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / length));
    return Math.acos(cosine) * 180 / Math.PI;
  }

  function average(points) {
    const total = points.reduce((sum, item) => ({
      x: sum.x + Number(item?.x || 0),
      y: sum.y + Number(item?.y || 0),
      z: sum.z + Number(item?.z || 0),
    }), { x: 0, y: 0, z: 0 });
    return { x: total.x / points.length, y: total.y / points.length, z: total.z / points.length };
  }

  function thresholdScore(value, threshold, transition) {
    return Math.max(0, Math.min(1, 0.5 + (value - threshold) / Math.max(transition, EPSILON)));
  }

  function weightedProbability(entries) {
    const totalWeight = entries.reduce((sum, entry) => sum + entry[1], 0);
    if (totalWeight < EPSILON) return 0;
    return entries.reduce((sum, entry) => sum + entry[0] * entry[1], 0) / totalWeight;
  }

  function evaluateFinger(points, mcp, pip, dip, tip, palmScale, palmCenter) {
    const chainLength = distance(points[mcp], points[pip])
      + distance(points[pip], points[dip]) + distance(points[dip], points[tip]);
    const straightness = distance(points[mcp], points[tip]) / Math.max(chainLength, EPSILON);
    const pipAngle = jointAngle(points[mcp], points[pip], points[dip]);
    const dipAngle = jointAngle(points[pip], points[dip], points[tip]);
    const tipMcpDistance = distance(points[tip], points[mcp]) / palmScale;
    const radialAdvance = (distance(points[tip], palmCenter) - distance(points[pip], palmCenter)) / palmScale;
    const reachRatio = distance(points[tip], points[mcp]) / Math.max(distance(points[pip], points[mcp]), EPSILON);
    const probability = Math.min(thresholdScore(reachRatio, 1.3, 0.7), weightedProbability([
      [thresholdScore(straightness, 0.78, 0.24), 0.36],
      [thresholdScore(pipAngle, 125, 70), 0.22],
      [thresholdScore(dipAngle, 130, 65), 0.18],
      [thresholdScore(tipMcpDistance, 0.56, 0.32), 0.14],
      [thresholdScore(radialAdvance, 0.05, 0.24), 0.10],
    ]));
    return {
      extended: probability >= 0.52,
      probability,
      certainty: Math.min(1, Math.abs(probability - 0.52) * 2.3),
      metrics: { straightness, pipAngle, dipAngle, tipMcpDistance, radialAdvance, reachRatio },
    };
  }

  function evaluateThumb(points, palmScale, palmCenter) {
    const chainLength = distance(points[1], points[2])
      + distance(points[2], points[3]) + distance(points[3], points[4]);
    const straightness = distance(points[1], points[4]) / Math.max(chainLength, EPSILON);
    const mcpAngle = jointAngle(points[1], points[2], points[3]);
    const ipAngle = jointAngle(points[2], points[3], points[4]);
    const palmDistance = distance(points[4], palmCenter) / palmScale;
    const indexDistance = distance(points[4], points[5]) / palmScale;
    const radialAdvance = (distance(points[4], palmCenter) - distance(points[3], palmCenter)) / palmScale;
    // Polegar sobre a palma pode parecer reto. Medir tambem a abertura lateral
    // relativa a propria mao, sem depender de esquerda/direita ou espelhamento.
    const palmWidth = Math.max(distance(points[5], points[17]), EPSILON);
    const lateralSpread = ((points[4].x - points[5].x) * (points[5].x - points[17].x)
      + (points[4].y - points[5].y) * (points[5].y - points[17].y)
      + ((points[4].z || 0) - (points[5].z || 0)) * ((points[5].z || 0) - (points[17].z || 0))) / palmWidth / palmScale;
    const probability = Math.min(thresholdScore(lateralSpread, 0.08, 0.30), weightedProbability([
      [thresholdScore(straightness, 0.76, 0.28), 0.25],
      [thresholdScore(mcpAngle, 125, 70), 0.14],
      [thresholdScore(ipAngle, 130, 65), 0.14],
      [thresholdScore(palmDistance, 0.82, 0.42), 0.19],
      [thresholdScore(indexDistance, 0.58, 0.34), 0.20],
      [thresholdScore(radialAdvance, 0.05, 0.24), 0.08],
    ]));
    return {
      extended: probability >= 0.54,
      probability,
      certainty: Math.min(1, Math.abs(probability - 0.54) * 2.4),
      metrics: { straightness, mcpAngle, ipAngle, palmDistance, indexDistance, radialAdvance, lateralSpread },
    };
  }

  function fingerExtended(points, mcp, pip, dip, tip, palmScale, palmCenter) {
    return evaluateFinger(points, mcp, pip, dip, tip, palmScale, palmCenter).extended;
  }

  function thumbExtended(points, palmScale, palmCenter) {
    return evaluateThumb(points, palmScale, palmCenter).extended;
  }

  function evaluateHand(points) {
    if (!validLandmarks(points)) return { count: 0, confidence: 0, fingers: [] };
    const palmScale = Math.max(distance(points[0], points[9]), distance(points[5], points[17]));
    if (palmScale < EPSILON) return { count: 0, confidence: 0, fingers: [] };
    const palmCenter = average([points[0], points[5], points[9], points[13], points[17]]);
    const evaluations = [
      evaluateThumb(points, palmScale, palmCenter),
      evaluateFinger(points, 5, 6, 7, 8, palmScale, palmCenter),
      evaluateFinger(points, 9, 10, 11, 12, palmScale, palmCenter),
      evaluateFinger(points, 13, 14, 15, 16, palmScale, palmCenter),
      evaluateFinger(points, 17, 18, 19, 20, palmScale, palmCenter),
    ];
    return { evaluations, palmScale };
  }

  function classifyFingerCountDetails(imageLandmarks, worldLandmarks, imageSize) {
    const image = evaluateHand(imageInUniformUnits(imageLandmarks, imageSize));
    const world = worldLandmarks?.length === 21 ? evaluateHand(worldLandmarks) : null;
    const sources = [image, world].filter((item) => item?.evaluations);
    if (!sources.length) return { count: 0, confidence: 0, fingers: [] };
    const evaluations = image?.evaluations && world?.evaluations
      ? image.evaluations.map((item, index) => {
        const probability = item.probability * 0.62 + world.evaluations[index].probability * 0.38;
        const threshold = FINGER_THRESHOLDS[index];
        return {
          probability,
          extended: probability >= threshold,
          certainty: Math.min(1, Math.abs(probability - threshold) * 2.35),
          metrics: item.metrics,
          imageProbability: item.probability,
          worldProbability: world.evaluations[index].probability,
        };
      })
      : sources[0].evaluations;
    const fingers = evaluations.map((item) => item.extended);
    const certainties = evaluations.map((item) => item.certainty).sort((a, b) => a - b);
    // Contagem exata depende de TODOS os dedos. A mediana mascarava o polegar
    // incerto com a certeza de tres dedos longos, chegando a mostrar 100%.
    const disagreement = evaluations.some(item => item.worldProbability != null
      && Math.abs(item.imageProbability - item.worldProbability) > 0.35);
    const confidence = disagreement ? 0 : certainties[0];
    return {
      count: fingers.filter(Boolean).length,
      confidence: Math.max(0, Math.min(1, confidence)),
      fingers,
      probabilities: evaluations.map((item) => item.probability),
      fingerDetails: evaluations.map((item, index) => {
        const threshold = FINGER_THRESHOLDS[index];
        const delta = item.probability - threshold;
        return {
          name: FINGER_NAMES[index],
          probability: item.probability,
          threshold,
          certainty: item.certainty,
          state: delta >= UNCERTAIN_MARGIN ? "OPEN" : delta <= -UNCERTAIN_MARGIN ? "CLOSED" : "UNCERTAIN",
          metrics: item.metrics || null,
          imageProbability: item.imageProbability ?? item.probability,
          worldProbability: item.worldProbability ?? null,
        };
      }),
      palmScale: image?.palmScale || world?.palmScale,
    };
  }

  class FingerStateStabilizer {
    constructor({ alpha = 0.70, openMargin = 0.04, closeMargin = 0.055 } = {}) {
      this.alpha = alpha;
      this.openMargin = openMargin;
      this.closeMargin = closeMargin;
      this.reset();
    }

    reset() {
      this.probabilities = Array(5).fill(null);
      this.history = Array.from({ length: 5 }, () => []);
      this.fingers = Array(5).fill(false);
    }

    update(classification) {
      if (!classification?.probabilities || classification.probabilities.length !== 5) {
        this.reset();
        return { ...(classification || {}), count: 0, confidence: 0, fingers: [] };
      }
      const rawProbabilities = classification.probabilities.map((value) => Math.max(0, Math.min(1, Number(value) || 0)));
      const details = rawProbabilities.map((rawValue, index) => {
        const raw = Math.max(0, Math.min(1, Number(rawValue) || 0));
        // Mediana curta rejeita um pico isolado sem a cauda longa de uma EMA lenta.
        const samples = this.history[index];
        if (!samples.length) samples.push(raw, raw, raw);
        else { samples.push(raw); if (samples.length > 3) samples.shift(); }
        const filtered = [...samples].sort((a, b) => a - b)[1];
        const previous = this.probabilities[index];
        const probability = previous === null ? filtered : previous * (1 - this.alpha) + filtered * this.alpha;
        const threshold = FINGER_THRESHOLDS[index];
        if (this.fingers[index]) {
          if (probability <= threshold - this.closeMargin) this.fingers[index] = false;
        } else if (probability >= threshold + this.openMargin) {
          this.fingers[index] = true;
        }
        this.probabilities[index] = probability;
        const delta = probability - threshold;
        return {
          ...(classification.fingerDetails?.[index] || {}),
          name: FINGER_NAMES[index],
          probability,
          rawProbability: raw,
          threshold,
          extended: this.fingers[index],
          state: Math.abs(delta) < UNCERTAIN_MARGIN ? "UNCERTAIN" : this.fingers[index] ? "OPEN" : "CLOSED",
          certainty: Math.min(1, Math.abs(delta) * 2.35),
        };
      });
      const certainties = details.map((item) => item.certainty).sort((a, b) => a - b);
      return {
        ...classification,
        count: this.fingers.filter(Boolean).length,
        confidence: Math.min(classification.confidence ?? 1, certainties[0]),
        fingers: [...this.fingers],
        probabilities: [...this.probabilities],
        fingerDetails: details,
      };
    }
  }

  function classifyFingerCount(imageLandmarks, worldLandmarks, imageSize) {
    return classifyFingerCountDetails(imageLandmarks, worldLandmarks, imageSize).count;
  }

  window.QuantumGestureMath = Object.freeze({
    classifyFingerCount,
    classifyFingerCountDetails,
    FingerStateStabilizer,
    FINGER_NAMES,
    FINGER_THRESHOLDS,
    distance,
    jointAngle,
  });
})();
