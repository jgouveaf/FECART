(() => {
  'use strict';
  function plan({ width, height, modeTwo, enrolling }) {
    const tracking = modeTwo && !enrolling;
    const scale = tracking ? Math.min(1, 640 / Math.max(width, height)) : 1;
    const inputWidth = Math.max(1, Math.round(width * scale));
    const inputHeight = Math.max(1, Math.round(height * scale));
    return { tracking, scaleX: width / inputWidth, scaleY: height / inputHeight,
      config: { identityFirst: tracking, filter: { width: inputWidth, height: inputHeight, return: false },
        face: { detector: { return: false, minSize: 70 * scale },
          iris: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } } } };
  }
  function restore(face, scaleX, scaleY) {
    if (scaleX === 1 && scaleY === 1) return face;
    // Never mutate Human's cached coordinates: otherwise scaling compounds.
    return { ...face, box: face.box.map((v, i) => v * (i % 2 ? scaleY : scaleX)),
      keypoints: face.keypoints?.map(p => [p[0] * scaleX, p[1] * scaleY]),
      mesh: face.mesh?.map(p => [p[0] * scaleX, p[1] * scaleY, (p[2] || 0) * scaleX]) };
  }
  const api = Object.freeze({ plan, restore });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.QuantumFaceProcessing = api;
})();
