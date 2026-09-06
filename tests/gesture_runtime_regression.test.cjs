// Geometria sintetica + controlador real com relogio/camera simulados. Sem USB.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const mathSource = fs.readFileSync(path.join(root, 'web/gesture-math.js'), 'utf8');
function math() {
  const context = { window: {} };
  vm.runInNewContext(mathSource, context);
  return context.window.QuantumGestureMath;
}
const p = (x, y, z = 0) => ({ x, y, z });
function hand(mask) {
  const pts = Array.from({ length: 21 }, () => p(0, 0));
  pts[0] = p(0, -.09, .005);
  [-.032, 0, .031, .057].forEach((x, i) => {
    const j = 5 + 4 * i;
    pts[j] = p(x, 0, i * .001);
    const chain = mask & (1 << (i + 1))
      ? [p(x + .003, .04, -.004), p(x + .006, .074, -.008), p(x + .010, .106, -.010)]
      : [p(x + .004, .033, -.002), p(x + .016, .020, -.014), p(x + .012, .002, -.008)];
    chain.forEach((pt, k) => { pts[j + 1 + k] = pt; });
  });
  pts[1] = p(-.035, -.022, .003);
  const thumb = mask & 1
    ? [p(-.061, -.002, -.002), p(-.088, .022, -.008), p(-.116, .047, -.011)]
    : [p(-.046, -.001, -.002), p(-.026, .023, -.012), p(.003, .024, -.006)];
  thumb.forEach((pt, k) => { pts[k + 2] = pt; });
  return pts;
}
test('conta literalmente todos os 32 conjuntos, incluindo polegar sem quatro dedos longos', () => {
  const api = math();
  for (let mask = 0; mask < 32; mask++) {
    const stabilizer = new api.FingerStateStabilizer();
    let result;
    for (let n = 0; n < 8; n++) result = stabilizer.update(api.classifyFingerCountDetails(hand(mask), hand(mask)));
    assert.equal(result.count, mask.toString(2).replace(/0/g, '').length, `mask=${mask}`);
  }
});
test('um dedo incerto nao recebe confianca alta dos outros quatro', () => {
  const result = new (math().FingerStateStabilizer)().update({ probabilities: [.99, .99, .99, .99, .52] });
  assert.ok(result.confidence < .3, `confidence=${result.confidence}`);
});
test('corrige a proporcao do video antes de medir distancias e angulos', () => {
  const api = math();
  const base = hand(30);
  const expected = api.classifyFingerCountDetails(base);
  for (const [width, height] of [[1280, 720], [640, 480], [720, 1280]]) {
    const normalized = base.map(pt => ({ x: pt.x + .5, y: pt.y * width / height + .5, z: pt.z }));
    const actual = api.classifyFingerCountDetails(normalized, null, { width, height });
    actual.probabilities.forEach((score, i) => assert.ok(Math.abs(score - expected.probabilities[i]) < 1e-8, `aspect ${width}/${height} finger ${i}`));
  }
});
test('landmarks malformados nao produzem uma contagem confiavel', () => {
  const api = math();
  const points = hand(31); points[8].x = NaN;
  assert.equal(api.classifyFingerCountDetails(points).confidence, 0);
});
test('polegar reto mas cruzado sobre a palma nao vira quinto dedo', () => {
  const api = math();
  const points = hand(30);
  points[1] = p(-.055, -.035);
  points[2] = p(-.028, -.008);
  points[3] = p(0, .019);
  points[4] = p(.029, .046);
  const result = api.classifyFingerCountDetails(points);
  assert.equal(result.count, 4);
});
test('divergencia entre imagem e mundo nao pode confirmar a contagem', () => {
  const result = math().classifyFingerCountDetails(hand(31), hand(30));
  assert.ok(result.confidence < .3, `confidence=${result.confidence}`);
});

test('dedos retos dobrados na base nao contam como levantados, inclusive com profundidade', () => {
  const api = math();
  // Fixture inventada: falanges alinhadas, mas apontando para dentro da palma.
  // O teste anterior de PIP/DIP e alcance aceitava essa geometria como aberta.
  for (const count of [0, 1, 2, 3]) {
    for (const depth of [0, .03]) {
      const points = hand((1 << (count + 1)) - 2);
      for (let finger = count; finger < 4; finger++) {
        const base = 5 + finger * 4;
        for (let joint = 1; joint <= 3; joint++) {
          points[base + joint] = p(points[base].x, -.025 * joint, depth * joint);
        }
      }
      for (const angle of [0, .7, 1.5, Math.PI]) {
        // Rotacao em 3D, espelhamento, escala e translacao preservam a pose.
        const rotated = points.map(pt => p(.5 - pt.x * 2,
          .5 + 2 * (pt.y * Math.cos(angle) - pt.z * Math.sin(angle)),
          2 * (pt.y * Math.sin(angle) + pt.z * Math.cos(angle))));
        const result = api.classifyFingerCountDetails(rotated, rotated);
        assert.equal(result.count, count, `count=${count} depth=${depth} angle=${angle}`);
        assert.ok(result.confidence >= .65, `folded confidence=${result.confidence}`);
      }
    }
  }
});

