"use strict";

// Valida detecção facial real do pipeline web usando uma imagem apenas como
// câmera simulada. Não cadastra nem envia a imagem para fora do teste.
const { chromium } = require("playwright");

const siteUrl = process.env.QT_SITE_URL || "http://127.0.0.1:8765/";
const faceImage = process.env.QT_FACE_IMAGE;

if (!faceImage) throw new Error("QT_FACE_IMAGE não foi informado.");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  await page.route(new URL("__qt_face_fixture.png", siteUrl).href, (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    path: faceImage,
  }));
  await page.addInitScript(() => {
    const mediaDevices = new EventTarget();
    mediaDevices.enumerateDevices = async () => [{
      kind: "videoinput",
      deviceId: "face-fixture",
      label: "Fixture facial local",
    }];
    mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d");
      const image = new Image();
      image.src = new URL("__qt_face_fixture.png", window.location.href).href;
      await image.decode();
      const render = () => {
        context.fillStyle = "#8b8b8b";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 360, 80, 560, 560);
      };
      render();
      window.__qtFaceFixtureTimer = window.setInterval(render, 70);
      const stream = canvas.captureStream(15);
      const track = stream.getVideoTracks()[0];
      const originalStop = track.stop.bind(track);
      track.stop = () => {
        window.clearInterval(window.__qtFaceFixtureTimer);
        originalStop();
      };
      return stream;
    };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });
  });

  try {
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.quantumCameraController && window.QuantumControl));
    await page.locator("#startCamera").click();
    await page.waitForFunction(() => window.QuantumControl.state.vision.status === "ONLINE", null, { timeout: 90000 });
    await page.waitForFunction(() => /^TEMP-/.test(document.getElementById("currentFaceId").textContent), null, { timeout: 90000 });
    const detection = await page.evaluate(() => ({
      id: document.getElementById("currentFaceId").textContent,
      status: document.getElementById("faceStatus").textContent,
      confidence: document.getElementById("faceConfidence").textContent,
      hint: document.getElementById("faceHint").textContent,
      tracking: window.QuantumControl.state.vision.tracking,
      targetId: window.QuantumControl.state.vision.targetId,
      canvasHasPixels: (() => {
        const canvas = document.getElementById("identityCanvas");
        return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value) => value !== 0);
      })(),
    }));
    await page.locator("#personName").fill("Pessoa Fixture");
    await page.waitForFunction(() => !document.getElementById("registerPerson").disabled);
    await page.locator("#registerPerson").click();
    await page.waitForFunction(() => /^QT-/.test(document.getElementById("currentFaceId").textContent), null, { timeout: 30000 });
    const registeredId = await page.locator("#currentFaceId").textContent();
    await page.waitForFunction(() => document.getElementById("identityCount").textContent === "1 ID");
    await page.locator("#stopCamera").click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.quantumCameraController && window.QuantumControl));
    await page.locator("#startCamera").click();
    await page.waitForFunction((expectedId) => document.getElementById("currentFaceId").textContent === expectedId, registeredId, { timeout: 90000 });
    const recognition = await page.evaluate(() => ({
      id: document.getElementById("currentFaceId").textContent,
      hint: document.getElementById("faceHint").textContent,
      count: document.getElementById("identityCount").textContent,
      tracking: window.QuantumControl.state.vision.tracking,
    }));
    await page.locator("#stopCamera").click();
    const result = { detection, registeredId, recognition, pageErrors, consoleErrors, failedRequests };
    process.stdout.write(JSON.stringify(result));
    if (!/^TEMP-/.test(detection.id) || !detection.status.includes("ROSTO DETECTADO")
      || !detection.canvasHasPixels || !/^QT-/.test(registeredId) || recognition.id !== registeredId
      || recognition.count !== "1 ID" || pageErrors.length || consoleErrors.length || failedRequests.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
