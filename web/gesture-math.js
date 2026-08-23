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

  function fingerExtended(points, mcp, pip, dip, tip, palmScale, palmCenter) {
    const pipAngle = jointAngle(points[mcp], points[pip], points[dip]);
    const dipAngle = jointAngle(points[pip], points[dip], points[tip]);
    const longEnough = distance(points[tip], points[mcp]) >= palmScale * 0.56;
    const reachesFromWrist = distance(points[tip], points[0])
      >= distance(points[pip], points[0]) + palmScale * 0.08;
    const clearsPalm = distance(points[tip], palmCenter)
      >= distance(points[pip], palmCenter) + palmScale * 0.08;
    return longEnough && reachesFromWrist && clearsPalm && pipAngle >= 105 && dipAngle >= 105;
  }

  function thumbExtended(points, palmScale, palmCenter) {
    const mcpStraight = jointAngle(points[1], points[2], points[3]) >= 105;
    const ipStraight = jointAngle(points[2], points[3], points[4]) >= 110;
    const awayFromPalm = distance(points[4], palmCenter) >= palmScale * 0.82;
    const awayFromIndex = distance(points[4], points[5]) >= palmScale * 0.55;
    const reachesOut = distance(points[4], palmCenter)
      >= distance(points[3], palmCenter) + palmScale * 0.08;
    return mcpStraight && ipStraight && awayFromPalm && awayFromIndex && reachesOut;
  }

  function classifyFingerCount(imageLandmarks, worldLandmarks) {
    const points = worldLandmarks?.length === 21 ? worldLandmarks : imageLandmarks;
    if (!points || points.length !== 21) return 0;
    const palmScale = Math.max(distance(points[0], points[9]), distance(points[5], points[17]));
    if (palmScale < EPSILON) return 0;
    const palmCenter = average([points[0], points[5], points[9], points[13], points[17]]);
    const fingers = [
      fingerExtended(points, 5, 6, 7, 8, palmScale, palmCenter),
      fingerExtended(points, 9, 10, 11, 12, palmScale, palmCenter),
      fingerExtended(points, 13, 14, 15, 16, palmScale, palmCenter),
      fingerExtended(points, 17, 18, 19, 20, palmScale, palmCenter),
    ];
    return fingers.filter(Boolean).length + Number(thumbExtended(points, palmScale, palmCenter));
  }

  window.QuantumGestureMath = Object.freeze({ classifyFingerCount, distance, jointAngle });
})();
