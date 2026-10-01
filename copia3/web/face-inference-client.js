(() => {
  'use strict';
  class FaceInferenceClient {
    constructor() { this.worker = null; this.pending = null; this.sequence = 0; this.ready = false; this.capturing = false; }
    load(config) {
      if (this.loading) return this.loading;
      this.loading = this.initialize(config).finally(() => { this.loading = null; });
      return this.loading;
    }
    async initialize(config) {
      if (this.ready) return;
      this.close();
      const path = config.identityEngine === 'scrfd-sface-2021dec-v1' ? 'web/face-onnx.worker.js?v=4' : 'web/face-detector.worker.js?v=1';
      this.identityFirstSupported=config.identityEngine==='scrfd-sface-2021dec-v1';
      const worker = this.worker = new Worker(new URL(path, document.baseURI));
      worker.onmessage = ({ data }) => {
        if (worker !== this.worker) return;
        if (data.type === 'complete') {
          if (data.id === this.workFrameId) { this.releaseWork?.();this.releaseWork=null; }
          return;
        }
        if (data.type === 'mesh') {
          if (data.id === this.completedFrameId) this.onMesh?.(data);
          return;
        }
        if (data.id !== this.pending?.id) return;
        const task = this.pending; this.pending = null; clearTimeout(task.timer);
        // Identity/position is ready now. The optional mesh may continue in
        // the worker, but it must not hold the shared vision slot and delay
        // the body detector that drives Mode 2.
        this.releaseWork?.();this.releaseWork=null;
        if (data.error) task.reject(new Error(data.error));
        else {
          if (data.result) { this.completedFrameId = data.id; data.result.frameId = data.id; }
          task.resolve(data.result || data);
        }
      };
      worker.onerror = error => { if (worker === this.worker) this.close(new Error(error.message || 'Falha no detector facial.')); };
      worker.onmessageerror = () => { if (worker === this.worker) this.close(new Error('Resposta facial inválida.')); };
      try { await this.request({ type: 'init', config }, [], 90000); this.ready = true; }
      catch (error) { this.close(error); throw error; }
    }
    request(message, transfer = [], timeoutMs = 5000) {
      if (!this.worker || this.pending) return Promise.reject(new Error('Detector facial indisponível ou ocupado.'));
      return new Promise((resolve, reject) => {
        const id = ++this.sequence;
        const timer = setTimeout(() => this.close(new Error('Tempo de processamento facial esgotado.')), timeoutMs);
        this.pending = { id, resolve, reject, timer };
        try { this.worker.postMessage({ ...message, id }, transfer); }
        catch (error) { this.close(error); }
      });
    }
    async detect(video, config) {
      if (!this.ready || this.pending || this.capturing) throw new Error('Detector facial indisponível ou ocupado.');
      this.capturing = true;
      const worker = this.worker;
      let bitmap;
      try {
        const release=window.QuantumVisionScheduler ? await window.QuantumVisionScheduler.acquire() : null;
        if (worker !== this.worker) { release?.();throw new Error('Leitura facial cancelada.'); }
        this.releaseWork=release;
        const capturedAt=performance.now();
        bitmap = await createImageBitmap(video, { resizeWidth: config.filter.width, resizeHeight: config.filter.height, resizeQuality: 'high' });
        if (worker !== this.worker) throw new Error('Leitura facial cancelada.');
        this.holdUntilComplete=this.identityFirstSupported && config.identityFirst===true;
        this.workFrameId=this.sequence+1;
        const result=await this.request({ type: 'frame', bitmap, config }, [bitmap]);
        return {...result,capturedAt};
      } catch(error) {
        this.releaseWork?.();this.releaseWork=null;throw error;
      } finally { bitmap?.close(); this.capturing = false; }
    }
    close(error = new Error('Detector facial encerrado.')) {
      this.releaseWork?.();this.releaseWork=null;
      this.worker?.terminate(); this.worker = null; this.ready = false;
      this.completedFrameId = null;
      if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    }
  }
  const api = Object.freeze({ FaceInferenceClient });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.QuantumFaceInference = api;
})();
