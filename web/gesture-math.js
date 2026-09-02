(() => {
  "use strict";

  const EPSILON = 1e-6;

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
    const probability = weightedProbability([
      [thresholdScore(straightness, 0.78, 0.24), 0.36],
      [thresholdScore(jointAngle(points[mcp], points[pip], points[dip]), 125, 70), 0.22],
      [thresholdScore(jointAngle(points[pip], points[dip], points[tip]), 130, 65), 0.18],
      [thresholdScore(distance(points[tip], points[mcp]) / palmScale, 0.56, 0.32), 0.14],
      [thresholdScore((distance(points[tip], palmCenter) - distance(points[pip], palmCenter)) / palmScale, 0.05, 0.24), 0.10],
    ]);
    return { extended: probability >= 0.52, probability, certainty: Math.min(1, Math.abs(probability - 0.52) * 2.3) };
  }

  function evaluateThumb(points, palmScale, palmCenter) {
    const chainLength = distance(points[1], points[2])
      + distance(points[2], points[3]) + distance(points[3], points[4]);
    const straightness = distance(points[1], points[4]) / Math.max(chainLength, EPSILON);
    const probability = weightedProbability([
      [thresholdScore(straightness, 0.76, 0.28), 0.25],
      [thresholdScore(jointAngle(points[1], points[2], points[3]), 125, 70), 0.14],
      [thresholdScore(jointAngle(points[2], points[3], points[4]), 130, 65), 0.14],
      [thresholdScore(distance(points[4], palmCenter) / palmScale, 0.82, 0.42), 0.19],
      [thresholdScore(distance(points[4], points[5]) / palmScale, 0.58, 0.34), 0.20],
      [thresholdScore((distance(points[4], palmCenter) - distance(points[3], palmCenter)) / palmScale, 0.05, 0.24), 0.08],
    ]);
    return { extended: probability >= 0.54, probability, certainty: Math.min(1, Math.abs(probability - 0.54) * 2.4) };
  }

  function fingerExtended(points, mcp, pip, dip, tip, palmScale, palmCenter) {
    return evaluateFinger(points, mcp, pip, dip, tip, palmScale, palmCenter).extended;
  }

  function thumbExtended(points, palmScale, palmCenter) {
    return evaluateThumb(points, palmScale, palmCenter).extended;
  }

  function evaluateHand(points) {
    if (!points || points.length !== 21) return { count: 0, confidence: 0, fingers: [] };
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

  function classifyFingerCountDetails(imageLandmarks, worldLandmarks) {
    const image = evaluateHand(imageLandmarks);
    const world = worldLandmarks?.length === 21 ? evaluateHand(worldLandmarks) : null;
    const sources = [image, world].filter((item) => item?.evaluations);
    if (!sources.length) return { count: 0, confidence: 0, fingers: [] };
    const evaluations = image?.evaluations && world?.evaluations
      ? image.evaluations.map((item, index) => {
        const probability = item.probability * 0.62 + world.evaluations[index].probability * 0.38;
        const threshold = index === 0 ? 0.54 : 0.52;
        return { probability, extended: probability >= threshold, certainty: Math.min(1, Math.abs(probability - threshold) * 2.35) };
      })
      : sources[0].evaluations;
    const fingers = evaluations.map((item) => item.extended);
    const certainties = evaluations.map((item) => item.certainty).sort((a, b) => a - b);
    const confidence = certainties[Math.floor(certainties.length / 2)];
    return {
      count: fingers.filter(Boolean).length,
      confidence: Math.max(0, Math.min(1, confidence)),
      fingers,
      probabilities: evaluations.map((item) => item.probability),
      palmScale: image?.palmScale || world?.palmScale,
    };
  }

  function classifyFingerCount(imageLandmarks, worldLandmarks) {
    return classifyFingerCountDetails(imageLandmarks, worldLandmarks).count;
  }

  window.QuantumGestureMath = Object.freeze({ classifyFingerCount, classifyFingerCountDetails, distance, jointAngle });
})();
