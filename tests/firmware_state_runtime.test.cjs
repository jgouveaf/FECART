// Executes selected REAL sketch function bodies with deterministic IO/time.
// This is a logic harness, not an AVR, electrical or physics simulator.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(process.argv.includes('--stdin') ? 0 : path.join(__dirname,
  '../firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino'), 'utf8');

function body(name) {
  const start = source.indexOf('{', source.indexOf(` ${name}(`));
  assert.ok(start >= 0, name);
  let depth = 1, end = start + 1;
  for (; depth; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  return source.slice(start + 1, end - 1)
    .replace(/\bconst (unsigned long|bool|ComandoMovimento) /g, 'const ')
    .replace(/\b(\d+)UL\b/g, '$1');
}
function environment() {
  const env = { now: 0, reading: 100, distanciaAtualCm: -1, modo: 1,
    estadoDesvio: 0, estadoDesvioDesde: 0, ultimoSensorEm: 0,
    ultimaLeituraLivreEm: 0, ultimoComandoEm: 0, falhasConsecutivasSensor: 0,
    leiturasLivresAposCurva: 0, obstaculosConsecutivos: 0, buscasSemEco: 0,
    paradaEmergencia: false, controleUsbAtivo: false, sensorInicializado: false,
    proximaCurvaDireita: true, curvaAtualDireita: true, comandoRecebido: 0,
    comandoAplicado: 0, events: [], F: x => x };
  for (const match of source.matchAll(/const (?:float|byte|unsigned long|unsigned int) (\w+) = ([\d.]+)(?:UL)?;/g)) {
    env[match[1]] = Number(match[2]);
  }
  for (const match of source.matchAll(/enum \w+ \{([^}]+)\}/g)) {
    let n = 0;
    for (const entry of match[1].split(',')) {
      const [name, value] = entry.trim().split(/\s*=\s*/);
      if (value) n = Number(value);
      env[name] = n++;
    }
  }
  env.Serial = { println: x => env.events.push(x) };
  env.millis = () => env.now;
  env.lerSerial = () => {};
  env.enviarStatus = () => {};
  env.medirDistanciaCm = () => env.reading;
  for (const [name, command] of Object.entries({pararMotores:'CMD_PARAR',
    andarParaFrente:'CMD_FRENTE', andarParaTras:'CMD_TRAS',
    girarDireita:'CMD_DIREITA', girarEsquerda:'CMD_ESQUERDA'})) {
    env[name] = () => { env.comandoAplicado = env[command]; };
  }
  env.aplicarComando = command => { env.comandoAplicado = command; };
  vm.createContext(env);
  for (const name of ['atualizarSensor', 'obstaculoConfirmado',
    'comandoExigeFrenteLivre', 'cancelarDesvio', 'iniciarDesvio',
    'atualizarDesvio', 'comandoDesejadoPeloModo', 'loop']) {
    const params = name === 'comandoExigeFrenteLivre' ? 'comando' : name === 'loop' ? '' : 'agora';
    vm.runInContext(`function ${name}(${params}) {${body(name)}}`, env);
  }
  env.tick = (reading, duration = 80) => {
    env.reading = reading;
    for (let elapsed = 0; elapsed < duration; elapsed += 10) {
      env.now += 10;
      env.loop();
    }
  };
  return env;
}

function testContinuousAutonomous() {
  const e = environment();
  e.tick(100, 600000);
  assert.equal(e.comandoAplicado, e.CMD_FRENTE);
  assert.equal(e.estadoDesvio, e.DESVIO_INATIVO);
}
function testRepeatedObstacleCycles() {
  const e = environment();
  for (let cycle = 0; cycle < 100; cycle++) {
    e.tick(15, 160);
    assert.equal(e.estadoDesvio, e.DESVIO_PAUSA_INICIAL);
    e.tick(100, 3000);
    assert.equal(e.estadoDesvio, e.DESVIO_INATIVO);
    assert.equal(e.comandoAplicado, e.CMD_FRENTE);
  }
}
function testMissingEchoSearchAndRecovery() {
  const e = environment();
  e.tick(15, 160);
  e.tick(-1, 3200);
  assert.equal(e.estadoDesvio, e.DESVIO_CURVA, 'must search instead of remaining stuck in pause');
  assert.ok(e.events.includes('EVENTO:BUSCA_ECO'));
  assert.equal(e.buscasSemEco, 1);
  e.tick(100, 2500);
  assert.equal(e.comandoAplicado, e.CMD_FRENTE);
  assert.equal(e.estadoDesvio, e.DESVIO_INATIVO);
}
function testDisconnectedSensorCannotCauseInfiniteSpinOrBlindAdvance() {
  const e = environment();
  e.tick(15, 160);
  e.tick(-1, 30000);
  assert.equal(e.buscasSemEco, e.LIMITE_BUSCAS_ECO);
  assert.equal(e.comandoAplicado, e.CMD_PARAR);
  assert.equal(e.events.filter(x => x === 'EVENTO:BUSCA_ECO').length, 2);
  e.tick(100, 1500);
  assert.equal(e.comandoAplicado, e.CMD_FRENTE);
}
function testEstopDuringEveryManeuverPhase() {
  for (let phase = 0; phase <= 6; phase++) {
    const e = environment();
    e.estadoDesvio = phase;
    e.paradaEmergencia = true;
    e.tick(100, 4000);
    assert.equal(e.comandoAplicado, e.CMD_PARAR);
  }
}
function testRemoteTimeoutStillStops() {
  for (const mode of [2, 3]) {
    const e = environment();
    e.modo = mode;
    e.controleUsbAtivo = true;
    e.comandoRecebido = e.CMD_FRENTE;
    e.tick(100, 2000);
    assert.equal(e.comandoAplicado, e.CMD_PARAR);
  }
}
function testObstacleAfterTurnNeverAllowsForwardExit() {
  const e = environment();
  e.tick(15, 160);
  for (let elapsed = 0; elapsed < 15000; elapsed += 80) {
    e.tick(15);
    assert.notEqual(e.comandoAplicado, e.CMD_FRENTE);
  }
  assert.ok(e.events.includes('EVENTO:CURVA_EXTRA'));
  e.tick(100, 3000);
  assert.equal(e.comandoAplicado, e.CMD_FRENTE);
}
const tests = [testContinuousAutonomous, testRepeatedObstacleCycles,
  testMissingEchoSearchAndRecovery,
  testDisconnectedSensorCannotCauseInfiniteSpinOrBlindAdvance,
  testEstopDuringEveryManeuverPhase, testRemoteTimeoutStillStops,
  testObstacleAfterTurnNeverAllowsForwardExit];
for (const test of tests) { test(); console.log(`ok - ${test.name}`); }
console.log(`${tests.length} firmware logic scenarios passed (mock IO/time).`);