test('alcance grande por primeira falange curta nao abre dedo voltado para a palma', () => {
  const points = hand(2);
  points[13] = p(.031, 0);
  points[14] = p(.031, -.001);
  points[15] = p(.033, -.030);
  points[16] = p(.036, -.050);
  const result = math().classifyFingerCountDetails(points, points);
  assert.equal(result.count, 1);
  assert.equal(result.fingers[3], false);
  assert.ok(result.confidence >= .65);
});

function controller(config = {}) {
  let now = 1000, current, nextFrame;
  const elements = new Map(), events = [];
  const noop = () => {};
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', dataset: {}, width: 1280, height: 720, videoWidth: 1280, videoHeight: 720,
      currentTime: 0, readyState: 3, classList: { add: noop, remove: noop, toggle: noop },
      setAttribute: noop, addEventListener: noop, querySelector: () => null,
      getContext: () => new Proxy({}, { get: () => noop }),
    });
    return elements.get(id);
  }
  const context = { console, performance: { now: () => now },
    requestAnimationFrame: cb => { nextFrame = cb; return 1; }, cancelAnimationFrame: noop,
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    document: { getElementById: element, querySelectorAll: () => [], baseURI: 'https://example.test/' },
    window: { location: { protocol: 'https:' }, addEventListener: noop, dispatchEvent: event => events.push(event),
      setTimeout: () => 1, clearTimeout: noop, quantumCameraController: { active: true },
      QuantumControl: { state: { mode: { id: 3 }, robot: { connected: false } }, patch: noop, log: noop },
      QuantumGestureMath: { classifyFingerCountDetails: () => current, FingerStateStabilizer: class { reset() {} update(c) { return c; } } },
    },
  };
  if (config.gestureMap) context.window.QuantumUserConfig = { get: () => ({ minConfidence: .65, commandCooldownMs: 650, unstableStopMs: 500, ...config }) };
  let source = fs.readFileSync(path.join(root, 'web/camera-gestures.js'), 'utf8');
  source = source.replace('window.quantumGestureController = Object.freeze({', `window.testGesture = {
    processResult, confirmTemporal,
    start() { model = { detectForVideo() { return { landmarks: [Array.from({length:21},()=>({x:.5,y:.5,z:0}))] }; } }; enabled=true; active=true; activeView='hand'; startLoop(); }
  }; window.quantumGestureController = Object.freeze({`);
  vm.runInNewContext(source, context);
  function classification(count, confidence = 1) { current = { count, confidence, fingers: [], probabilities: [] }; }
  function frame(count, at, confidence = 1) {
    now = at; classification(count, confidence);
    context.window.testGesture.processResult({ landmarks: [hand(31)] }, now);
  }
  return { frame, events, element,
    noHand: at => { now = at; context.window.testGesture.processResult({ landmarks: [] }, now); },
    commands: () => events.filter(e => e.type === 'quantum:gesture-command').map(e => e.detail),
    start: (count, at) => { now = at; classification(count); context.window.testGesture.start(); },
    tick: at => { now = at; nextFrame(at); },
  };
}
test('confirma movimento em 150ms de quadros claros, sem exigir quatro quadros', () => {
  const h = controller();
  [1000, 1075, 1150].forEach(t => h.frame(1, t));
  assert.equal(h.commands().at(-1)?.command, 'FRENTE');
});
test('PARAR remapeado tem prioridade rapida igual ao gesto padrao', () => {
  const h = controller({ gestureMap: { 1: 'PARAR', 2: 'DIREITA', 3: 'ESQUERDA', 4: 'FRENTE', 5: 'GIRAR' } });
  h.frame(1, 1000); h.frame(1, 1075);
  assert.equal(h.commands().at(-1)?.command, 'PARAR');
});
test('contagem incerta nao aparece como numero confirmado nem manda movimento', () => {
  const h = controller();
  for (let n = 0; n < 20; n++) h.frame(5, 1000 + n * 75, .1);
  assert.equal(h.commands().length, 0);
  assert.equal(h.element('gestureCommand').textContent, 'LEITURA INCERTA');
  assert.doesNotMatch(h.element('fingerCount').textContent, /5 dedo/);
});
test('quadros separados por uma pausa nao se somam como confirmacao continua', () => {
  const h = controller();
  [1000, 1100, 1200].forEach(t => h.frame(2, t, .4));
  [2000, 2100, 2200].forEach(t => h.frame(2, t));
  assert.equal(h.commands().at(-1)?.command, 'DIREITA');
  h.frame(3, 2300); h.frame(3, 2400); h.frame(3, 4000);
  assert.equal(h.commands().some(c => c.command === 'ESQUERDA'), false);
  assert.equal(h.commands().at(-1)?.command, 'PARAR');
});
test('video congelado manda PARAR mesmo sem receber resultado novo do modelo', () => {
  const h = controller();
  [1000, 1100, 1200, 1300].forEach(t => h.frame(1, t));
  h.start(1, 1350); h.tick(1400); h.tick(2100);
  assert.equal(h.commands().at(-1)?.command, 'PARAR');
});
test('nao anuncia gesto confirmado enquanto comando esta retido no cooldown', () => {
  const h = controller();
  [1000, 1085, 1170, 1255].forEach(t => h.frame(4, t));
  [1340, 1425, 1510, 1595].forEach(t => h.frame(5, t));
  if (h.commands().at(-1)?.command !== 'GIRAR') assert.notEqual(h.element('gestureCommand').textContent, 'GIRAR');
});
test('geometria e filtros juntos nao emitem GIRAR por um pico de polegar no gesto de re', () => {
  const api = math(), filter = new api.FingerStateStabilizer(), h = controller();
  for (let n = 0; n < 20; n++) {
    const points = hand(n === 10 ? 31 : 30);
    const result = filter.update(api.classifyFingerCountDetails(points, points));
    h.frame(result.count, 1000 + n * 75, result.confidence);
  }
  assert.equal(h.commands().some(c => c.command === 'GIRAR'), false);
  assert.equal(h.commands().at(-1)?.command, 'TRAS');
});
test('a cadeia completa troca de cinco para quatro em ate 450ms a 13FPS sinteticos', () => {
  const api = math(), filter = new api.FingerStateStabilizer(), h = controller();
  for (let n = 0; n < 15; n++) {
    const points = hand(n < 8 ? 31 : 30);
    const result = filter.update(api.classifyFingerCountDetails(points, points));
    h.frame(result.count, 1000 + n * 75, result.confidence);
  }
  assert.equal(h.commands()[0]?.command, 'GIRAR');
  const reverse = h.commands().find(c => c.command === 'TRAS');
  assert.ok(reverse && reverse.emittedAt - 1600 <= 450, JSON.stringify(h.commands()));
});

