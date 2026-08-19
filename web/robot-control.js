(() => {
  "use strict";

  const panel = document.getElementById("camera-gestos");
  const connectButton = document.getElementById("connectRobot");
  const disconnectButton = document.getElementById("disconnectRobot");
  const emergencyButton = document.getElementById("emergencyStop");
  const connectionDot = document.getElementById("robotConnectionDot");
  const connectionStatus = document.getElementById("robotConnectionStatus");
  const connectionHint = document.getElementById("robotConnectionHint");
  const modeStatus = document.getElementById("robotModeStatus");
  const commandStatus = document.getElementById("robotCommandStatus");
  const distanceStatus = document.getElementById("robotDistanceStatus");
  const stateStatus = document.getElementById("robotStateStatus");
  const gestureDeliveryStatus = document.getElementById("gestureDeliveryStatus");
  const beaconButton = document.getElementById("connectBeacon");
  const beaconStatus = document.getElementById("beaconStatus");

  const MODE_NAMES = { 1: "AUTÔNOMO", 2: "SEGUIR PESSOA", 3: "GESTOS" };
  const VALID_COMMANDS = new Set(["FRENTE", "TRAS", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"]);
  const COMMAND_HEARTBEAT_MS = 500;
  const INPUT_TIMEOUT_MS = 900;

  let port = null;
  let reader = null;
  let writer = null;
  let connected = false;
  let closing = false;
  let readBuffer = "";
  let currentMode = 1;
  let emergencyActive = false;
  let lastIntent = "PARAR";
  let lastInputAt = 0;
  let lastWriteAt = 0;
  let lastWrittenCommand = "";
  let writeChain = Promise.resolve();
  let beaconDevice = null;

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function setConnection(text, active, hint = "") {
    connectionStatus.textContent = text;
    connectionDot.classList.toggle("idle", !active);
    if (hint) connectionHint.textContent = hint;
  }

  function setMode(mode, send = true) {
    currentMode = Number(mode);
    panel.dataset.robotMode = String(currentMode);
    modeStatus.textContent = MODE_NAMES[currentMode];
    document.querySelectorAll(".robot-mode").forEach((button) => {
      const selected = Number(button.dataset.robotMode) === currentMode;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    lastIntent = currentMode === 1 ? "FRENTE" : "PARAR";
    lastInputAt = performance.now();
    commandStatus.textContent = lastIntent;
    if (currentMode === 2) document.getElementById("faceCameraTab").click();
    if (currentMode === 3) document.getElementById("handCameraTab").click();
    if (send && connected) {
      sendLine("CMD:PARAR", true);
      sendLine(`MODE:${currentMode}`, true);
    }
    updateDeliveryHint();
  }

  function updateDeliveryHint() {
    if (currentMode !== 3) {
      gestureDeliveryStatus.textContent = "Gestos detectados, mas só são enviados no Modo 3.";
    } else if (!connected) {
      gestureDeliveryStatus.textContent = "Gesto reconhecido. Conecte o Arduino por USB para aplicá-lo ao robô.";
    } else {
      gestureDeliveryStatus.textContent = `Modo 3 ativo · comando ${lastIntent} enviado ao Arduino por USB.`;
    }
  }

  function sendLine(line, urgent = false) {
    if (!connected || !writer) return Promise.resolve(false);
    const payload = `${line}\n`;
    writeChain = writeChain.then(async () => {
      if (!connected || !writer) return false;
      await writer.write(new TextEncoder().encode(payload));
      if (line.startsWith("CMD:")) {
        lastWrittenCommand = line.slice(4);
        lastWriteAt = performance.now();
        commandStatus.textContent = lastWrittenCommand;
      }
      return true;
    }).catch((error) => {
      console.error("Falha ao enviar comando serial", error);
      handleConnectionFailure(error);
      return false;
    });
    if (urgent) lastWriteAt = 0;
    return writeChain;
  }

  function deliverIntent(command, source) {
    if (!VALID_COMMANDS.has(command)) return;
    lastIntent = command;
    lastInputAt = performance.now();
    commandStatus.textContent = command;
    const urgent = command === "PARAR";
    const changed = command !== lastWrittenCommand;
    if (connected && !emergencyActive && (urgent || changed || performance.now() - lastWriteAt >= COMMAND_HEARTBEAT_MS)) {
      sendLine(`CMD:${command}`, urgent);
    }
    if (source === "gesture") updateDeliveryHint();
  }

  function parseTelemetry(line) {
    if (!line) return;
    if (line === "QT:READY:V3") {
      stateStatus.textContent = "FIRMWARE V3 PRONTO";
      return;
    }
    if (line.startsWith("ALERTA:")) {
      stateStatus.textContent = line.slice(7).replaceAll("_", " ");
      emergencyActive = true;
      emergencyButton.textContent = "Liberar após conferir";
      return;
    }
    if (!line.startsWith("QT|")) return;
    const values = {};
    for (const part of line.split("|").slice(1)) {
      const separator = part.indexOf(":");
      if (separator > 0) values[part.slice(0, separator)] = part.slice(separator + 1);
    }
    if (values.MODE) modeStatus.textContent = MODE_NAMES[Number(values.MODE)] || values.MODE;
    if (values.DIST) distanceStatus.textContent = values.DIST === "ERR" ? "SEM ECO" : `${values.DIST} cm`;
    if (values.CMD) commandStatus.textContent = values.CMD;
    if (values.STATE) stateStatus.textContent = values.STATE.replaceAll("_", " ");
  }

  async function readLoop() {
    while (port?.readable && connected && !closing) {
      reader = port.readable.getReader();
      try {
        while (connected && !closing) {
          const { value, done } = await reader.read();
          if (done) break;
          readBuffer += new TextDecoder().decode(value, { stream: true });
          const lines = readBuffer.split(/\r?\n/);
          readBuffer = lines.pop() || "";
          lines.forEach((line) => parseTelemetry(line.trim()));
        }
      } catch (error) {
        if (!closing) handleConnectionFailure(error);
      } finally {
        reader.releaseLock();
        reader = null;
      }
    }
  }

  async function connectRobot() {
    if (connected) return;
    if (!window.isSecureContext || !("serial" in navigator)) {
      setConnection("NAVEGADOR INCOMPATÍVEL", false, "Abra o site no Chrome ou Edge para computador usando HTTPS.");
      return;
    }
    connectButton.disabled = true;
    setConnection("SELECIONE A PORTA", false, "Escolha Arduino UNO ou a porta USB correspondente.");
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600, bufferSize: 1024 });
      writer = port.writable.getWriter();
      connected = true;
      closing = false;
      readBuffer = "";
      disconnectButton.disabled = false;
      emergencyButton.disabled = false;
      setConnection("INICIALIZANDO", true, "O Arduino UNO reinicia ao abrir a porta. Aguarde cerca de 2 segundos.");
      readLoop();
      await delay(2300);
      if (!connected) return;
      setConnection("CONECTADO", true, "Comandos e telemetria ativos pelo cabo USB.");
      await sendLine(`MODE:${currentMode}`, true);
      await sendLine("STATUS", true);
      updateDeliveryHint();
    } catch (error) {
      if (error?.name === "NotFoundError") setConnection("SELEÇÃO CANCELADA", false, "Nenhuma porta foi escolhida.");
      else setConnection("FALHA NA CONEXÃO", false, error?.message || "Não foi possível abrir a porta USB.");
      await closePort(false);
    } finally {
      connectButton.disabled = connected;
    }
  }

  async function closePort(sendStop = true) {
    if (closing) return;
    closing = true;
    if (sendStop && connected && writer) {
      try { await writer.write(new TextEncoder().encode("CMD:PARAR\n")); } catch { /* porta já removida */ }
    }
    connected = false;
    try { await reader?.cancel(); } catch { /* leitura já encerrada */ }
    try { writer?.releaseLock(); } catch { /* trava já liberada */ }
    writer = null;
    try { await port?.close(); } catch { /* porta já desconectada */ }
    port = null;
    closing = false;
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    emergencyButton.disabled = true;
    emergencyActive = false;
    setConnection("DESCONECTADO", false, "Use Chrome ou Edge no computador e conecte o cabo USB.");
    stateStatus.textContent = "SEM TELEMETRIA";
    distanceStatus.textContent = "—";
    commandStatus.textContent = "PARAR";
    updateDeliveryHint();
  }

  function handleConnectionFailure(error) {
    console.warn("Conexão serial encerrada", error);
    setConnection("CONEXÃO PERDIDA", false, "O cabo foi removido ou a porta deixou de responder.");
    closePort(false);
  }

  async function toggleEmergency() {
    if (!connected) return;
    if (!emergencyActive) {
      emergencyActive = true;
      lastIntent = "PARAR";
      await sendLine("ESTOP", true);
      commandStatus.textContent = "PARAR";
      emergencyButton.textContent = "Liberar após conferir";
      stateStatus.textContent = "ESTOP";
    } else if (window.confirm("As rodas estão livres e é seguro liberar a parada de emergência?")) {
      await sendLine("RESET_ESTOP", true);
      emergencyActive = false;
      emergencyButton.textContent = "PARADA DE EMERGÊNCIA";
      lastIntent = currentMode === 1 ? "FRENTE" : "PARAR";
    }
  }

  async function connectBeacon() {
    if (!("bluetooth" in navigator)) {
      beaconStatus.textContent = "WEB BLUETOOTH INDISPONÍVEL";
      return;
    }
    beaconButton.disabled = true;
    try {
      beaconDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      if (typeof beaconDevice.watchAdvertisements !== "function") throw new Error("Este navegador não fornece leitura de anúncios/RSSI.");
      beaconDevice.addEventListener("advertisementreceived", (event) => {
        const rssi = Number(event.rssi);
        const proximity = rssi >= -60 ? "PERTO" : rssi >= -75 ? "MÉDIO" : "LONGE";
        beaconStatus.textContent = Number.isFinite(rssi) ? `${proximity} · ${rssi} dBm` : "SINAL RECEBIDO";
        window.dispatchEvent(new CustomEvent("quantum:beacon-signal", { detail: { rssi, proximity, deviceId: beaconDevice.id } }));
      });
      await beaconDevice.watchAdvertisements();
      beaconStatus.textContent = "AGUARDANDO ANÚNCIO BLE";
    } catch (error) {
      beaconStatus.textContent = error?.name === "NotFoundError" ? "SELEÇÃO CANCELADA" : "BLE NÃO DISPONÍVEL";
      connectionHint.textContent = error?.message || connectionHint.textContent;
      beaconButton.disabled = false;
    }
  }

  window.addEventListener("quantum:gesture-command", (event) => {
    if (currentMode !== 3) return;
    deliverIntent(event.detail?.command || "PARAR", "gesture");
  });

  window.addEventListener("quantum:person-tracking", (event) => {
    if (currentMode !== 2) return;
    deliverIntent(event.detail?.visible ? event.detail.command : "PARAR", "face");
    if (!event.detail?.visible && beaconDevice) stateStatus.textContent = "ROSTO PERDIDO · BLE SEM DIREÇÃO · PARADO";
  });

  window.setInterval(() => {
    if (!connected || emergencyActive || currentMode === 1) return;
    if (performance.now() - lastInputAt > INPUT_TIMEOUT_MS) lastIntent = "PARAR";
    deliverIntent(lastIntent, currentMode === 3 ? "gesture" : "face");
  }, COMMAND_HEARTBEAT_MS);

  document.querySelectorAll(".robot-mode").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.robotMode)));
  connectButton.addEventListener("click", connectRobot);
  disconnectButton.addEventListener("click", () => closePort(true));
  emergencyButton.addEventListener("click", toggleEmergency);
  beaconButton.addEventListener("click", connectBeacon);
  navigator.serial?.addEventListener?.("disconnect", (event) => { if (event.target === port) handleConnectionFailure(new Error("Arduino desconectado.")); });
  window.addEventListener("pagehide", () => { if (connected && writer) writer.write(new TextEncoder().encode("CMD:PARAR\n")).catch(() => {}); });

  panel.dataset.robotMode = "1";
  window.quantumRobot = { get connected() { return connected; }, get mode() { return currentMode; }, send: deliverIntent };
  setMode(1, false);
})();
