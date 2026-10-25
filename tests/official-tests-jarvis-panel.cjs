"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function panel(initialState) {
  let currentState = initialState;
  const elements = Object.fromEntries(["jarvisConnect", "jarvisFrame", "jarvisExternal", "jarvisHint", "jarvisStatus"]
    .map(id => [id, { hidden: false, disabled: false, textContent: "", src: "",
      addEventListener(type, callback) { this[type] = callback; } }]));
  const frameAssignments = [];
  let frameSrc = "";
  Object.defineProperty(elements.jarvisFrame, "src", {
    get() { return frameSrc; },
    set(value) { frameSrc = value; frameAssignments.push(value); },
  });
  const calls = [];
  let interval;
  const context = {
    document: { getElementById: id => elements[id] },
    window: { setTimeout() { return 1; }, clearTimeout() {},
      setInterval(callback) { interval = callback; return 2; }, clearInterval() {} },
    AbortController,
    fetch: async (url, options) => {
      calls.push({ url, method: options.method || "GET" });
      const state = url.endsWith("/start") ? { state: "starting" } : { state: currentState };
      return { ok: true, json: async () => state };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "web/jarvis-panel.js"), "utf8"), context);
  return { elements, calls, frameAssignments,
    setState(value) { currentState = value; }, tick: () => interval && interval() };
}

test("offline JARVIS is not shown as a broken iframe and starts via local endpoint", async () => {
  const { elements, calls } = panel("offline");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.jarvisFrame.hidden, true);
  assert.equal(elements.jarvisExternal.hidden, true);
  assert.match(elements.jarvisConnect.textContent, /Iniciar JARVIS/);
  await elements.jarvisConnect.click();
  assert.deepEqual(calls.map(call => call.url), ["/api/jarvis/status", "/api/jarvis/start"]);
  assert.match(elements.jarvisStatus.textContent, /aguardando/);
});

test("available JARVIS opens the embedded login and does not start another process", async () => {
  const { elements, calls } = panel("ready");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.jarvisFrame.hidden, false);
  assert.equal(elements.jarvisExternal.hidden, false);
  assert.equal(elements.jarvisFrame.src, "http://127.0.0.1:8002/login");
  await elements.jarvisConnect.click();
  assert.equal(calls.length, 1);
  assert.equal(elements.jarvisFrame.src, "http://127.0.0.1:8002/login");
});

test("panel reloads the iframe when JARVIS returns after connection refusal", async () => {
  const { elements, frameAssignments, setState, tick } = panel("ready");
  await new Promise(resolve => setImmediate(resolve));
  setState("offline");
  await tick();
  assert.equal(elements.jarvisFrame.hidden, true);
  setState("ready");
  await tick();
  assert.equal(elements.jarvisFrame.hidden, false);
  assert.deepEqual(frameAssignments.slice(-3), [
    "about:blank", "about:blank", "http://127.0.0.1:8002/login",
  ]);
});
