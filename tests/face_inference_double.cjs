// Replace the inference boundary only. Production never detects test doubles.
module.exports = async context => {
  // These existing regressions exercise the retained Human gallery. New ONNX
  // enrollment and mixed backups are covered separately with their own boundary.
  const fs = require('node:fs'), path = require('node:path');
  await context.route('**/web/face-identity-profiles.js?*', route => route.fulfill({contentType:'text/javascript',
    body:fs.readFileSync(path.join(__dirname,'../web/face-identity-profiles.js'),'utf8').replace('const DEFAULT_ENGINE = ONNX;', 'const DEFAULT_ENGINE = HUMAN;')}));
  return context.route('**/web/face-inference-client.js?*', route => route.fulfill({
  contentType: 'text/javascript', body: `window.QuantumFaceInference = { FaceInferenceClient: class {
    ready = false;
    async load(config) { this.human = new window.Human.Human(config); await this.human.load(); await this.human.warmup(); this.ready = true; }
    detect(video, config) { return this.human.detect(video, config); }
    close() { this.ready = false; }
  } };`
}));
};
