/* Local Human inference. The UI and USB heartbeat never run these models. */
importScripts('./vendor/human/human.js?v=3.3.6');
let human = null, busy = false, surface = null;
self.onmessage = async ({ data }) => {
  if (busy) { data.bitmap?.close(); self.postMessage({ id: data.id, error: 'Leitura facial já em andamento.' }); return; }
  busy = true;
  try {
    if (data.type === 'init') {
      human = new Human.Human({ ...data.config, backend: 'wasm',
        wasmPath: new URL('./vendor/human/wasm/', self.location.href).href,
        filter: { ...data.config.filter, enabled: false, return: false },
        face: { ...data.config.face, detector: { ...data.config.face.detector, return: false } } });
      await human.load(); await human.warmup();
      self.postMessage({ id: data.id, type: 'ready' });
    } else if (data.type === 'frame') {
      if (!human) throw new Error('Detector facial não está pronto.');
      const { width, height } = data.bitmap;
      if (!surface || surface.width !== width || surface.height !== height) surface = new OffscreenCanvas(width, height);
      const ctx = surface.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(data.bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, width, height);
      const result = await human.detect(pixels, data.config);
      if (result.error) throw new Error(result.error);
      // Return plain observations only; tensors and canvases stay in this worker.
      const faces = result.face.map(({ tensor, ...face }) => { if (tensor) human.tf.dispose(tensor); return face; });
      self.postMessage({ id: data.id, type: 'result', result: { face: faces, gesture: result.gesture || [],
        backend: human.tf.getBackend(), performance: { total: human.performance.total } } });
    }
  } catch (error) { self.postMessage({ id: data.id, error: error.message || String(error) }); }
  finally { data.bitmap?.close(); busy = false; }
};
