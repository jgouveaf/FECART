"use strict";

const { chromium } = require("playwright");

const siteUrl = process.env.QT_SITE_URL || "http://127.0.0.1:8765/";
const throttled = process.env.QT_THROTTLE === "1";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  // O painel fica atrás de uma tela de login simples (client-side); autentica
  // antes de navegar para medir o carregamento do painel real, não do login.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("quantumAuth:v1", "ok"); } catch { /* ignore */ }
  });
  if (throttled) {
    const session = await page.context().newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200_000,
      uploadThroughput: 90_000,
      connectionType: "cellular3g",
    });
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const failedRequests = [];
  const consoleErrors = [];
  const externalRequests = [];
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(siteUrl).origin && !["data:", "blob:"].includes(url.protocol)) externalRequests.push(url.href);
  });

  try {
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);
    const quality = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
      return {
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        firstContentfulPaintMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime || 0,
        transferredBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
        humanRuntimeLoaded: resources.some((entry) => entry.name.includes("/web/vendor/human/human.js")),
        handModelLoaded: resources.some((entry) => entry.name.includes("hand_landmarker.task")),
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        h1Count: document.querySelectorAll("h1").length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        activeElement: document.activeElement?.tagName || "",
      };
    });
    const result = { profile: throttled ? "3G + CPU 4x" : "desktop", quality, failedRequests, consoleErrors, externalRequests: [...new Set(externalRequests)] };
    process.stdout.write(JSON.stringify(result));
    if (
      failedRequests.length || consoleErrors.length || externalRequests.length
      || quality.humanRuntimeLoaded || quality.handModelLoaded
      || quality.duplicateIds.length || quality.h1Count !== 1 || quality.horizontalOverflow
      || quality.domContentLoadedMs > (throttled ? 5000 : 2500)
      || quality.firstContentfulPaintMs > (throttled ? 3500 : 2500)
    ) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
