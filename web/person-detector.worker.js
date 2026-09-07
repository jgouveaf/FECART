/* Classic worker: MediaPipe's WASM loader uses importScripts. No remote frames. */
let detector = null;
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
          return { confidence: d.categories.find(c => c.categoryName === "person").score,
            box: { x, y, width: Math.min(1 - x, b.width / width), height: Math.min(1 - y, b.height / height) } };
        });
      self.postMessage({ type: "result", id: data.id, capturedAt: data.capturedAt, people });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: data.id, message: error.message || String(error) });
  } finally { data.bitmap?.close(); }
};
