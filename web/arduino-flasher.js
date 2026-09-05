import { STK500 } from "./vendor/webserial-flasher/dist/stk500.js";
import { WebSerialTransport } from "./vendor/webserial-flasher/dist/transport/WebSerialTransport.js";
import { BOARDS } from "./vendor/webserial-flasher/dist/boards/database.js";

const button = document.getElementById("flashOfficialFirmware");
const panel = document.getElementById("firmwareFlasher");
const progress = document.getElementById("firmwareFlashProgress");
const status = document.getElementById("firmwareFlashStatus");
const FIRMWARE_URL = new URL("../firmware/compiled/quantum_tracker_arduino.ino.hex", import.meta.url);
// Hash do conteúdo servido pelo GitHub Pages (Git normaliza o Intel HEX para LF).
const FIRMWARE_SHA256 = "79f8afdb87be2c489fe45d457d5897a8073fa18f4606df6e6cd493eb3cc70255";
let busy = false;

function setStatus(state, title, detail, percentage = progress.value) {
  panel.classList.remove("flashing", "success", "error");
  if (state) panel.classList.add(state);
  status.querySelector("strong").textContent = title;
  status.querySelector("small").textContent = detail;
  progress.value = Math.max(0, Math.min(100, Number(percentage) || 0));
}

function friendlyError(error) {
  if (error?.name === "NotFoundError") return "Seleção cancelada. Clique novamente, marque ‘Arduino Uno (COM…)’ e depois clique em Conectar.";
  if (error?.name === "NetworkError") return "A porta está ocupada. Desconecte o painel e feche o Monitor Serial.";
  const message = String(error?.message || error || "Erro desconhecido.");
  if (/sync/i.test(message)) return "O bootloader não respondeu. Confirme que é um Arduino UNO e tente novamente.";
  if (/signature/i.test(message)) return "A placa selecionada não respondeu como Arduino UNO/ATmega328P.";
  if (/verify/i.test(message)) return "A gravação terminou, mas a verificação encontrou diferença. Tente novamente sem remover o cabo.";
  return message;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, "\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadVerifiedFirmware() {
  const response = await fetch(FIRMWARE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Firmware indisponível (HTTP ${response.status}).`);
  const hex = await response.text();
  if (await sha256(hex) !== FIRMWARE_SHA256) throw new Error("A integridade do firmware não confere; a gravação foi cancelada.");
  return hex;
}

async function flashOfficialFirmware() {
  if (busy) return;
  if (window.quantumRobot?.usbBusy && !window.quantumRobot.connected) {
    setStatus("error", "USB EM USO", "Conclua ou cancele a conexão pendente antes de gravar.", 0);
    return;
  }
  if (!WebSerialTransport.isSupported()) {
    throw new Error("Use Google Chrome ou Microsoft Edge no computador. Este navegador não oferece Web Serial.");
  }
  if (!window.isSecureContext) throw new Error("A gravação USB exige o endereço HTTPS oficial do site.");
  if (!window.confirm("As rodas estão suspensas e é seguro reiniciar o Arduino para gravar o firmware oficial?")) return;

  busy = true;
  button.disabled = true;
  button.textContent = "Preparando…";
  setStatus("flashing", "PREPARANDO", "Baixando e verificando o firmware oficial…", 2);
  let transport = null;
  try {
    if (window.quantumRobot?.connected) {
      setStatus("flashing", "PARANDO O ROBÔ", "Enviando ESTOP e liberando a porta USB…", 4);
      await window.quantumRobot.disconnect();
    }
    const hex = await loadVerifiedFirmware();
    setStatus("flashing", "SELECIONE O ARDUINO", "Na janela do navegador, escolha a porta do Arduino UNO.", 6);
    transport = await WebSerialTransport.requestPort();
    const board = BOARDS["arduino-uno"];
    await transport.open(board.baudRate);
    const programmer = new STK500(transport, board, {
      retry: { syncAttempts: 8, retryDelayMs: 250 },
      logger(level, message) {
        if (level === "error" || level === "warn") console[level]("Gravador UNO:", message);
      },
    });
    await programmer.bootload(hex, (stage, percentage) => {
      const safePercentage = Math.max(8, Math.min(100, Number(percentage) || 0));
      setStatus("flashing", "GRAVANDO", `${stage} · não remova o cabo.`, safePercentage);
    });
    setStatus("success", "FIRMWARE INSTALADO", "Gravação e verificação concluídas. Agora conecte o Arduino na área Câmeras & robô.", 100);
    window.QuantumControl?.log?.("INFO", "FIRMWARE", "Firmware oficial gravado e verificado pelo site");
  } catch (error) {
    const message = friendlyError(error);
    const cancelled = error?.name === "NotFoundError";
    setStatus(cancelled ? "" : "error", cancelled ? "PORTA NÃO CONFIRMADA" : "NÃO FOI POSSÍVEL GRAVAR", message, 0);
    window.QuantumControl?.log?.(cancelled ? "INFO" : "ERROR", "FIRMWARE", message);
  } finally {
    try { await transport?.close(); } catch { /* porta já encerrada */ }
    busy = false;
    button.disabled = false;
    button.textContent = "Gravar no Arduino UNO";
  }
}

button?.addEventListener("click", flashOfficialFirmware);

if (!WebSerialTransport.isSupported()) {
  button.disabled = true;
  setStatus("error", "NAVEGADOR INCOMPATÍVEL", "Abra este site no Chrome ou Edge para gravar o Arduino UNO.", 0);
}

window.quantumFirmwareFlasher = Object.freeze({
  flash: flashOfficialFirmware,
  firmwareUrl: FIRMWARE_URL.href,
  board: "arduino-uno",
  get busy() { return busy; },
});
