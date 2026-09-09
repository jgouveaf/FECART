/* Small clothing descriptor for continuous Mode 2 tracking, never a person ID.
 * Two spatial bands; soft hue bins and separate neutral brightness bins.
 * No images/descriptors are persisted or sent outside the local worker. */
(() => {
  'use strict';
  const BAND_SIZE = 20;
  function describe(rgba, width, height) {
    if (!rgba || width < 8 || height < 16 || rgba.length !== width * height * 4) return null;
    const bins = Array(BAND_SIZE * 2).fill(0), counts = [0, 0];
    for (let y = 0; y < height; y++) {
      const band = y < height / 2 ? 0 : 1, offset = band * BAND_SIZE;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] < 250) continue;
        const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
        if (delta < .10 || max < .12 || delta / max < .20) {
          bins[offset + 16 + Math.min(3, Math.floor(max * 4))]++;
        } else {
          let h = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
          h = ((h / 6 + 1) % 1) * 16;
          const low = Math.floor(h), fraction = h - low;
          bins[offset + low] += 1 - fraction;
          bins[offset + (low + 1) % 16] += fraction;
        }
        counts[band]++;
      }
    }
    if (counts.some(n => n < width * height * .45)) return null;
    return bins.map((v, i) => v / counts[Math.floor(i / BAND_SIZE)]);
  }
  function valid(bins) {
    if (!Array.isArray(bins) || bins.length !== BAND_SIZE * 2 || !bins.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return false;
    return [0, BAND_SIZE].every(start => Math.abs(bins.slice(start, start + BAND_SIZE).reduce((a, b) => a + b, 0) - 1) < .01);
  }
  function similarity(a, b) {
    if (!valid(a) || !valid(b)) return 0;
    // Both torso and lower body must agree; one similar shirt is insufficient.
    return Math.min(...[0, BAND_SIZE].map(start => a.slice(start, start + BAND_SIZE)
      .reduce((sum, v, i) => sum + Math.sqrt(v * b[start + i]), 0)));
  }
  const api = Object.freeze({ describe, valid, similarity });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.QuantumPersonAppearance = api;
})();
