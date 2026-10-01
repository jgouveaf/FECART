"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("five fingers stop even with an old saved GIRAR mapping", () => {
  const saved = JSON.stringify({ mappingVersion: 2, gestureMap: { 1: "FRENTE", 5: "GIRAR" } });
  const storage = new Map([["quantumUserConfig:v1", saved]]);
  const window = {
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    dispatchEvent() {},
  };
  const context = { window, CustomEvent: class {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "web/user-config.js"), "utf8"), context);
  const config = window.QuantumUserConfig;
  assert.equal(config.get().gestureMap[5], "PARAR");
  assert.equal(config.validCommands.includes("GIRAR"), false);
  assert.equal(config.save({ gestureMap: { 5: "FRENTE" } }).gestureMap[5], "PARAR");
  assert.equal(JSON.parse(storage.get("quantumUserConfig:v1")).gestureMap[5], "PARAR");
});
