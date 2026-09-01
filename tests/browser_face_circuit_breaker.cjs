"use strict";

// Valida o circuit breaker do FaceID no site real, com câmera falsa.
const { chromium } = require("playwright");

const siteUrl = process.env.QT_SITE_URL || "http://127.0.0.1:8765/";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const context = await browser.newContext({ permissions: ["camera"] });
  // O painel fica atrás de uma tela de login simples (client-side); autentica
  // antes de navegar para o teste chegar até a câmera/FaceID de verdade.
  await context.addInitScript(() => {
    try { window.localStorage.setItem("quantumAuth:v1", "ok"); } catch { /* ignore */ }
  });
  const page = await context.newPage();
  const pageErrors = [];
  const unexpectedConsoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("FaceID suspenso após falhas consecutivas")) {
      unexpectedConsoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.QuantumControl && window.quantumCameraController && window.Human?.Human));
    await page.locator("#startCamera").click();
    await page.waitForFunction(() => window.QuantumControl.state.vision.status === "ONLINE", null, { timeout: 90000 });
    await page.evaluate(() => {
      const prototype = window.Human.Human.prototype;
      window.__qtOriginalHumanDetect = prototype.detect;
      window.__qtForcedFaceFailures = 0;
      prototype.detect = async function forcedFaceFailure() {
        window.__qtForcedFaceFailures += 1;
        throw new Error("falha sintética persistente");
      };
    });
    await page.waitForFunction(() => !document.getElementById("retryFaceDetection").hidden && window.__qtForcedFaceFailures === 3, null, { timeout: 10000 });
    const callsAtTrip = await page.evaluate(() => window.__qtForcedFaceFailures);
    await page.waitForTimeout(1200);
    const callsWhileSuspended = await page.evaluate(() => window.__qtForcedFaceFailures);
    await page.evaluate(() => {
      window.Human.Human.prototype.detect = window.__qtOriginalHumanDetect;
    });
    await page.locator("#retryFaceDetection").click();
    await page.waitForFunction(() => window.QuantumControl.state.vision.status === "ONLINE" && document.getElementById("retryFaceDetection").hidden, null, { timeout: 30000 });
    await page.locator("#stopCamera").click();
    const result = {
      callsAtTrip,
      callsWhileSuspended,
      recovered: await page.evaluate(() => window.QuantumControl.state.vision.status === "OFFLINE"),
      pageErrors,
      unexpectedConsoleErrors,
      failedRequests,
    };
    process.stdout.write(JSON.stringify(result));
    if (callsAtTrip !== 3 || callsWhileSuspended !== 3 || !result.recovered || pageErrors.length || unexpectedConsoleErrors.length || failedRequests.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
