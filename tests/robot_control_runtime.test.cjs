"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "web", "robot-control.js"), "utf8");

class TestCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

class TestPortEvent extends Event {
  constructor(type, port) {
    super(type);
    this.port = port;
  }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    if (force === undefined) force = !this.values.has(name);
    if (force) this.values.add(name); else this.values.delete(name);
    return force;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement extends EventTarget {
  constructor(id = "") {
    super();
    this.id = id;
    this.textContent = "";
    this.disabled = false;
    this.dataset = {};
    this.attributes = {};
    this.classList = new FakeClassList();
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  click() { this.dispatchEvent(new Event("click")); }
  focus() { this.focused = true; }
}

class FakeReader {
  constructor() {
    this.queue = [];
    this.pending = [];
    this.errors = [];
    this.closed = false;
  }
  read() {
    if (this.errors.length) return Promise.reject(this.errors.shift());
    if (this.queue.length) return Promise.resolve({ value: this.queue.shift(), done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
  }
  push(value) {
    if (this.closed) return;
    const waiter = this.pending.shift();
    if (waiter) waiter.resolve({ value, done: false }); else this.queue.push(value);
  }
  fail(error) {
    const waiter = this.pending.shift();
    if (waiter) waiter.reject(error); else this.errors.push(error);
  }
  cancel() {
    this.closed = true;
    for (const waiter of this.pending.splice(0)) waiter.resolve({ value: undefined, done: true });
    return Promise.resolve();
  }
  releaseLock() {}
}

class FakePort {
  constructor(options = {}) {
    this.options = options;
    this.reader = new FakeReader();
    this.writes = [];
    this.opened = false;
    this.closed = false;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this.readable = { getReader: () => this.reader };
    this.writer = {
      write: async (bytes) => {
        if (this.options.writeDelayMs) await wait(this.options.writeDelayMs);
        const line = this.decoder.decode(bytes).trim();
        this.writes.push(line);
        const ack = this.ackFor(line);
        if (ack) setTimeout(() => this.emit(ack), this.options.ackDelayMs || 0);
      },
      releaseLock() {},
    };
    this.writable = { getWriter: () => this.writer };
  }
  async open(configuration) {
    this.configuration = configuration;
    this.opened = true;
    if (this.options.ready !== false) {
      setTimeout(() => this.emit(this.options.readyLine || "QT:READY:V5"), this.options.readyDelayMs || 0);
    }
  }
  async close() {
    this.closed = true;
    await this.reader.cancel();
  }
  emit(line) { this.reader.push(this.encoder.encode(`${line}\n`)); }
  emitRaw(value) { this.reader.push(this.encoder.encode(value)); }
  ackFor(line) {
    if (this.options.acks === false) return null;
    if (this.options.noAckFor?.includes(line)) return null;
    if (line === "ESTOP") return "OK:ESTOP";
    if (line === "RESET_ESTOP") return "OK:RESET_ESTOP";
    if (line === "HELLO" && this.options.helloReady) return this.options.readyLine || "QT:READY:V5";
    if (line.startsWith("MODE:")) return `OK:${line}`;
    if (line.startsWith("CMD:")) return `OK:${line}`;
    if (line === "STATUS") return "QT|MODE:1|DIST:50.0|CMD:PARAR|STATE:AUTONOMO";
    return null;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs = 800) {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) throw new Error("Condição de teste não foi atingida.");
    await wait(2);
  }
}

function makeControl(windowObject) {
  const state = {
    mode: { id: 1, key: "AUTONOMOUS", label: "AUTÔNOMO", phase: "ACTIVE", requestedId: null },
    robot: { connected: false, status: "OFFLINE", statusLabel: "DESCONECTADO" },
    communication: { status: "OFFLINE" },
    safety: { emergency: false, status: "MONITORING" },
    diagnostics: { lastError: "Nenhum" },
  };
  const labels = { 1: ["AUTONOMOUS", "AUTÔNOMO"], 2: ["PERSON_FOLLOW", "SEGUIR PESSOA"], 3: ["GESTURE_CONTROL", "GESTOS"] };
  let pending = null;
  const logs = [];
  return {
    get state() { return structuredClone(state); },
    get pendingMode() { return pending ? structuredClone(pending) : null; },
    patch(section, values) { Object.assign(state[section], values); },
    log(level, source, message) { logs.push({ level, source, message }); },
    requestMode(id, source = "ui") {
      id = Number(id);
      if (state.mode.id === id && state.mode.phase === "ACTIVE") return null;
      const previous = { ...state.mode };
      const next = { id, key: labels[id][0], label: labels[id][1] };
      windowObject.dispatchEvent(new TestCustomEvent("quantum:mode-will-change", { detail: { previous, next, source } }));
      pending = { previous, next, source };
      state.mode = { ...previous, phase: "PREPARING", requestedId: id };
      return structuredClone(pending);
    },
    commitMode(id) {
      id = Number(id);
      const previous = pending?.previous || { ...state.mode };
      state.mode = { id, key: labels[id][0], label: labels[id][1], phase: "ACTIVE", requestedId: null };
      pending = null;
      windowObject.dispatchEvent(new TestCustomEvent("quantum:mode-changed", { detail: { previous, current: { ...state.mode } } }));
    },
    rejectMode() {
      if (pending) state.mode = { ...pending.previous, phase: "ACTIVE", requestedId: null };
      pending = null;
    },
    logs,
  };
}

function createEnvironment(portOptions = {}, testConfig = {}) {
  const windowObject = new EventTarget();
  Object.assign(windowObject, {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    isSecureContext: true,
    confirm: () => true,
    __QUANTUM_ROBOT_TEST__: {
      commandHeartbeatMs: 15,
      inputTimeoutMs: 40,
      readyTimeoutMs: 80,
      ackTimeoutMs: 60,
      maxEventAgeMs: 100,
      maxQueuedMotionAgeMs: 100,
      ...testConfig,
    },
  });

  const ids = [
    "camera-gestos", "connectRobot", "disconnectRobot", "emergencyStop", "robotConnectionDot",
    "robotConnectionStatus", "robotConnectionHint", "robotModeStatus", "robotCommandStatus",
    "robotDistanceStatus", "robotStateStatus", "gestureDeliveryStatus", "connectBeacon", "beaconStatus",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  const modeButtons = [1, 2, 3].map((id) => {
    const button = new FakeElement(`mode-${id}`);
    button.dataset.robotMode = String(id);
    return button;
  });
  const documentObject = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: (selector) => selector === ".robot-mode" ? modeButtons : [],
  };
  const port = new FakePort(portOptions);
  const serial = new EventTarget();
  serial.requestPort = async () => port;
  const navigatorObject = { serial };
  const control = makeControl(windowObject);
  windowObject.QuantumControl = control;
  windowObject.quantumCameraController = { active: true, start: async () => {}, stop: async () => {} };
  windowObject.quantumGestureController = {
    enabled: false,
    selectView: async () => {},
    enable: async () => { windowObject.quantumGestureController.enabled = true; },
    disable: () => { windowObject.quantumGestureController.enabled = false; },
  };

  const context = vm.createContext({
    window: windowObject,
    document: documentObject,
    navigator: navigatorObject,
    performance,
    TextEncoder,
    TextDecoder,
    Event,
    EventTarget,
    CustomEvent: TestCustomEvent,
    DOMException,
    Error,
    Promise,
    Set,
    Number,
    String,
    Object,
    Array,
    Boolean,
    Date,
    Math,
    console,
    queueMicrotask,
    structuredClone,
  });
  vm.runInContext(SOURCE, context, { filename: "robot-control.js" });
  return { window: windowObject, navigator: navigatorObject, control, port, elements, modeButtons, robot: windowObject.quantumRobot };
}

async function cleanup(environment) {
  if (environment.robot.connected) await environment.robot.disconnect();
  environment.window.dispatchEvent(new Event("pagehide"));
}

async function releaseSafety(environment) {
  assert.equal(environment.control.state.safety.emergency, true, "conexão deve iniciar bloqueada");
  await environment.robot.emergencyStop();
  assert.equal(environment.control.state.safety.emergency, false, "liberação explícita deve ser confirmada");
}

async function testHandshakeAndAcknowledgements() {
  const environment = createEnvironment({ ready: false, helloReady: true, ackDelayMs: 20 });
  assert.equal(environment.robot.send("FRENTE"), false, "comando não pode ser armazenado antes da conexão");
  assert.equal(environment.robot._test.lastFreshInputAt, 0);
  const connecting = environment.robot.connect();
  await wait(5);
  assert.equal(environment.robot.connected, false, "não pode ficar online antes de QT:READY");
  assert.equal(await connecting, true);
  assert.equal(environment.robot.connected, true);
  assert.equal(environment.robot.confirmedMode, 1);
  assert.equal(environment.port.configuration.baudRate, 9600);
  assert.deepEqual(environment.port.writes.slice(0, 4), ["HELLO", "ESTOP", "CMD:PARAR", "MODE:1"]);
  assert.equal(environment.control.state.safety.emergency, true, "motores devem permanecer em ESTOP após conectar");
  await releaseSafety(environment);
  assert.equal(environment.port.writes.at(-1), "RESET_ESTOP");
  assert.equal(environment.control.state.communication.status, "ONLINE");
  await cleanup(environment);
}

async function testRobotStatusKeepsTechnicalStateAndReadableLabel() {
  const environment = createEnvironment();
  assert.equal(environment.control.state.robot.status, "OFFLINE");
  assert.equal(environment.control.state.robot.statusLabel, "DESCONECTADO");

  await environment.robot.connect();
  assert.equal(environment.control.state.robot.status, "ONLINE");
  assert.equal(environment.control.state.robot.statusLabel, "CONECTADO · BLOQUEADO");
  await cleanup(environment);
}

async function testModeTransitionAndStaleInputWatchdog() {
  const environment = createEnvironment();
  assert.equal(await environment.robot.connect(), true);
  await releaseSafety(environment);
  environment.robot.requestMode(3, "test");
  await waitFor(() => environment.control.state.mode.id === 3 && environment.control.state.mode.phase === "ACTIVE");
  assert.equal(environment.robot.confirmedMode, 3);
  const modeWriteIndex = environment.port.writes.lastIndexOf("MODE:3");
  assert.deepEqual(environment.port.writes.slice(modeWriteIndex - 2, modeWriteIndex + 2), ["ESTOP", "CMD:PARAR", "MODE:3", "RESET_ESTOP"]);

  const beforeStale = environment.port.writes.length;
  environment.window.dispatchEvent(new TestCustomEvent("quantum:gesture-command", {
    detail: { command: "FRENTE", stable: true, confidence: 0.95, emittedAt: performance.now() - 500 },
  }));
  await wait(8);
  assert.equal(environment.port.writes.slice(beforeStale).includes("CMD:FRENTE"), false, "evento velho deve ser ignorado");

  environment.window.dispatchEvent(new TestCustomEvent("quantum:gesture-command", {
    detail: { command: "FRENTE", stable: true, confidence: 0.95 },
  }));
  await waitFor(() => environment.port.writes.includes("CMD:FRENTE"));
  const freshTimestamp = environment.robot._test.lastFreshInputAt;
  const afterFreshCommand = environment.port.writes.length;
  await wait(25);
  assert.equal(environment.robot._test.lastFreshInputAt, freshTimestamp, "heartbeat não pode renovar a entrada fresca");
  await waitFor(() => environment.port.writes.slice(afterFreshCommand).includes("CMD:PARAR"), 200);
  const firstStop = environment.port.writes.lastIndexOf("CMD:PARAR");
  await wait(35);
  assert.equal(environment.port.writes.slice(firstStop + 1).includes("CMD:FRENTE"), false, "comando antigo não pode voltar após timeout");
  await cleanup(environment);
}

async function testWrongModeAndSplitBrainFailClosed() {
  const environment = createEnvironment();
  await environment.robot.connect();
  await releaseSafety(environment);
  environment.robot.requestMode(2, "test");
  await waitFor(() => environment.robot.confirmedMode === 2);

  const beforeGesture = environment.port.writes.length;
  environment.window.dispatchEvent(new TestCustomEvent("quantum:gesture-command", {
    detail: { command: "FRENTE", stable: true, confidence: 0.99 },
  }));
  await wait(8);
  assert.equal(environment.port.writes.slice(beforeGesture).includes("CMD:FRENTE"), false, "gesto não pode vazar para modo seguir");

  environment.robot._test.parseTelemetry("QT|MODE:1|DIST:50.0|CMD:FRENTE|STATE:AUTONOMO");
  await waitFor(() => environment.port.writes.at(-1) === "ESTOP");
  assert.equal(environment.control.state.safety.emergency, true);
  assert.equal(environment.control.state.robot.status, "ERROR");
  await cleanup(environment);
}

async function testModeAckTimeoutRollsBackAndStaysStopped() {
  const environment = createEnvironment({ noAckFor: ["MODE:2"] }, { ackTimeoutMs: 25 });
  await environment.robot.connect();
  await releaseSafety(environment);
  environment.robot.requestMode(2, "test");
  await waitFor(() => environment.control.state.mode.phase === "ACTIVE" && environment.control.state.mode.id === 1);
  await waitFor(() => /MODE:2/.test(environment.control.state.diagnostics.lastError));
  assert.equal(environment.robot.confirmedMode, 1);
  assert.equal(environment.control.state.safety.emergency, true);
  assert.equal(environment.port.writes.at(-1), "ESTOP");
  await cleanup(environment);
}

async function testRepeatedMotionAckFailureTriggersEstop() {
  const environment = createEnvironment(
    { noAckFor: ["CMD:FRENTE"] },
    { ackTimeoutMs: 18, commandHeartbeatMs: 8, inputTimeoutMs: 500 },
  );
  await environment.robot.connect();
  await releaseSafety(environment);
  environment.robot.requestMode(3, "test");
  await waitFor(() => environment.robot.confirmedMode === 3 && environment.control.state.safety.emergency === false);
  environment.window.dispatchEvent(new TestCustomEvent("quantum:gesture-command", {
    detail: { command: "FRENTE", stable: true, confidence: 0.99 },
  }));
  await waitFor(() => environment.control.state.robot.status === "ERROR", 300);
  assert.equal(environment.control.state.safety.emergency, true);
  assert.equal(environment.control.state.robot.status, "ERROR");
  assert.equal(environment.port.writes.at(-1), "ESTOP");
  await cleanup(environment);
}

async function testOldTelemetryCannotConfirmANewMotionCommand() {
  const environment = createEnvironment(
    { noAckFor: ["CMD:FRENTE"] },
    { ackTimeoutMs: 18, commandHeartbeatMs: 8, inputTimeoutMs: 500 },
  );
  await environment.robot.connect();
  await releaseSafety(environment);
  environment.robot.requestMode(3, "test");
  await waitFor(() => environment.robot.confirmedMode === 3 && !environment.control.state.safety.emergency);
  environment.window.dispatchEvent(new TestCustomEvent("quantum:gesture-command", {
    detail: { command: "FRENTE", stable: true, confidence: 0.99 },
  }));
  await waitFor(() => environment.port.writes.includes("CMD:FRENTE"));
  environment.port.emit("QT|MODE:3|DIST:50.0|CMD:FRENTE|STATE:GESTOS");

  await waitFor(() => environment.control.state.robot.status === "ERROR", 300);
  assert.equal(environment.control.state.safety.emergency, true);
  assert.equal(environment.port.writes.at(-1), "ESTOP");
  await cleanup(environment);
}

async function testSilentUsbConnectionTriggersEmergencyStop() {
  const environment = createEnvironment(
    { noAckFor: ["CMD:FRENTE"] },
    { serialSilenceTimeoutMs: 35, commandHeartbeatMs: 8, ackTimeoutMs: 120 },
  );
  await environment.robot.connect();
  await releaseSafety(environment);

  await waitFor(() => environment.control.state.robot.status === "ERROR", 250);
  assert.equal(environment.control.state.safety.emergency, true);
  assert.match(environment.control.state.diagnostics.lastError, /deixou de responder/);
  assert.equal(environment.port.writes.at(-1), "ESTOP");
  await cleanup(environment);
}

async function testRecoverableReadErrorDoesNotDisconnectArduino() {
  const environment = createEnvironment();
  await environment.robot.connect();
  await releaseSafety(environment);
  environment.port.reader.fail(new Error("erro de enquadramento transitório"));
  await waitFor(() => environment.control.logs.some((entry) => /Falha transitória/.test(entry.message)));
  environment.port.emit("QT|MODE:1|DIST:75.0|CMD:FRENTE|STATE:AUTONOMO");

  await waitFor(() => environment.control.state.robot.distance === 75);
  assert.equal(environment.robot.connected, true);
  assert.equal(environment.control.state.safety.emergency, false);
  await cleanup(environment);
}

async function testOversizedSerialLineIsDiscardedUntilNewline() {
  const environment = createEnvironment();
  await environment.robot.connect();
  await releaseSafety(environment);
  environment.port.emitRaw("X".repeat(513));
  await waitFor(() => /descartada/.test(environment.control.state.diagnostics.lastError));
  environment.port.emitRaw("OK:CMD:FRENTE\nQT|MODE:1|DIST:82.0|CMD:FRENTE|STATE:AUTONOMO\n");

  await waitFor(() => environment.control.state.robot.distance === 82);
  // O heartbeat autônomo pode receber um ACK logo após a telemetria; o que
  // importa é a linha seguinte ter sido processada sem aceitar o sufixo lixo.
  assert.equal(environment.control.state.robot.distance, 82);
  assert.equal(environment.robot.connected, true);
  await cleanup(environment);
}

async function testSensorFailureRemainsBlockedUntilRecovery() {
  const environment = createEnvironment();
  await environment.robot.connect();
  await releaseSafety(environment);
  environment.robot._test.parseTelemetry("QT|MODE:1|DIST:ERR|CMD:PARAR|STATE:SENSOR_FAIL");
  assert.equal(environment.control.state.robot.status, "ERROR");
  assert.equal(environment.control.state.safety.emergency, true);
  environment.robot._test.parseTelemetry("EVENTO:SENSOR_RECUPERADO");
  assert.equal(environment.control.state.safety.emergency, false);
  await cleanup(environment);
}

async function testDisconnectAndPageHideEndWithEstop() {
  const environment = createEnvironment({ writeDelayMs: 2 });
  await environment.robot.connect();
  await releaseSafety(environment);
  environment.robot.requestMode(3, "test");
  await waitFor(() => environment.robot.confirmedMode === 3);
  environment.window.dispatchEvent(new TestCustomEvent("quantum:gesture-command", {
    detail: { command: "GIRAR", stable: true, confidence: 0.9 },
  }));
  await environment.robot.disconnect();
  assert.equal(environment.port.writes.at(-1), "ESTOP", "desconexão deve terminar com ESTOP");
  assert.equal(environment.robot.connected, false);
  environment.window.dispatchEvent(new Event("pagehide"));

  const pageEnvironment = createEnvironment();
  await pageEnvironment.robot.connect();
  await releaseSafety(pageEnvironment);
  pageEnvironment.window.dispatchEvent(new Event("pagehide"));
  await waitFor(() => pageEnvironment.port.writes.at(-1) === "ESTOP");
  await cleanup(pageEnvironment);
}

async function testKeyboardTransitionAndScopedSerialDisconnect() {
  const environment = createEnvironment();
  await environment.robot.connect();
  await releaseSafety(environment);
  const keyboardEvent = new Event("keydown", { cancelable: true });
  Object.defineProperty(keyboardEvent, "key", { value: "ArrowRight" });
  environment.modeButtons[0].dispatchEvent(keyboardEvent);
  await waitFor(() => environment.control.state.mode.id === 2 && environment.control.state.mode.phase === "ACTIVE");
  assert.equal(environment.robot.confirmedMode, 2);

  environment.navigator.serial.dispatchEvent(new TestPortEvent("disconnect", {}));
  await wait(8);
  assert.equal(environment.robot.connected, true, "desconexão de outra porta não pode encerrar o Arduino ativo");

  environment.navigator.serial.dispatchEvent(new TestPortEvent("disconnect", environment.port));
  await waitFor(() => environment.robot.connected === false);
  assert.equal(environment.control.state.robot.status, "ERROR");
  environment.window.dispatchEvent(new Event("pagehide"));
}

async function testHandshakeTimeoutAndVersionMismatch() {
  const timeoutEnvironment = createEnvironment({ ready: false }, { readyTimeoutMs: 20 });
  assert.equal(await timeoutEnvironment.robot.connect(), false);
  assert.equal(timeoutEnvironment.robot.connected, false);
  assert.equal(timeoutEnvironment.control.state.robot.status, "ERROR");
  assert.match(timeoutEnvironment.control.state.diagnostics.lastError, /QT:READY/);
  await cleanup(timeoutEnvironment);

  const versionEnvironment = createEnvironment({ readyLine: "QT:READY:V2" });
  assert.equal(await versionEnvironment.robot.connect(), false);
  assert.equal(versionEnvironment.control.state.robot.status, "ERROR");
  assert.match(versionEnvironment.control.state.diagnostics.lastError, /Firmware incompatível/);
  await cleanup(versionEnvironment);
}

async function main() {
  const tests = [
    testRobotStatusKeepsTechnicalStateAndReadableLabel,
    testHandshakeAndAcknowledgements,
    testModeTransitionAndStaleInputWatchdog,
    testWrongModeAndSplitBrainFailClosed,
    testModeAckTimeoutRollsBackAndStaysStopped,
    testRepeatedMotionAckFailureTriggersEstop,
    testOldTelemetryCannotConfirmANewMotionCommand,
    testSilentUsbConnectionTriggersEmergencyStop,
    testRecoverableReadErrorDoesNotDisconnectArduino,
    testOversizedSerialLineIsDiscardedUntilNewline,
    testSensorFailureRemainsBlockedUntilRecovery,
    testDisconnectAndPageHideEndWithEstop,
    testKeyboardTransitionAndScopedSerialDisconnect,
    testHandshakeTimeoutAndVersionMismatch,
  ];
  for (const test of tests) {
    await test();
    process.stdout.write(`ok - ${test.name}\n`);
  }
  process.stdout.write(`${tests.length} testes Web Serial executados com sucesso.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
