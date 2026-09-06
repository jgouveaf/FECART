"use strict";

// Navegador real + streams seriais simulados. Nunca acessa Arduino/câmera reais.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const siteUrl = process.env.QT_SITE_URL || "http://127.0.0.1:9876/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  let scenarios = 0;
  try {
    for (const [readyLine, expected] of [
      [null, "ARDUINO SEM RESPOSTA"],
      ["AUTO:READY:2", "CÓDIGO AUTÔNOMO SEPARADO"],
      ["QT:READY:V6", "FIRMWARE INCOMPATÍVEL"],
      ["Distancia: 40 cm", "PROTOCOLO NÃO CONFIRMADO"],
    ]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ readyLine }) => {
        localStorage.setItem("quantumAuth:v1", "ok");
        window.__QUANTUM_ROBOT_TEST__ = { readyTimeoutMs: 300, ackTimeoutMs: 200 };
        window.__serialWrites = [];
        window.__serialReadyLine = readyLine;
        const serial = new EventTarget();
        serial.requestPort = async () => {
          let receive;
          const encoder = new TextEncoder();
          return {
            async open() {
              this.readable = new ReadableStream({ start(controller) { receive = controller; } });
              this.writable = new WritableStream({
                write(bytes) {
                  const command = new TextDecoder().decode(bytes).trim();
                  window.__serialWrites.push(command);
                  const answer = command === "HELLO" ? window.__serialReadyLine
                    : ["ESTOP", "CMD:PARAR", "MODE:1"].includes(command) ? `OK:${command}` : null;
                  if (answer) receive.enqueue(encoder.encode(`${answer}\n`));
                },
              });
            },
            async close() { window.__serialClosed = true; },
          };
        };
        // Substituição total: nenhuma chamada pode alcançar navigator.serial real.
        Object.defineProperty(navigator, "serial", { value: serial });
      }, { readyLine });
      try {
        await page.goto(siteUrl, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => window.quantumRobot && window.QuantumControl);
        await page.locator("#connectRobot").click();
        await page.waitForFunction(() => !window.quantumRobot.usbBusy);
        const actual = await page.evaluate(() => ({
          label: document.getElementById("robotConnectionStatus").textContent,
          robot: document.getElementById("overallRobotStatus").textContent,
          communication: document.getElementById("overallCommunicationStatus").textContent,
          retryEnabled: !document.getElementById("connectRobot").disabled,
          closed: window.__serialClosed,
          writes: window.__serialWrites,
        }));
        assert.equal(actual.label, expected);
        assert.equal(actual.robot, expected);
        assert.equal(actual.communication, "ERROR");
        assert.equal(actual.retryEnabled, true);
        assert.equal(actual.closed, true);
        assert.equal(actual.writes.includes("RESET_ESTOP"), false);
        const recoveryExpected = readyLine === "AUTO:READY:2" || readyLine === "QT:READY:V6";
        assert.equal(await page.locator("#robotFirmwareRecovery").isVisible(), recoveryExpected);
        if (recoveryExpected) {
          await page.locator("#robotFirmwareRecovery").click();
          assert.equal(new URL(page.url()).hash, "#codigos");
          assert.deepEqual(await page.evaluate(() => window.__serialWrites), actual.writes, "link de orientação não deve gravar nem enviar comando");
        }
        // Mesmo painel, nova seleção explícita; não deve herdar o erro anterior.
        await page.evaluate(() => { window.__serialReadyLine = "QT:READY:V7"; });
        await page.locator("#connectRobot").click();
        await page.waitForFunction(() => window.quantumRobot.connected);
        assert.equal(await page.locator("#overallCommunicationStatus").textContent(), "ONLINE");
        assert.equal(await page.locator("#robotFirmwareRecovery").isVisible(), false);
        assert.equal(await page.evaluate(() => window.QuantumControl.state.safety.emergency), true);
        assert.equal(await page.evaluate(() => window.__serialWrites.includes("RESET_ESTOP")), false);
        await page.locator("#disconnectRobot").click();
        await page.waitForFunction(() => !window.quantumRobot.usbBusy);
        assert.equal(await page.locator("#overallCommunicationStatus").textContent(), "OFFLINE");
        assert.deepEqual(errors, []);
        console.log(`ok - ${expected}: painel, orientação, reconexão em ESTOP`);
        scenarios++;
      } finally { await page.close(); }
    }
    console.log(`${scenarios} cenários de recuperação USB passaram no Chromium (serial simulada).`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
