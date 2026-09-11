/* Local enrollment assistance, not a security-grade biometric authenticator. */
(() => {
  'use strict';
  const overlap = (a, b) => {
    const area = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]))
      * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    return area / (a[2] * a[3] + b[2] * b[3] - area || 1);
  };
  const instructions = ['Olhe de frente para começar.', 'Vire levemente a cabeça para um dos lados.',
    'Volte de frente para concluir.'];
  class FacePresenceValidator {
    constructor({ similarity, threshold = .80 } = {}) {
      this.similarity = similarity || (() => 0);
      this.threshold = threshold;
      this.reset();
    }
    reset() {
      this.anchor = null; this.box = null; this.lastAt = null; this.startedAt = null;
      this.positiveAt = null; this.confirmedUntil = null; this.method = null;
      this.guidedAt = null; this.stage = 0; this.stageAt = null;
    }
    beginGuided(now) {
      if (this.lastAt == null || !Number.isFinite(now) || now - this.lastAt < 0 || now - this.lastAt > 800) return false;
      this.guidedAt = now; this.stage = 0; this.stageAt = null;
      this.confirmedUntil = null; this.method = null;
      return true;
    }
    update(sample, now = performance.now()) {
      const { capturedAt, box, embedding, eligible, real, live, yaw } = sample;
      if (!eligible || !Number.isFinite(capturedAt) || !Number.isFinite(now)
        || capturedAt > now || now - capturedAt > 800
        || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0
        || !Array.isArray(embedding) || embedding.length !== 1024 || !embedding.every(Number.isFinite)) {
        this.reset(); return { accepted: false, state: 'NO_FACE', message: 'Mantenha um único rosto nítido na imagem.' };
      }
      if (this.lastAt != null && capturedAt <= this.lastAt) {
        this.reset(); return { accepted: false, state: 'STALE', message: 'Aguarde uma imagem nova da câmera.' };
      }
      // Compare against a fixed descriptor; gradual drift cannot replace a face.
      if (this.anchor && (capturedAt - this.lastAt > 800 || overlap(box, this.box) < .35
        || !(this.similarity(embedding, this.anchor) >= this.threshold))) this.reset();
      if (!this.anchor) { this.anchor = embedding.slice(); this.startedAt = capturedAt; }
      this.box = box.slice(); this.lastAt = capturedAt;
      if (this.confirmedUntil != null && now <= this.confirmedUntil) return this.confirmed();
      if (this.confirmedUntil != null) {
        this.confirmedUntil = null; this.positiveAt = null; this.guidedAt = null; this.method = null;
      }
      const automatic = Number.isFinite(real) && Number.isFinite(live) && real >= .5 && live >= .5;
      if (automatic) {
        if (this.positiveAt == null) this.positiveAt = capturedAt;
        if (capturedAt - this.positiveAt >= 180) return this.approve('AUTO', now);
      } else this.positiveAt = null;
      if (this.guidedAt != null) {
        if (now - this.guidedAt > 15000) return { accepted: false, state: 'TIMEOUT', message: 'O movimento não foi concluído. Clique em confirmar por movimento para tentar novamente.' };
        const direction = Number.isFinite(yaw) && Math.abs(yaw) >= .18 && Math.abs(yaw) <= .55 ? Math.sign(yaw) : 0;
        const centered = Number.isFinite(yaw) && Math.abs(yaw) <= .10;
        const expected = this.stage === 1 ? direction !== 0 : centered;
        if (!expected) this.stageAt = null;
        else if (this.stageAt == null) this.stageAt = capturedAt;
        else if (capturedAt - this.stageAt >= 120) {
          this.stage++; this.stageAt = null;
          if (this.stage === instructions.length) return this.approve('MOVEMENT', now);
        }
        return { accepted: false, state: 'GUIDED', stage: this.stage, message: `${this.stage + 1}/3 · ${instructions[this.stage]}` };
      }
      return { accepted: false, state: 'CHECKING', message: capturedAt - this.startedAt < 2000
        ? 'Verificando presença para este cadastro…'
        : 'A avaliação automática não confirmou a presença. Use “Confirmar por movimento” e siga as instruções.' };
    }
    approve(method, now) {
      this.method = method; this.confirmedUntil = now + 30000; this.guidedAt = null;
      return this.confirmed();
    }
    confirmed() {
      return { accepted: true, state: 'CONFIRMED', method: this.method,
        message: `Presença confirmada ${this.method === 'MOVEMENT' ? 'por movimento' : 'automaticamente'}. Mantenha o rosto de frente e cadastre.` };
    }
  }
  const api = Object.freeze({ FacePresenceValidator });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.QuantumFacePresence = api;
})();
