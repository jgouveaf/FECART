// Executes selected REAL sketch function bodies with deterministic IO/time.
// This is a logic harness, not an AVR, electrical or physics simulator.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,
  '../firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino'), 'utf8');

function body(name) {
  const signature = source.indexOf(` ${name}(`);
  const start = source.indexOf('{', signature);
  assert.ok(signature >= 0 && start >= 0, `function ${name} exists`);
  let depth = 1;
  let end = start + 1;
  for (; depth; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  return source.slice(start + 1, end - 1)
    .replace(/\bconst (unsigned long|bool|ComandoMovimento) /g, 'const ')
    .replace(/\((?:ModoRobo|byte)\)/g, '')
    .replace(/\b(\d+)UL\b/g, '$1');
}

function environment() {
  const env = {
    now: 0, reading: 100, distanciaAtualCm: -1, modo: 1,
    estadoDesvio: 0, estadoDesvioDesde: 0, ultimoSensorEm: 0,
    ultimoComandoEm: 0, falhasConsecutivasSensor: 0,
    leiturasValidasSensor: 0, leiturasLivresConsecutivas: 0,
    obstaculosConsecutivos: 0,
    paradaEmergencia: /bool paradaEmergencia = true;/.test(source),
    permitirRe: true,
    controleUsbAtivo: false, sensorInicializado: false,
    confirmandoObstaculo: false, proximaCurvaDireita: true,
    curvaAtualDireita: true, comandoRecebido: 0, comandoAplicado: 0,
    events: [], motions: [], F: value => value,
  };

  for (const match of source.matchAll(
    /const (?:float|byte|unsigned long|unsigned int) (\w+) = ([\d.]+)(?:UL)?;/g)) {
    env[match[1]] = Number(match[2]);
  }
  for (const match of source.matchAll(/enum \w+ \{([^}]+)\}/g)) {
    let value = 0;
    for (const entry of match[1].split(',')) {
      const [name, explicit] = entry.trim().split(/\s*=\s*/);
      if (explicit) value = Number(explicit);
      env[name] = value++;
    }
  }

  env.Serial = { print: () => {}, println: value => env.events.push(value) };
  env.strcmp = (left, right) => left === right ? 0 : 1;
  env.nomeComando = command => command;
  env.millis = () => env.now;
  env.lerSerial = () => {};
  env.enviarStatus = () => {};
  env.medirDistanciaCm = () => env.reading;
  for (const [name, command] of Object.entries({
    pararMotores: 'CMD_PARAR', andarParaFrente: 'CMD_FRENTE',
    andarParaTras: 'CMD_TRAS', girarDireita: 'CMD_DIREITA',
    girarEsquerda: 'CMD_ESQUERDA',
  })) {
    env[name] = () => {
      env.comandoAplicado = env[command];
      env.motions.push(env[command]);
    };
  }
  env.aplicarComando = command => {
    env.comandoAplicado = command;
    env.motions.push(command);
  };

  vm.createContext(env);
  const oneArgument = new Set(['atualizarSensor', 'iniciarDesvio',
    'atualizarDesvio', 'comandoExigeFrenteLivre']);
  for (const name of ['atualizarSensor', 'obstaculoConfirmado',
    'caminhoLivreConfirmado', 'sensorPronto', 'comandoExigeFrenteLivre',
    'cancelarDesvio', 'iniciarDesvio', 'atualizarDesvio',
    'comandoDesejadoPeloModo', 'selecionarModo', 'receberComando',
    'processarLinha', 'loop']) {
    const namedParams = {
      selecionarModo: 'numero, agora', receberComando: 'comando, agora',
      processarLinha: 'linha, agora',
    };
    const params = namedParams[name] || (oneArgument.has(name)
      ? (name === 'comandoExigeFrenteLivre' ? 'comando' : 'agora')
      : '');
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

function runningEnvironment() {
  const env = environment();
  env.processarLinha('RESET_ESTOP', env.now);
  return env;
}

function testContinuousAutonomousHasNoMissionTimeout() {
  const env = runningEnvironment();
  env.tick(100, 600000);
  assert.equal(env.comandoAplicado, env.CMD_FRENTE);
  assert.equal(env.estadoDesvio, env.DESVIO_INATIVO);
}

function testFirstNearReadingStopsBeforeConfirmation() {
  const env = runningEnvironment();
  env.tick(100, 160);
  assert.equal(env.comandoAplicado, env.CMD_FRENTE);
  env.tick(4, 80);
  assert.equal(env.comandoAplicado, env.CMD_PARAR);
  assert.equal(env.confirmandoObstaculo, true);
  assert.equal(env.estadoDesvio, env.DESVIO_INATIVO);
}

function testNoiseSpikeRecoversWithoutReverse() {
  const env = runningEnvironment();
  env.tick(100, 160);
  env.tick(4, 80);
  env.tick(100, 160);
  assert.equal(env.confirmandoObstaculo, false);
  assert.equal(env.estadoDesvio, env.DESVIO_INATIVO);
  assert.equal(env.comandoAplicado, env.CMD_FRENTE);
  assert.equal(env.motions.includes(env.CMD_TRAS), false);
}

function testRepeatedObstacleCyclesAlwaysResume() {
  const env = runningEnvironment();
  for (let cycle = 0; cycle < 100; cycle++) {
    env.tick(4, 320);
    assert.equal(env.estadoDesvio, env.DESVIO_PAUSA_INICIAL);
    env.tick(4, 1400);
    env.tick(100, 2200);
    assert.equal(env.estadoDesvio, env.DESVIO_INATIVO);
    assert.equal(env.comandoAplicado, env.CMD_FRENTE);
  }
}

function testMissingEchoStopsAndRequiresTwoValidReadings() {
  const env = runningEnvironment();
  env.tick(100, 160);
  assert.equal(env.comandoAplicado, env.CMD_FRENTE);
  env.tick(-1, 80);
  assert.equal(env.comandoAplicado, env.CMD_PARAR);
  assert.equal(env.sensorPronto(), false);
  env.tick(100, 80);
  assert.equal(env.comandoAplicado, env.CMD_PARAR);
  env.tick(100, 80);
  assert.equal(env.sensorPronto(), true);
  assert.equal(env.comandoAplicado, env.CMD_FRENTE);
}

function testSensorFailureInterruptsEveryManeuverPhase() {
  for (let phase = 1; phase <= 5; phase++) {
    const env = runningEnvironment();
    env.sensorInicializado = true;
    env.leiturasValidasSensor = 2;
    env.distanciaAtualCm = 4;
    env.estadoDesvio = phase;
    env.tick(-1, 80);
    assert.equal(env.comandoAplicado, env.CMD_PARAR, `phase ${phase}`);
    assert.equal(env.estadoDesvio, env.DESVIO_INATIVO, `phase ${phase}`);
  }
}

function testEstopDominatesEveryManeuverPhase() {
  for (let phase = 0; phase <= 5; phase++) {
    const env = runningEnvironment();
    env.estadoDesvio = phase;
    env.paradaEmergencia = true;
    env.tick(100, 2000);
    assert.equal(env.comandoAplicado, env.CMD_PARAR, `phase ${phase}`);
  }
}

function testRemoteTimeoutStopsModesTwoAndThree() {
  for (const mode of [2, 3]) {
    const env = runningEnvironment();
    env.modo = mode;
    env.controleUsbAtivo = true;
    env.comandoRecebido = env.CMD_FRENTE;
    env.tick(100, 2000);
    assert.equal(env.comandoAplicado, env.CMD_PARAR, `mode ${mode}`);
  }
}

function testPersistentObstacleCurvesWithoutSecondReverseOrBlindAdvance() {
  const env = runningEnvironment();
  env.tick(4, 320);
  env.tick(4, 8000);
  assert.notEqual(env.comandoAplicado, env.CMD_FRENTE);
  assert.ok(env.events.includes('EVENTO:CURVA_CONTINUA'));
  assert.equal(env.motions.filter(command => command === env.CMD_TRAS).length, 1);
  env.tick(100, 1800);
  assert.equal(env.comandoAplicado, env.CMD_FRENTE);
  assert.equal(env.estadoDesvio, env.DESVIO_INATIVO);
}

function testApprovedMotorPolarityAndSoftTurns() {
  assert.match(body('andarParaFrente'), /aplicarMotores\(LOW, HIGH, LOW, HIGH\)/);
  assert.match(body('andarParaTras'), /aplicarMotores\(HIGH, LOW, HIGH, LOW\)/);
  assert.match(body('girarDireita'), /aplicarMotores\(LOW, HIGH, LOW, LOW\)/);
  assert.match(body('girarEsquerda'), /aplicarMotores\(LOW, LOW, LOW, HIGH\)/);
}

function testBootAndResetRequireExplicitRelease() {
  // Each fresh environment represents RAM reinitialization at boot/reset.
  for (let boot = 0; boot < 3; boot++) {
    const env = environment();
    for (const line of ['HELLO', 'PING', 'STATUS', 'MODE:1', 'CMD:FRENTE']) {
      env.processarLinha(line, env.now);
      env.tick(100, 1000);
    }
    env.tick(100, 60000);
    assert.equal(env.paradaEmergencia, true);
    assert.equal(env.comandoAplicado, env.CMD_PARAR);
    assert.equal(env.motions.includes(env.CMD_FRENTE), false);
    env.processarLinha('RESET_ESTOP', env.now);
    env.tick(100, 80);
    assert.equal(env.comandoAplicado, env.CMD_PARAR);
    env.tick(100, 80);
    assert.equal(env.comandoAplicado, env.CMD_FRENTE);
  }
}

function testAutonomousStopCommandIsLatched() {
  const env = runningEnvironment();
  env.tick(100, 160);
  env.processarLinha('CMD:PARAR', env.now);
  env.processarLinha('CMD:FRENTE', env.now);
  env.processarLinha('MODE:1', env.now);
  env.tick(-1, 80);
  env.tick(100, 60000);
  assert.equal(env.paradaEmergencia, true);
  assert.equal(env.comandoAplicado, env.CMD_PARAR);
  env.processarLinha('RESET_ESTOP', env.now);
  env.tick(100, 160);
  assert.equal(env.comandoAplicado, env.CMD_FRENTE);
}

function testSensorRecoveryNeverRepeatsReverseForSameObstacle() {
  for (const phase of [2, 3, 4, 5]) {
    const env = runningEnvironment();
    env.tick(4, 320);
    while (env.estadoDesvio !== phase && env.now < 3000) env.tick(4, 10);
    assert.equal(env.estadoDesvio, phase);
    const direction = env.curvaAtualDireita;
    for (let interruption = 0; interruption < 3; interruption++) {
      env.tick(-1, 80);
      assert.equal(env.comandoAplicado, env.CMD_PARAR);
      env.tick(4, 600);
      assert.equal(env.estadoDesvio, env.DESVIO_CURVA);
      assert.equal(env.curvaAtualDireita, direction);
      assert.equal(env.motions.filter(command => command === env.CMD_TRAS).length, 1);
    }
    env.tick(100, 1800);
    assert.equal(env.comandoAplicado, env.CMD_FRENTE);
    env.tick(4, 600);
    assert.equal(env.motions.filter(command => command === env.CMD_TRAS).length, 2);
    assert.notEqual(env.curvaAtualDireita, direction);
  }
}

function testRemovedObstacleCancelsPendingReverse() {
  const env = runningEnvironment();
  env.tick(4, 320);
  env.tick(100, 500);
  assert.equal(env.comandoAplicado, env.CMD_FRENTE);
  assert.equal(env.estadoDesvio, env.DESVIO_INATIVO);
  assert.equal(env.motions.includes(env.CMD_TRAS), false);
}

const tests = [testContinuousAutonomousHasNoMissionTimeout,
  testFirstNearReadingStopsBeforeConfirmation, testNoiseSpikeRecoversWithoutReverse,
  testRepeatedObstacleCyclesAlwaysResume,
  testMissingEchoStopsAndRequiresTwoValidReadings,
  testSensorFailureInterruptsEveryManeuverPhase,
  testEstopDominatesEveryManeuverPhase, testRemoteTimeoutStopsModesTwoAndThree,
  testPersistentObstacleCurvesWithoutSecondReverseOrBlindAdvance,
  testApprovedMotorPolarityAndSoftTurns, testBootAndResetRequireExplicitRelease,
  testAutonomousStopCommandIsLatched,
  testSensorRecoveryNeverRepeatsReverseForSameObstacle,
  testRemovedObstacleCancelsPendingReverse];

for (const test of tests) {
  test();
  console.log(`ok - ${test.name}`);
}
console.log(`${tests.length} firmware logic scenarios passed (mock IO/time).`);
