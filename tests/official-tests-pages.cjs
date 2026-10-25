"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("public JARVIS panel points to local integration without local API polling", () => {
  const elements = Object.fromEntries(["jarvisConnect", "jarvisFrame", "jarvisExternal", "jarvisHint", "jarvisStatus"]
    .map(id => [id, { hidden: false, textContent: "", href: "", src: "" }]));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "web/jarvis-panel.js"), "utf8"), {
    window: { location: { hostname: "jgouveaf.github.io" } },
    document: { getElementById: id => elements[id] },
    fetch() { throw new Error("Public pages must not request local APIs"); },
  });
  assert.equal(elements.jarvisFrame.hidden, true);
  assert.equal(elements.jarvisConnect.hidden, true);
  assert.equal(elements.jarvisExternal.href, "http://127.0.0.1:8766/#jarvis");
  assert.match(elements.jarvisStatus.textContent, /computador/);
});

test("public voice page leaves recognition to browser without polling Vosk", () => {
  const window = { location: { hostname: "jgouveaf.github.io" } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "web/voice-local.js"), "utf8"), {
    window,
    fetch() { throw new Error("Public pages must not request Vosk API"); },
  });
  assert.equal(window.QuantumLocalVoice, undefined);
});

test("the official root never redirects users to localhost or copy 3", () => {
  const publicUrl = "https://jgouveaf.github.io/FECART/";
  const files = [
    "index.html",
    "web/camera-controller.js",
    "web/face-identities.js",
    "web/robot-control.js",
  ].map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8"));

  for (const source of files) {
    assert.match(source, new RegExp(publicUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(source, /https:\/\/jgouveaf\.github\.io\/FECART\/copia3\//);
  }
  assert.doesNotMatch(files[0], /const publicSiteUrl = "http:\/\/127\.0\.0\.1/);
});