test('quatro dedos exige confirmacao de movimento e mantem re somente com evidencia viva', () => {
  const h = controller();
  h.frame(4, 1000); h.frame(4, 1075);
  assert.equal(h.commands().length, 0, 're nao herda confirmacao rapida de PARAR');
  for (let at = 1150; at <= 3550; at += 75) h.frame(4, at);
  assert.ok(h.commands().length >= 5, 'renova o comando enquanto o gesto persiste');
  assert.ok(h.commands().every(c => c.command === 'TRAS'));
  h.noHand(3600);
  assert.equal(h.commands().at(-1)?.command, 'PARAR');
  assert.equal(h.commands().at(-1)?.emittedAt, 3600);
  assert.equal(h.element('gestureCommand').textContent, 'PARAR');
  for (let at = 3700; at < 5000; at += 100) h.noHand(at);
  assert.equal(h.commands().at(-1)?.command, 'PARAR');
  h.frame(4, 5100); h.frame(4, 5175);
  assert.equal(h.commands().at(-1)?.command, 'PARAR', 'voltar a mao exige nova confirmacao');
  h.frame(4, 5250);
  assert.equal(h.commands().at(-1)?.command, 'TRAS');
});

test('mao fechada para e gesto incerto nao pode manter re por configuracao antiga de 3s', () => {
  const h = controller({ gestureMap: { 1: 'FRENTE', 2: 'DIREITA', 3: 'ESQUERDA', 4: 'TRAS', 5: 'GIRAR' }, unstableStopMs: 3000 });
  [1000, 1075, 1150].forEach(at => h.frame(4, at));
  h.frame(0, 1200);
  assert.equal(h.commands().at(-1)?.command, 'PARAR');
  [2000, 2075, 2150].forEach(at => h.frame(4, at));
  for (let at = 2200; at <= 2700; at += 100) h.frame(4, at, .1);
  assert.equal(h.commands().at(-1)?.command, 'PARAR');
  assert.equal(h.commands().at(-1)?.emittedAt, 2700);
});

