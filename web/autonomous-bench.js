import { STK500 } from "./vendor/webserial-flasher/dist/stk500.js";
import { WebSerialTransport } from "./vendor/webserial-flasher/dist/transport/WebSerialTransport.js";
import { BOARDS } from "./vendor/webserial-flasher/dist/boards/database.js";

const $ = id => document.getElementById(id);
const firmwareUrl = new URL("../firmware/compiled/autonomo_isolado.ino.hex", import.meta.url);
const firmwareHash = "9e3d1df2aecd8745d4ef34d03d80f96b7a3229a234da8eb48edc14eb9835d15f";
const phases = ["Parado", "Verificando caminho", "Frente", "Pausa antes da ré", "Ré", "Pausa antes da curva", "Curva", "Sem leitura válida — parado"];
let port, reader, writer, reading, verified = false, busy = false, waiters = [];
let txTail = Promise.resolve(), buffer = "", epoch = 0, generation = 0, latest = 0;
const logs = [];
function log(line) {
  logs.push(line);
  if (logs.length > 25) logs.shift();
  $("autoLog").textContent = logs.join("\n");
}
function buttons() {
  $("autoFlash").disabled = busy || !!port;
  $("autoConnect").disabled = busy || !!port;
  $("autoStart").disabled = busy || !verified || Date.now() - latest > 2000;
  $("autoStop").disabled = !writer;
  $("autoDisconnect").disabled = busy || !port;
}
function rejectWaiters(error) {
  const old = waiters; waiters = [];
  for (const w of old) { clearTimeout(w.timer); w.reject(error); }
}
function receive(line) {
  log(`RX ${line}`);
  for (const w of [...waiters]) if (line === w.expected) {
    clearTimeout(w.timer); waiters = waiters.filter(x => x !== w); w.resolve();
  }
  if (!line.startsWith("AUTO|")) return;
  const values = Object.fromEntries(line.split("|").slice(1).map(x => { const at = x.indexOf(":"); return [x.slice(0, at), x.slice(at + 1)]; }));
  latest = Date.now();
  $("autoDistance").textContent = values.DIST === "ERR" ? "Sem leitura válida" : `${values.DIST} cm`;
  $("autoEcho").textContent = values.ECHO_US;
  $("autoPhase").textContent = phases[Number(values.PHASE)] || "Desconhecida";
  $("autoCommand").textContent = values.CMD;
  $("autoSample").textContent = values.N;
  $("autoUptime").textContent = `${(Number(values.UP) / 1000).toFixed(1)} s`;
  buttons();
}
function send(line, token = epoch) {
  const owner = writer, session = generation;
  const task = txTail.catch(() => {}).then(async () => {
    if (!owner || owner !== writer || session !== generation || token !== epoch) throw new Error("Operação cancelada");
    log(`TX ${line}`);
    await owner.write(new TextEncoder().encode(`${line}\n`));
  });
  txTail = task;
  return task;
}
async function command(line, expected, token = epoch) {
  let waiter;
  const reply = new Promise((resolve, reject) => {
    waiter = { expected, resolve, reject };
    waiter.timer = setTimeout(() => {
      waiters = waiters.filter(x => x !== waiter);
      reject(new Error(`Arduino não confirmou ${line}`));
    }, 2500);
    waiters.push(waiter);
  });
  // Instala o tratamento antes de qualquer await para nao perder rejeicoes.
  try { await Promise.all([send(line, token), reply]); }
  finally { clearTimeout(waiter.timer); waiters = waiters.filter(x => x !== waiter); }
}
async function readLoop(ownReader) {
  const decoder = new TextDecoder();
  try {
    while (reader === ownReader) {
      const { value, done } = await ownReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes("\n")) {
        const at = buffer.indexOf("\n"), line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line.length > 256) throw new Error("Linha serial inválida");
        if (line) receive(line);
      }
      if (buffer.length > 256) throw new Error("Buffer serial inválido");
    }
    if (reader === ownReader) throw new Error("Conexão USB encerrada");
  } catch (error) {
    if (reader === ownReader) {
      verified = false; latest = 0;
      rejectWaiters(error);
      $("autoStatus").textContent = `${error.message}. Desligue os motores pela chave se estiverem ligados.`;
      buttons();
    }
  }
}
async function close() {
  verified = false; latest = 0; ++generation; ++epoch;
  rejectWaiters(new Error("Conexão encerrada"));
  const oldReader = reader; reader = null;
  try { await oldReader?.cancel(); await reading; } catch { /* cabo retirado */ }
  try { oldReader?.releaseLock(); } catch { /* ja liberado */ }
  try { writer?.releaseLock(); } catch { /* ja liberado */ }
  writer = null;
  try { await port?.close(); } catch { /* cabo retirado */ }
  port = null; buffer = ""; txTail = Promise.resolve();
  buttons();
}
async function stop() {
  const token = ++epoch;
  rejectWaiters(new Error("Cancelado pelo botão Parar"));
  $("autoStatus").textContent = "Solicitando parada…";
  try {
    await command("ESTOP", "OK:STOP", token);
    $("autoStatus").textContent = "Parada confirmada pelo firmware.";
  } catch (error) {
    $("autoStatus").textContent = "Parada NÃO confirmada: desligue os motores pela chave.";
    throw error;
  }
}
$("autoConnect").addEventListener("click", async () => {
  if (busy || port) return;
  busy = true; buttons();
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    writer = port.writable.getWriter(); reader = port.readable.getReader();
    reading = readLoop(reader); buttons();
    // Abrir a porta pode reiniciar um firmware antigo: apenas ESTOP no boot.
    for (let i = 0; i < 12; i++) { await send("ESTOP"); await new Promise(r => setTimeout(r, 250)); }
    await command("HELLO", "AUTO:READY:1");
    await stop();
    verified = true;
    await send("STATUS");
    $("autoStatus").textContent = "Autônomo isolado conectado e parado. Confira o sensor antes de iniciar.";
  } catch (error) {
    $("autoStatus").textContent = `${error.message}. Use o firmware isolado; feche outros programas que usam a porta. Nenhum START foi enviado.`;
    await close();
  } finally { busy = false; buttons(); }
});
$("autoStart").addEventListener("click", async () => {
  if (busy || !verified || Date.now() - latest > 2000) return;
  if (!window.confirm("O sensor foi conferido, as rodas estão livres e é seguro iniciar? O autônomo continua na placa até Parar ou desligar.")) return;
  busy = true; const token = ++epoch; buttons();
  try {
    await command("START", "OK:START", token);
    if (token === epoch) $("autoStatus").textContent = "Autônomo iniciado. Sem temporizador de missão.";
  } catch (error) {
    if (token === epoch) { log(error.message); try { await stop(); } catch { /* aviso ja visivel */ } }
  } finally { busy = false; buttons(); }
});
$("autoStop").addEventListener("click", () => stop().catch(error => log(error.message)));
$("autoDisconnect").addEventListener("click", async () => {
  if (busy) return;
  busy = true; buttons();
  try { await stop(); await close(); $("autoStatus").textContent = "Parado e desconectado."; }
  catch (error) { log(error.message); }
  finally { busy = false; buttons(); }
});
$("autoFlash").addEventListener("click", async () => {
  if (busy || port) return;
  if (!window.confirm("Desligue a alimentação dos motores, mantenha o UNO no USB e feche outros painéis. Substituir o firmware pelo autônomo isolado?")) return;
  busy = true; buttons(); let transport;
  try {
    transport = await WebSerialTransport.requestPort();
    const response = await fetch(firmwareUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Firmware indisponível (${response.status})`);
    const hex = (await response.text()).replace(/\r\n/g, "\n");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hex));
    const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
    if (hash !== firmwareHash) throw new Error("Integridade do firmware inválida; gravação cancelada");
    const board = BOARDS["arduino-uno"];
    await transport.open(board.baudRate);
    const programmer = new STK500(transport, board);
    await programmer.bootload(hex, (stage, percent) => {
      $("autoProgress").value = percent;
      $("autoFlashStatus").textContent = `${stage} · ${percent}% — não remova o USB.`;
    });
    $("autoProgress").value = 100;
    $("autoFlashStatus").textContent = "Autônomo isolado gravado e verificado. Ele inicia parado. Agora conecte pelo botão abaixo.";
  } catch (error) { $("autoFlashStatus").textContent = `Não foi possível gravar: ${error.message}`; }
  finally { try { await transport?.close(); } catch {} busy = false; buttons(); }
});
setInterval(() => {
  if (verified && latest && Date.now() - latest > 2000) {
    $("autoStatus").textContent = "Telemetria desatualizada. O autônomo pode continuar na placa; tente Parar ou desligue pela chave.";
    buttons();
  }
}, 1000);
window.addEventListener("pagehide", () => { if (writer) { ++epoch; send("ESTOP").catch(() => {}); } });
if (!navigator.serial || !window.isSecureContext) {
  busy = true; buttons();
  $("autoStatus").textContent = "Abra este endereço HTTPS no Chrome ou Edge do computador. USB não disponível neste contexto.";
}
