"use strict";

// Executa o controlador real sem USB: as fronteiras DOM, rede e bootloader
// sao simuladas. A integridade usa SHA-256 real e o HEX distribuido no site.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");
const SOURCE_FILE = path.join(ROOT, "web", "arduino-flasher.js");
const SOURCE = fs.readFileSync(SOURCE_FILE, "utf8")
  .replace(/^import\s+.*?;\s*$/gm, "")
  .replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(SOURCE_FILE).href));
const HEX = fs.readFileSync(path.join(ROOT, "firmware", "compiled", "quantum_tracker_arduino.ino.hex"), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function namedError(name, message) {
  return Object.assign(new Error(message), { name });
}

function harness(options = {}) {
  const events = [];
  const listeners = new Map();
  const elements = new Map();
  let activation = true;
  const classes = new Set();
  const title = { textContent: "" };
  const detail = { textContent: "" };
  for (const id of ["flashOfficialFirmware", "firmwareFlasher", "firmwareFlashProgress", "firmwareFlashStatus"]) {
    elements.set(id, {
      disabled: false,
      textContent: "",
      value: 0,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
      },
      querySelector: (selector) => selector === "strong" ? title : detail,
      addEventListener: (type, callback) => listeners.set(`${id}:${type}`, callback),
    });
  }
  const transport = {
    async open(baudRate) {
      events.push(["open", baudRate]);
      if (options.openError) throw options.openError;
    },
    async close() {
      events.push(["close"]);
      if (options.closeError) throw options.closeError;
    },
  };
  const navigator = {
    serial: {
      requestPort() {
        events.push(["requestPort"]);
        if (!activation) return Promise.reject(namedError("SecurityError", "User activation expired"));
        if (options.chooseError) return Promise.reject(options.chooseError);
        return options.chooseGate?.promise || Promise.resolve({ mockPort: true });
      },
    },
  };
  const quantumRobot = {
    connected: Boolean(options.connected),
    usbBusy: Boolean(options.usbBusy),
    async disconnect(configuration) {
      events.push(["disconnect", configuration]);
      if (options.disconnectError) throw options.disconnectError;
      if (options.disconnectGate) await options.disconnectGate.promise;
      quantumRobot.connected = false;
    },
  };
  const window = {
    isSecureContext: options.secure !== false,
    confirm() {
      events.push(["confirm"]);
      return options.confirm !== false;
    },
    quantumRobot,
    QuantumControl: { log: (...entry) => events.push(["log", ...entry]) },
  };
  class MockWebSerialTransport {
    static isSupported() { return options.supported !== false; }
    static async requestPort() {
      await navigator.serial.requestPort();
      return transport;
    }
  }
  class MockSTK500 {
    constructor(selectedTransport, board) {
      assert.equal(selectedTransport, transport);
      assert.equal(board.baudRate, 115200);
    }
    async bootload(hex, onProgress) {
      events.push(["program", hex]);
      if (options.programError) throw options.programError;
      onProgress("verify", 100);
    }
  }
  const context = vm.createContext({
    window,
    navigator,
    document: { getElementById: (id) => elements.get(id) },
    URL,
    TextEncoder,
    Uint8Array,
    console,
    STK500: MockSTK500,
    WebSerialTransport: MockWebSerialTransport,
    BOARDS: { "arduino-uno": { baudRate: 115200 } },
    crypto: {
      subtle: {
        async digest(algorithm, bytes) {
          events.push(["hash"]);
          return webcrypto.subtle.digest(algorithm, bytes);
        },
      },
    },
    async fetch() {
      events.push(["fetch"]);
      if (options.fetchGate) await options.fetchGate.promise;
      return {
        ok: true,
        status: 200,
        text: async () => options.invalidHex ? `${HEX}\nCORROMPIDO` : HEX,
      };
    },
  });
  vm.runInContext(SOURCE, context, { filename: SOURCE_FILE });
  return {
    events, window, title, detail, classes,
    button: elements.get("flashOfficialFirmware"),
    click: () => listeners.get("flashOfficialFirmware:click")(),
    expireActivation: () => { activation = false; },
    names: () => events.map(([name]) => name),
  };
}

test("chooser conserva o clique original antes de rede ou desconexao lenta", async () => {
  const disconnectGate = deferred();
  const h = harness({ connected: true, disconnectGate });
  const operation = h.click();
  const synchronousEvents = h.names();
  h.expireActivation();
  disconnectGate.resolve();
  await operation;
  assert.deepEqual(synchronousEvents, ["confirm", "requestPort"]);
  assert.ok(h.names().indexOf("requestPort") < h.names().indexOf("disconnect"));
  assert.ok(h.names().indexOf("requestPort") < h.names().indexOf("fetch"));
  assert.ok(h.names().includes("program"), "rede ou desconexao nao deve perder a ativacao do seletor");
});

test("cancelar o seletor nao abre porta, baixa firmware nem desconecta robo ativo", async () => {
  const h = harness({ connected: true, chooseError: namedError("NotFoundError", "cancelled") });
  await assert.doesNotReject(() => h.click());
  assert.equal(h.window.quantumRobot.connected, true);
  for (const action of ["disconnect", "fetch", "open", "program", "close"]) assert.ok(!h.names().includes(action), action);
  assert.equal(h.window.quantumFirmwareFlasher.busy, false);
  assert.equal(h.button.disabled, false);
  assert.match(h.detail.textContent, /cancelada|cancelado/i);
});

