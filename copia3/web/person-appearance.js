/* Small clothing descriptor for continuous Mode 2 tracking, never a person ID.
 * Two spatial bands; hue/neutral, brightness and saturation distributions.
 * No images/descriptors are persisted or sent outside the local browser. */
(() => {
  'use strict';
  const BAND_SIZE = 28;
  function softBins(bins, offset, value) {
    const position = Math.max(0, Math.min(1, value)) * 3;
    const low = Math.floor(position), fraction = position - low;
    bins[offset + low] += 1 - fraction;
    if (fraction) bins[offset + low + 1] += fraction;
  }
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
        const saturation = max ? delta / max : 0;
        if (delta < .10 || max < .12 || saturation < .20) {
          softBins(bins, offset + 16, max);
        } else {
          let h = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
          h = ((h / 6 + 1) % 1) * 16;
          const low = Math.floor(h), fraction = h - low;
          bins[offset + low] += 1 - fraction;
          bins[offset + (low + 1) % 16] += fraction;
        }
        softBins(bins, offset + 20, max);
        softBins(bins, offset + 24, saturation);
        counts[band]++;
      }
    }
    if (counts.some(n => n < width * height * .45)) return null;
    return bins.map((v, i) => v / counts[Math.floor(i / BAND_SIZE)]);
  }
  function valid(bins) {
    if (!Array.isArray(bins) || bins.length !== BAND_SIZE * 2 || !bins.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return false;
    return [0, BAND_SIZE].every(start => [[0, 20], [20, 24], [24, 28]].every(([a, b]) =>
      Math.abs(bins.slice(start + a, start + b).reduce((sum, value) => sum + value, 0) - 1) < .01));
  }
  function similarity(a, b) {
    if (!valid(a) || !valid(b)) return 0;
    // Both torso and lower body must agree; one similar shirt is insufficient.
    const coefficient = (start, length) => a.slice(start, start + length)
      .reduce((sum, v, i) => sum + Math.sqrt(v * b[start + i]), 0);
    return Math.min(...[0, BAND_SIZE].map(start => Math.min(coefficient(start, 20),
      .70 + .30 * coefficient(start + 20, 4), .75 + .25 * coefficient(start + 24, 4))));
  }
  const api = Object.freeze({ describe, valid, similarity });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.QuantumPersonAppearance = api;
})();
