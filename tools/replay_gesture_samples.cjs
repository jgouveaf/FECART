// Replay local, sem camera/USB/rede. Nao copia landmarks nem nomes de dispositivos.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSamples(filename) {
  const input = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (input.schema !== 'quantum-tracker/gesture-calibration-v1' || !Array.isArray(input.samples)) {
    throw new Error('Formato de calibracao nao reconhecido.');
  }
  if (!input.samples.length || input.samples.some(s => !Number.isInteger(s.expectedCount)
    || s.expectedCount < 0 || s.expectedCount > 5 || !Number.isFinite(s.frameTimeMs))) {
    throw new Error('Amostras vazias ou rotulos/tempos invalidos.');
  }
  return input.samples;
}

function loadMath(filename = path.resolve(__dirname, '../web/gesture-math.js')) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { timeout: 1000 });
  return context.window.QuantumGestureMath;
}

function replay(samples, api, { minConfidence = .65, expectedByBlock = {}, onResult } = {}) {
  const blocks = [];
  let previous, filter, block;
  function stats() { return { correct: 0, accepted: 0, acceptedWrong: 0 }; }
  function record(stats, result, expected) {
    stats.correct += Number(result?.count === expected);
    const accepted = result?.confidence >= minConfidence;
    stats.accepted += Number(accepted);
    stats.acceptedWrong += Number(accepted && result.count !== expected);
  }
  for (const sample of samples) {
    if (!previous || sample.expectedCount !== previous.expectedCount || sample.view !== previous.view
      || sample.frameTimeMs <= previous.frameTimeMs || sample.frameTimeMs - previous.frameTimeMs > 500) {
      const number = blocks.length + 1;
      const expected = expectedByBlock[number] ?? sample.expectedCount;
      if (!Number.isInteger(expected) || expected < 0 || expected > 5) throw new Error('Rotulo corrigido invalido.');
      block = { block: number, originalExpected: sample.expectedCount, expected, view: sample.view,
        samples: 0, recorded: stats(), current: stats(), filtered: stats(), predictedCounts: {} };
      blocks.push(block);
      filter = new api.FingerStateStabilizer();
    }
    const result = api.classifyFingerCountDetails(sample.imageLandmarks, sample.worldLandmarks, sample.camera);
    record(block.recorded, sample.detector, block.expected);
    record(block.current, result, block.expected);
    const filtered = filter.update(result);
    record(block.filtered, filtered, block.expected);
    block.predictedCounts[result.count] = (block.predictedCounts[result.count] || 0) + 1;
    block.samples++;
    onResult?.({ sample, result, filtered, block });
    previous = sample;
  }
  if (Object.keys(expectedByBlock).some(key => !blocks.some(b => String(b.block) === key))) {
    throw new Error('Bloco de correcao nao encontrado.');
  }
  return { samples: samples.length, minConfidence, blocks };
}

if (require.main === module) {
  if (!process.argv[2]) {
    console.error('Uso: node tools/replay_gesture_samples.cjs caminho/do/arquivo.json [--expect=bloco:quantidade]');
    process.exitCode = 1;
  } else {
    try {
      const expectedByBlock = {};
      for (const arg of process.argv.slice(3)) {
        const match = /^--expect=([1-9][0-9]*):([0-5])$/.exec(arg);
        if (!match) throw new Error('Opcao invalida: ' + arg);
        expectedByBlock[match[1]] = Number(match[2]);
      }
      console.log(JSON.stringify(replay(loadSamples(process.argv[2]), loadMath(), { expectedByBlock }), null, 2));
    }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
module.exports = { loadSamples, loadMath, replay };
