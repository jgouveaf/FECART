"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("the public root opens copy 3 as the official version and preserves navigation", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source, "startup redirect script must exist");

  let redirectedTo = "";
  const window = {
    location: {
      protocol: "https:",
      hostname: "jgouveaf.github.io",
      pathname: "/FECART/",
      search: "?release=test",
      hash: "#voz",
      replace(url) { redirectedTo = url; },
    },
  };

  vm.runInNewContext(source, { window, URL });
  assert.equal(redirectedTo, "https://jgouveaf.github.io/FECART/copia3/?release=test#voz");
  assert.equal(window.QuantumRuntime.publicSiteUrl, "https://jgouveaf.github.io/FECART/copia3/");
});
