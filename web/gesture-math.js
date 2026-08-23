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

  function fingerExtended(points, mcp, pip, dip, tip, palmScale) {
    const pipStraight = jointAngle(points[mcp], points[pip], points[dip]) >= 148;
    const dipStraight = jointAngle(points[pip], points[dip], points[tip]) >= 145;
    const reachesOut = distance(points[tip], points[0])
      >= distance(points[pip], points[0]) + palmScale * 0.08;
    return pipStraight && dipStraight && reachesOut;
  }

  function thumbExtended(points, palmScale) {
    const mcpStraight = jointAngle(points[1], points[2], points[3]) >= 132;
    const ipStraight = jointAngle(points[2], points[3], points[4]) >= 145;
    const awayFromPalm = distance(points[4], points[9]) >= palmScale * 0.96;
    const awayFromIndex = distance(points[4], points[5]) >= palmScale * 0.72;
    const reachesOut = distance(points[4], points[0])
      >= distance(points[3], points[0]) + palmScale * 0.04;
    return mcpStraight && ipStraight && awayFromPalm && awayFromIndex && reachesOut;
  }

  function classifyFingerCount(imageLandmarks, worldLandmarks) {
    const points = worldLandmarks?.length === 21 ? worldLandmarks : imageLandmarks;
    if (!points || points.length !== 21) return 0;
    const palmScale = Math.max(distance(points[0], points[9]), distance(points[5], points[17]));
    if (palmScale < EPSILON) return 0;
    const fingers = [
      fingerExtended(points, 5, 6, 7, 8, palmScale),
      fingerExtended(points, 9, 10, 11, 12, palmScale),
      fingerExtended(points, 13, 14, 15, 16, palmScale),
      fingerExtended(points, 17, 18, 19, 20, palmScale),
    ];
    return fingers.filter(Boolean).length + Number(thumbExtended(points, palmScale));
  }

  window.QuantumGestureMath = Object.freeze({ classifyFingerCount, distance, jointAngle });
})();
