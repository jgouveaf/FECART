"use strict";

// Smoke test completo do site real, sem câmera ou Arduino físicos.
// Execute com NODE_PATH apontando para uma instalação que contenha Playwright.
const { chromium } = require("playwright");

const siteUrl = process.env.QT_SITE_URL || "http://127.0.0.1:8765/";
const screenshotPath = process.env.QT_SCREENSHOT || "";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const context = await browser.newContext({ permissions: ["camera"] });
  // O painel fica atrás de uma tela de login simples (client-side); autentica
  // antes de navegar para o smoke test cobrir o painel real, não a tela de login.
  await context.addInitScript(() => {
    try { window.localStorage.setItem("quantumAuth:v1", "ok"); } catch { /* ignore */ }
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const externalRequests = [];
  const faceModelRequests = new Map();
  let humanRuntimeRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText || "falha"}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/web/vendor/human/models/")) {
      faceModelRequests.set(url.pathname, (faceModelRequests.get(url.pathname) || 0) + 1);
    }
    if (url.pathname.endsWith("/web/vendor/human/human.js")) humanRuntimeRequests += 1;
    if (url.origin !== new URL(siteUrl).origin && !["data:", "blob:"].includes(url.protocol)) externalRequests.push(request.url());
  });

  try {
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.QuantumControl && window.quantumCameraController && window.quantumGestureController && window.quantumRobot && window.QuantumSimulator));
    const humanRuntimeBeforeCamera = humanRuntimeRequests;
    await page.locator("#simulador").scrollIntoViewIfNeeded();
    await page.locator("#testTargetArduino").click();
    const arduinoTarget = await page.evaluate(() => ({
      target: window.QuantumSimulator.snapshot().target,
      status: document.getElementById("testTargetStatus").textContent,
      connectVisible: !document.getElementById("testConnectArduino").hidden,
    }));
    await page.locator("#testTargetSimulator").click();
    const simulatorTarget = await page.evaluate(() => ({
      target: window.QuantumSimulator.snapshot().target,
      status: document.getElementById("testTargetStatus").textContent,
      connectHidden: document.getElementById("testConnectArduino").hidden,
    }));
    await page.locator("#simGestureMode").click();
    const simulator = {};
    for (const command of ["FRENTE", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"]) {
      const before = await page.evaluate(() => window.QuantumSimulator.snapshot());
      await page.locator(`[data-simulator-command="${command}"]`).click();
      await page.waitForTimeout(40);
      const applied = await page.evaluate(() => window.QuantumSimulator.snapshot());
      await page.waitForTimeout(140);
      const after = await page.evaluate(() => window.QuantumSimulator.snapshot());
      simulator[command] = { before, applied, after };
    }
    await page.locator("#simulatorCommandPanel").focus();
    await page.keyboard.press("2");
    await page.waitForTimeout(50);
    simulator.keyboard = await page.evaluate(() => window.QuantumSimulator.snapshot());
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("quantum:gesture-command", {
      detail: { command: "FRENTE", stable: true, confidence: 0.95 },
    })));
    const gestureStart = await page.evaluate(() => window.QuantumSimulator.snapshot());
    await page.waitForTimeout(1050);
    const gestureTimeout = await page.evaluate(() => window.QuantumSimulator.snapshot());
    simulator.gesture = { start: gestureStart, timeout: gestureTimeout };
    await page.locator("#simAutonomousMode").click();
    await page.locator("#startCamera").click();
    await page.waitForFunction(() => window.quantumCameraController.active, null, { timeout: 15000 });
    await page.waitForFunction(() => ["ONLINE", "ERROR"].includes(window.QuantumControl.state.vision.status), null, { timeout: 90000 });
    const face = await page.evaluate(() => ({
      status: window.QuantumControl.state.vision.status,
      active: window.QuantumControl.state.vision.active,
      tracking: window.QuantumControl.state.vision.tracking,
      label: document.getElementById("faceStatus").textContent,
    }));
    await page.locator("#handCameraTab").click();
    await page.locator("#toggleGestures").click();
    await page.waitForFunction(() => window.quantumGestureController.active || window.quantumGestureController.modelState === "ERROR", null, { timeout: 90000 });

    const active = await page.evaluate(() => ({
      camera: window.quantumCameraController.phase,
      gestureEnabled: window.quantumGestureController.enabled,
      gestureActive: window.quantumGestureController.active,
      gestureModel: window.quantumGestureController.modelState,
      cameraStatus: document.getElementById("cameraStatus").textContent,
      gestureStatus: document.getElementById("gestureDetectorStatus").textContent,
      videoWidth: document.getElementById("cameraVideo").videoWidth,
      videoHeight: document.getElementById("cameraVideo").videoHeight,
      lastError: window.QuantumControl.state.diagnostics.lastError,
      recentLogs: window.QuantumControl.state.logs.slice(-12).map((entry) => `${entry.level}:${entry.source}:${entry.message}`),
    }));

    if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
    if (active.gestureEnabled) await page.locator("#toggleGestures").click();
    await page.locator("#stopCamera").click();
    await page.waitForFunction(() => window.quantumCameraController.phase === "OFF");
    const stopped = await page.evaluate(() => ({
      camera: window.quantumCameraController.phase,
      gestureEnabled: window.quantumGestureController.enabled,
      attachedStream: Boolean(document.getElementById("cameraVideo").srcObject),
    }));

    const responsive = [];
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      responsive.push(await page.evaluate((testedWidth) => {
        const stage = document.getElementById("cameraStage");
        const box = stage.getBoundingClientRect();
        return {
          width: testedWidth,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          cameraRatio: box.height ? box.width / box.height : 0,
        };
      }, width));
    }

    const repeatedFaceModels = [...faceModelRequests.entries()].filter(([, count]) => count > 1);
    const simulatorPassed =
      Math.hypot(simulator.FRENTE.after.robot.x - simulator.FRENTE.applied.robot.x, simulator.FRENTE.after.robot.y - simulator.FRENTE.applied.robot.y) > 2
      && simulator.DIREITA.after.robot.angle > simulator.DIREITA.applied.robot.angle
      && simulator.ESQUERDA.after.robot.angle < simulator.ESQUERDA.applied.robot.angle
      && Math.abs(simulator.PARAR.after.robot.angle - simulator.PARAR.applied.robot.angle) < 0.02
      && simulator.GIRAR.after.robot.angle > simulator.GIRAR.applied.robot.angle
      && simulator.keyboard.command === "DIREITA"
      && simulator.keyboard.source === "TECLADO"
      && simulator.gesture.start.source === "GESTO"
      && simulator.gesture.start.command === "FRENTE"
      && simulator.gesture.timeout.command === "PARAR";
    const lazyFaceRuntime = { beforeCamera: humanRuntimeBeforeCamera, afterCamera: humanRuntimeRequests };
    const testTargetsPassed =
      arduinoTarget.target === "arduino"
      && arduinoTarget.connectVisible
      && /desconectado/i.test(arduinoTarget.status)
      && simulatorTarget.target === "simulator"
      && simulatorTarget.connectHidden;
    const result = { face, active, stopped, testTargets: { arduinoTarget, simulatorTarget, passed: testTargetsPassed }, simulator: { ...simulator, passed: simulatorPassed }, lazyFaceRuntime, responsive, pageErrors, consoleErrors, failedRequests, externalRequests: [...new Set(externalRequests)], repeatedFaceModels };
    process.stdout.write(JSON.stringify(result));
    if (pageErrors.length || consoleErrors.length || failedRequests.length || externalRequests.length || face.status !== "ONLINE" || !face.active || humanRuntimeBeforeCamera !== 0 || humanRuntimeRequests !== 1 || repeatedFaceModels.length || active.camera !== "ACTIVE" || !active.gestureActive || stopped.camera !== "OFF" || stopped.attachedStream || !testTargetsPassed || !simulatorPassed || responsive.some((item) => item.horizontalOverflow || Math.abs(item.cameraRatio - 16 / 9) > 0.08)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
