"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("the public root contains copy 3 as the official version without redirecting", () => {
  const root = path.join(__dirname, "..");
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(index, /const publicSiteUrl = "https:\/\/jgouveaf\.github\.io\/FECART\/"/);
  assert.doesNotMatch(index, /runningOnFormerPublicRoot|location\.replace\([^)]*copia3/);
  assert.match(index, /Modo 4 · comando por fala/);
  assert.match(index, /web\/voice-control\.js/);
  assert.match(index, /web\/jarvis-panel\.js/);
  assert.ok(fs.existsSync(path.join(root, "web", "voice-control.js")));
  assert.ok(fs.existsSync(path.join(root, "web", "jarvis-panel.js")));
  assert.ok(fs.existsSync(path.join(root, "apresentacao.html")));
});
