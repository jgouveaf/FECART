/* Classic worker: MediaPipe's WASM loader uses importScripts. No remote frames. */
let detector = null;
importScripts('./person-appearance.js?v=1');
const appearanceCanvas = new OffscreenCanvas(24, 48);
const appearanceContext = appearanceCanvas.getContext('2d', { willReadFrequently: true });
function appearance(bitmap, box) {
  // Avoid unstable clothing samples from tiny or cropped detections.
  if (!appearanceContext || box.width * bitmap.width < 40 || box.height * bitmap.height < 80
    || box.y + box.height > .985 || box.x < .01 || box.x + box.width > .99) return null;
  const x = (box.x + box.width * .22) * bitmap.width;
  const y = (box.y + box.height * .20) * bitmap.height;
  appearanceContext.drawImage(bitmap, x, y, box.width * .56 * bitmap.width, box.height * .65 * bitmap.height, 0, 0, 24, 48);
  return self.QuantumPersonAppearance.describe(appearanceContext.getImageData(0, 0, 24, 48).data, 24, 48);
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const { FilesetResolver, ObjectDetector } = await import("./vendor/mediapipe/vision_bundle.js");
      const response = await fetch(new URL("./vendor/mediapipe/models/efficientdet_lite0.tflite", self.location.href));
      if (!response.ok) throw new Error(`Modelo de pessoas indisponível: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map(v => v.toString(16).padStart(2, "0")).join("");
      if (hash !== "0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb") throw new Error("Integridade do modelo não confere.");
      const files = await FilesetResolver.forVisionTasks(new URL("./vendor/mediapipe/wasm", self.location.href).href);
      detector = await ObjectDetector.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: new Uint8Array(bytes), delegate: "CPU" },
        runningMode: "VIDEO", scoreThreshold: 0.50, maxResults: 6, categoryAllowlist: ["person"],
      });
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      if (!detector) throw new Error("Detector não está pronto.");
      const width = data.bitmap.width, height = data.bitmap.height;
      const result = detector.detectForVideo(data.bitmap, data.capturedAt);
      const people = result.detections.filter(d => d.categories.some(c => c.categoryName === "person"))
        .map(d => {
          const b = d.boundingBox;
          const x = Math.max(0, b.originX / width), y = Math.max(0, b.originY / height);
          const box = { x, y, width: Math.min(1 - x, b.width / width), height: Math.min(1 - y, b.height / height) };
          return { confidence: d.categories.find(c => c.categoryName === "person").score,
            box, appearance: appearance(data.bitmap, box) };
        });
      self.postMessage({ type: "result", id: data.id, capturedAt: data.capturedAt, people });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: data.id, message: error.message || String(error) });
  } finally { data.bitmap?.close(); }
};
