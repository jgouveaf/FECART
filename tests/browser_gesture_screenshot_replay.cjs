// Diagnostico opcional das capturas fornecidas pelo operador. Nenhuma camera,
// USB ou API externa. Overlays nas capturas podem alterar os landmarks;
// isto nao substitui uma sequencia de video/landmarks rotulada pelo operador.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '..');
const inputs = process.argv.slice(2).map(file => path.resolve(file));
if (!inputs.length) throw new Error('Forneca caminhos explicitos das capturas para analisar.');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<html><body></body></html>'); }
  const fixture = /^\/fixture\/(\d+)$/.exec(url.pathname);
  let file;
  if (fixture) { file = inputs[Number(fixture[1])]; res.setHeader('Content-Type', 'image/png'); }
  else {
    file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
  }
  if (!file) { res.statusCode = 404; return res.end(); }
  fs.readFile(file, (err, data) => { res.statusCode = err ? 404 : 200; res.end(err ? '' : data); });
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ path: path.join(root, 'web/gesture-math.js') });
    // Baseline somente na memoria, sem mudar arquivos do checkout.
    const baseline = require('node:child_process').execFileSync('git', ['show', 'ce9a535:web/gesture-math.js'], { cwd: root, encoding: 'utf8' });
    await page.evaluate(() => { window.updatedGestureMath = window.QuantumGestureMath; });
    await page.addScriptTag({ content: baseline });
    const results = await page.evaluate(async count => {
      const { HandLandmarker, FilesetResolver } = await import('/web/vendor/mediapipe/vision_bundle.js');
      const vision = await FilesetResolver.forVisionTasks('/web/vendor/mediapipe/wasm');
      const model = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/web/vendor/mediapipe/hand_landmarker.task', delegate: 'CPU' },
        runningMode: 'IMAGE', numHands: 1, minHandDetectionConfidence: .65, minHandPresenceConfidence: .65,
      });
      const output = [];
      try {
        for (let i = 0; i < count; i++) {
          const img = new Image(); img.src = `/fixture/${i}`; await img.decode();
          const result = model.detect(img);
          if (!result.landmarks.length) { output.push({ fixture: i + 1, detected: false }); continue; }
          const points = result.landmarks[0], world = result.worldLandmarks[0];
          const summarize = (api, size) => {
            const raw = api.classifyFingerCountDetails(points, world, size);
            const filter = new api.FingerStateStabilizer();
            let stable; for (let n = 0; n < 8; n++) stable = filter.update(raw);
            return { rawCount: raw.count, count: stable.count, confidence: stable.confidence,
              fingers: stable.fingerDetails.map(f => ({ name: f.name, probability: f.probability, metrics: f.metrics })) };
          };
          output.push({ fixture: i + 1, detected: true, before: summarize(window.QuantumGestureMath),
            after: summarize(window.updatedGestureMath, { width: img.width, height: img.height }) });
        }
      } finally { model.close(); }
      return output;
    }, inputs.length);
    console.log(JSON.stringify(results));
  } finally { await browser?.close(); server.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
