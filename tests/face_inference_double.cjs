// Replace the inference boundary only. Production never detects test doubles.
module.exports = async context => context.route('**/web/face-inference-client.js?*', route => route.fulfill({
  contentType: 'text/javascript', body: `window.QuantumFaceInference = { FaceInferenceClient: class {
    ready = false;
    async load(config) { this.human = new window.Human.Human(config); await this.human.load(); await this.human.warmup(); this.ready = true; }
    detect(video, config) { return this.human.detect(video, config); }
    close() { this.ready = false; }
  } };`
}));
