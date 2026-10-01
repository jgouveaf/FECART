"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { commandFromSpeech } = require("./web/voice-command-math.js");

test("accepts the six spoken movement commands in Portuguese", () => {
  for (const [spoken, command] of [
    ["robô, andar para frente", "FRENTE"], ["ré", "TRAS"],
    ["vire à direita", "DIREITA"], ["vira à esquerda", "ESQUERDA"],
    ["gire no lugar", "GIRAR"], ["pare", "PARAR"],
  ]) assert.equal(commandFromSpeech(spoken), command, spoken);
});

test("rejects ambiguous or unrelated speech instead of moving", () => {
  for (const spoken of ["a pessoa está à direita", "não pare", "frente e direita", "parar depois", "jarvis abra o navegador"])
    assert.equal(commandFromSpeech(spoken), null, spoken);
});

test("one recognized movement expires in PARAR after 800 ms", () => {
  const events = [], timers = new Map(), elements = {};
  let nextTimer = 0, recognizer;
  for (const id of ["voiceStart", "voiceStop", "voiceStatus", "voiceAudio", "voiceInterim", "voiceTranscript",
    "voiceCommand", "voiceTarget", "voiceDelivery"])
    elements[id] = { textContent: "—", disabled: false, addEventListener(type, handler) { this[type] = handler; } };
  class Recognition {
    constructor() { recognizer = this; }
    start() {}
    abort() {}
  }
  const fakeWindow = {
    SpeechRecognition: Recognition,
    QuantumVoiceCommands: { commandFromSpeech },
    QuantumControl: { state: { mode: { id: 4, phase: "ACTIVE" } } },
    quantumRobot: { modeGeneration: 7 },
    addEventListener() {},
    dispatchEvent(event) { events.push(event.detail); },
    setTimeout(handler, delay) { const id = ++nextTimer; timers.set(id, { handler, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const context = {
    window: fakeWindow,
    document: { hidden: false, getElementById: id => elements[id], addEventListener() {} },
    performance: { now: () => 1000 },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "web/voice-control.js"), "utf8"), context);
  elements.voiceStart.click();
  recognizer.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "fre" }], { isFinal: false })] });
  assert.equal(elements.voiceInterim.textContent, "fre");
  assert.equal(events.length, 0, "fala parcial não deve mover o robô");
  recognizer.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "frente" }], { isFinal: true })] });
  assert.equal(elements.voiceTranscript.textContent, "frente");
  assert.match(elements.voiceDelivery.textContent, /aguardando envio/);
  assert.deepEqual(events.map(event => event.command), ["FRENTE"]);
  const pulse = [...timers.values()].find(timer => timer.delay === 800);
  assert.ok(pulse, "o comando precisa ter temporizador de parada");
  pulse.handler();
  assert.deepEqual(events.map(event => event.command), ["FRENTE", "PARAR"]);
  elements.voiceStop.click();
  recognizer.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "frente" }], { isFinal: true })] });
  assert.deepEqual(events.map(event => event.command), ["FRENTE", "PARAR"], "resultado atrasado após desligar não move");
});

test("microphone can show a transcript outside Mode 4 without sending motion", () => {
  const events = [], elements = {};
  let recognizer;
  for (const id of ["voiceStart", "voiceStop", "voiceStatus", "voiceAudio", "voiceInterim",
    "voiceTranscript", "voiceCommand", "voiceTarget", "voiceDelivery"])
    elements[id] = { textContent: "—", disabled: false, addEventListener(type, handler) { this[type] = handler; } };
  class Recognition { constructor() { recognizer = this; } start() {} abort() {} }
  const context = {
    window: {
      SpeechRecognition: Recognition, QuantumVoiceCommands: { commandFromSpeech },
      QuantumControl: { state: { mode: { id: 1, phase: "ACTIVE" } } },
      addEventListener() {}, dispatchEvent(event) { events.push(event.detail); },
      setTimeout() { return 1; }, clearTimeout() {},
    },
    document: { hidden: false, getElementById: id => elements[id], addEventListener() {} },
    performance: { now: () => 1000 },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "web/voice-control.js"), "utf8"), context);
  assert.equal(elements.voiceStart.disabled, false);
  elements.voiceStart.click();
  recognizer.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "frente" }], { isFinal: true })] });
  assert.equal(elements.voiceTranscript.textContent, "frente");
  assert.match(elements.voiceDelivery.textContent, /Nenhum comando enviado/);
  assert.equal(events.length, 0);
});

test("selected microphone reaches local recognizer without enabling robot movement", async () => {
  const events = [], elements = {};
  let chosenDevice, handlers;
  for (const id of ["voiceStart", "voiceStop", "voiceStatus", "voiceAudio", "voiceInterim",
    "voiceTranscript", "voiceCommand", "voiceTarget", "voiceDelivery", "voiceMicSelect"])
    elements[id] = { textContent: "—", value: id === "voiceMicSelect" ? "realtek-device" : "",
      disabled: false, addEventListener(type, handler) { this[type] = handler; } };
  const context = {
    window: {
      QuantumLocalVoice: { start(callbacks, deviceId) { handlers = callbacks; chosenDevice = deviceId; return Promise.resolve(); }, stop() {} },
      QuantumVoiceCommands: { commandFromSpeech },
      QuantumControl: { state: { mode: { id: 1, phase: "ACTIVE" } } },
      addEventListener() {}, dispatchEvent(event) { events.push(event.detail); },
      setTimeout() { return 1; }, clearTimeout() {},
    },
    document: { hidden: false, getElementById: id => elements[id], addEventListener() {} },
    performance: { now: () => 1000 },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "web/voice-control.js"), "utf8"), context);
  elements.voiceStart.click();
  await Promise.resolve();
  assert.equal(chosenDevice, "realtek-device");
  handlers.onFinal("frente");
  assert.equal(elements.voiceTranscript.textContent, "frente");
  assert.equal(events.length, 0);
});

test("simulator accepts voice only in its VOZ mode", () => {
  const context = { window: {}, performance: { now: () => 1000 } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "web/simulator-controller.js"), "utf8"), context);
  const simulator = new context.window.QuantumSimulatorController.SimulatorCommandController();
  assert.equal(simulator.setCommand("FRENTE", "VOZ", 1000), false);
  simulator.setMode("VOZ", 1000);
  assert.equal(simulator.setCommand("FRENTE", "VOZ", 1000), true);
  assert.equal(simulator.current(1500), "FRENTE");
  assert.equal(simulator.current(1901), "PARAR");
});