test("firmware com hash invalido nunca abre nem programa o UNO", async () => {
  const h = harness({ invalidHex: true });
  await h.click();
  assert.ok(h.names().includes("hash"));
  assert.ok(!h.names().includes("open"));
  assert.ok(!h.names().includes("program"));
  assert.ok(!h.names().includes("close"), "nao fechar uma porta apenas selecionada");
  assert.match(h.detail.textContent, /integridade/i);
  assert.equal(h.window.quantumFirmwareFlasher.busy, false);
});

test("caminho correto exige parada confirmada, valida HEX, abre, grava e fecha", async () => {
  const h = harness({ connected: true });
  await h.click();
  const names = h.names();
  const disconnect = h.events.find(([name]) => name === "disconnect");
  assert.equal(disconnect?.[1]?.requireStop, true);
  for (const [before, after] of [["requestPort", "disconnect"], ["disconnect", "open"], ["hash", "open"], ["open", "program"], ["program", "close"]]) {
    assert.ok(names.includes(before) && names.indexOf(before) < names.indexOf(after), `${before} antes de ${after}`);
  }
  assert.equal(h.events.find(([name]) => name === "program")[1], HEX);
  assert.equal(h.events.filter(([name]) => name === "close").length, 1);
  assert.match(h.title.textContent, /INSTALADO/);
  assert.equal(h.window.quantumFirmwareFlasher.busy, false);
  assert.equal(h.button.disabled, false);
});

test("sem confirmacao de ESTOP nao abre nem grava e preserva conexao existente", async () => {
  const h = harness({ connected: true, disconnectError: new Error("ESTOP sem confirmacao") });
  await assert.doesNotReject(() => h.click());
  assert.ok(h.names().includes("requestPort"));
  assert.ok(h.names().includes("disconnect"));
  assert.ok(!h.names().includes("open"));
  assert.ok(!h.names().includes("program"));
  assert.ok(!h.names().includes("close"), "conexao ainda pertence ao controle se ESTOP falhar");
  assert.equal(h.window.quantumRobot.connected, true);
  assert.match(h.detail.textContent, /ESTOP/);
  assert.equal(h.window.quantumFirmwareFlasher.busy, false);
});

test("falha ao abrir fecha transporte e libera busy para nova tentativa", async () => {
  const options = { openError: namedError("NetworkError", "Port busy") };
  const h = harness(options);
  await h.click();
  assert.ok(!h.names().includes("program"));
  assert.ok(h.names().includes("close"));
  assert.match(h.detail.textContent, /ocupada|abrir a porta/i);
  assert.equal(h.window.quantumFirmwareFlasher.busy, false);
  assert.equal(h.button.disabled, false);
  options.openError = null;
  await h.click();
  assert.equal(h.events.filter(([name]) => name === "requestPort").length, 2);
  assert.ok(h.names().includes("program"));
});

test("cliques concorrentes nao criam dois seletores ou duas gravacoes", async () => {
  const chooseGate = deferred();
  const h = harness({ chooseGate });
  const first = h.click();
  const second = h.click();
  chooseGate.resolve({ mockPort: true });
  await Promise.all([first, second]);
  assert.equal(h.events.filter(([name]) => name === "requestPort").length, 1);
  assert.equal(h.events.filter(([name]) => name === "program").length, 1);
  assert.equal(h.window.quantumFirmwareFlasher.busy, false);
});

test("conexao USB pendente bloqueia gravacao sem solicitar outra porta", async () => {
  const h = harness({ usbBusy: true });
  await assert.doesNotReject(() => h.click());
  assert.ok(!h.names().includes("requestPort"));
  assert.ok(!h.names().includes("fetch"));
  assert.match(h.title.textContent, /USB EM USO/);
});

test("contexto inseguro e navegador sem suporte mostram erro sem rejeicao nao tratada", async () => {
  for (const options of [{ secure: false }, { supported: false }]) {
    const h = harness(options);
    await assert.doesNotReject(() => h.click());
    assert.ok(!h.names().includes("requestPort"));
    assert.ok(!h.names().includes("open"));
    assert.equal(h.window.quantumFirmwareFlasher.busy, false);
    assert.ok(h.classes.has("error"));
  }
});

test("recusar confirmacao inicial nao solicita USB nem altera conexao do robo", async () => {
  const h = harness({ connected: true, confirm: false });
  await h.click();
  assert.deepEqual(h.names(), ["confirm"]);
  assert.equal(h.window.quantumRobot.connected, true);
  assert.equal(h.window.quantumFirmwareFlasher.busy, false);
});

test("falha de gravacao e de fechamento nao deixa gravador bloqueado", async () => {
  const h = harness({ programError: new Error("verify mismatch"), closeError: new Error("port removed") });
  await assert.doesNotReject(() => h.click());
  assert.ok(h.names().includes("close"));
  assert.match(h.detail.textContent, /verifica/i);
  assert.equal(h.window.quantumFirmwareFlasher.busy, false);
  assert.equal(h.button.disabled, false);
});
