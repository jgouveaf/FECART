(() => {
  'use strict';
  // Human supplies pixel coordinates and a flat list of triangle vertex indices.
  // Cache shared edges so each segment is drawn once, without another model.
  let topology = null;
  let edges = [];
  function draw(context, faces, triangles, width, height) {
    context.clearRect(0, 0, width, height);
    if (!Array.isArray(triangles)) return;
    if (topology !== triangles) {
      topology = triangles;
      const unique = new Map();
      for (let i = 0; i + 2 < triangles.length; i += 3) {
        const vertices = triangles.slice(i, i + 3);
        if (!vertices.every(v => Number.isInteger(v) && v >= 0 && v < 468)) continue;
        for (let j = 0; j < 3; j++) {
          const a = Math.min(vertices[j], vertices[(j + 1) % 3]);
          const b = Math.max(vertices[j], vertices[(j + 1) % 3]);
          if (a !== b) unique.set(`${a}:${b}`, [a, b]);
        }
      }
      edges = [...unique.values()];
    }
    context.save();
    context.strokeStyle = 'rgba(92, 174, 255, 0.65)';
    context.lineWidth = Math.max(.65, width / 1400);
    context.beginPath();
    for (const face of faces) {
      if (!Array.isArray(face.mesh) || face.mesh.length < 468) continue;
      for (const [a, b] of edges) {
        const first = face.mesh[a], second = face.mesh[b];
        if (![first, second].every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
        // The video is mirrored in CSS; this canvas is not. Mirror exactly once.
        context.moveTo(width - first[0], first[1]);
        context.lineTo(width - second[0], second[1]);
      }
    }
    context.stroke();
    context.restore();
  }
  const api = Object.freeze({ draw });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.QuantumFaceMesh = api;
})();