test('configuracao migra 4=PARAR antigo para re sem apagar os outros ajustes', () => {
  function config(raw) {
    const storage = new Map(raw ? [['quantumUserConfig:v1', JSON.stringify(raw)]] : []);
    const context = { CustomEvent: class { constructor(type, init) { this.detail = init.detail; } }, window: {
      dispatchEvent() {}, localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
      },
    } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'web/user-config.js'), 'utf8'), context);
    return { api: context.window.QuantumUserConfig, stored: () => JSON.parse(storage.get('quantumUserConfig:v1') || 'null') };
  }
  assert.equal(config().api.get().gestureMap[4], 'TRAS');
  const old = { gestureMap: { 1: 'GIRAR', 4: 'PARAR' }, minConfidence: .8, commandCooldownMs: 700, unstableStopMs: 3000 };
  const loaded = config(old);
  assert.equal(loaded.api.get().gestureMap[4], 'TRAS');
  assert.equal(loaded.api.get().gestureMap[1], 'GIRAR');
  assert.equal(loaded.api.get().minConfidence, .8);
  assert.equal(loaded.api.get().commandCooldownMs, 700);
  assert.equal(loaded.api.get().unstableStopMs, 500);
  loaded.api.save({ gestureMap: { 4: 'PARAR' } });
  assert.equal(config(loaded.stored()).api.get().gestureMap[4], 'PARAR', 'remapeamento novo explicito deve persistir');
  assert.equal(config({ gestureMap: { 4: 'ESQUERDA' } }).api.get().gestureMap[4], 'ESQUERDA');
});

test('replay mantem rotulos originais e so corrige blocos explicitamente indicados', () => {
  const { replay } = require('../tools/replay_gesture_samples.cjs');
  const samples = [1000, 1075, 2000, 2075].map(frameTimeMs => ({
    frameTimeMs, expectedCount: 1, view: 'BACK', imageLandmarks: hand(6), worldLandmarks: hand(6),
    detector: { count: 2, confidence: 1 },
  }));
  const report = replay(samples, math(), { expectedByBlock: { 2: 2 } });
  assert.equal(report.blocks.length, 2);
  assert.equal(report.blocks[0].recorded.correct, 0);
  assert.equal(report.blocks[1].originalExpected, 1);
  assert.equal(report.blocks[1].recorded.correct, 2);
  assert.equal(report.blocks[1].current.correct, 2);
  assert.ok(samples.every(s => s.expectedCount === 1));
  assert.throws(() => replay(samples, math(), { expectedByBlock: { 3: 2 } }), /nao encontrado/);
  assert.throws(() => replay(samples, math(), { expectedByBlock: { 2: 8 } }), /invalido/);
});

// Opt-in: arquivo privado fornecido pelo operador, nunca incluido no repositorio.
// O replay avalia blocos de coleta; nao mede a latencia da camera nem dos motores.
if (process.env.QT_GESTURE_SAMPLES) test('amostras locais percorrem geometria, filtro e controlador real', () => {
  const { replay, loadSamples } = require('../tools/replay_gesture_samples.cjs');
  const batches = new Map();
  replay(loadSamples(process.env.QT_GESTURE_SAMPLES), math(), {
    expectedByBlock: JSON.parse(process.env.QT_GESTURE_EXPECTED_BY_BLOCK || '{}'),
    onResult({ sample, filtered, block }) {
      if (!batches.has(block.block)) batches.set(block.block, {
        h: controller(), start: sample.frameTimeMs, expected: block.expected,
      });
      batches.get(block.block).h.frame(filtered.count, sample.frameTimeMs, filtered.confidence);
    },
  });
  const mapping = { 1: 'FRENTE', 2: 'DIREITA', 3: 'ESQUERDA', 4: 'TRAS', 5: 'GIRAR' };
  const delays = [];
  for (const [number, { h, start, expected }] of batches) {
    const command = mapping[expected];
    const first = h.commands().find(c => c.command === command);
    assert.ok(first, `bloco ${number} nunca confirmou ${command}`);
    assert.ok(h.commands().every(c => c.command === command || c.command === 'PARAR'), `movimento incorreto no bloco ${number}`);
    delays.push(Math.round(first.emittedAt - start));
  }
  console.log('Replay local: blocos=' + batches.size + ', primeira confirmacao por bloco (ms)=' + delays.join(','));
});
