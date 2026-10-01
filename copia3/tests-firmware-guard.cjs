"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRobotControl() {
  const element = () => ({
    textContent: "", disabled: false, hidden: false, dataset: {},
    classList: { toggle() {} }, addEventListener() {}, setAttribute() {},
  });
  const elements = new Map();
  const context = {
    window: {
      QuantumControl: { state: { mode: { id: 1 } }, patch() {}, log() {} },
      __QUANTUM_ROBOT_TEST__: {},
      addEventListener() {}, setInterval() { return 1; },
    },
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      querySelectorAll() { return []; },
    },
    navigator: { serial: null }, performance: { now() { return 0; } }, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "web/robot-control.js"), "utf8"), context);
  return context.window.quantumRobot._test;
}

test("third-copy site accepts its official PWM and blocks temporary motor tests", () => {
  const robot = loadRobotControl();
  assert.equal(robot.matchesOfficialPwm("QT:PWM|L:200|R:200|DIRL:0|DIRR:0"), true);
  assert.equal(robot.matchesOfficialPwm("QT:PWM|L:170|R:200|DIRL:0|DIRR:0"), false);
  assert.equal(robot.matchesOfficialPwm("QT:PWM|L:255|R:200|DIRL:0|DIRR:0"), false);
  const error = { code: "FIRMWARE_POWER_MISMATCH", receivedLine: "QT:PWM|L:170|R:200" };
  const info = robot.describeConnectionError(error);
  assert.equal(info.status, "ERROR");
  assert.equal(info.firmwareRecovery, true);
  assert.match(info.hint, /ESTOP/);
});
