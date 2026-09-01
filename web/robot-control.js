(() => {
  "use strict";

  const control = window.QuantumControl;
  const testConfig = window.__QUANTUM_ROBOT_TEST__ || {};
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
  const modeButtons = [...document.querySelectorAll(".robot-mode")];

  if (!panel || !connectButton || !disconnectButton || !emergencyButton) {
    console.error("Controle do robô não iniciou: elementos obrigatórios ausentes.");
    return;
  }

  const MODE_NAMES = Object.freeze({ 1: "AUTÔNOMO", 2: "SEGUIR PESSOA", 3: "GESTOS" });
  const VALID_COMMANDS = new Set(["FRENTE", "TRAS", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"]);
  const COMMAND_HEARTBEAT_MS = Number(testConfig.commandHeartbeatMs) || 500;
  const INPUT_TIMEOUT_MS = Number(testConfig.inputTimeoutMs) || 900;
  const SERIAL_SILENCE_TIMEOUT_MS = Number(testConfig.serialSilenceTimeoutMs) || 2200;
  const READY_TIMEOUT_MS = Number(testConfig.readyTimeoutMs) || 6500;
  const HELLO_PROBE_MS = Number(testConfig.helloProbeMs) || 650;
  const ACK_TIMEOUT_MS = Number(testConfig.ackTimeoutMs) || 1000;
  const MAX_EVENT_AGE_MS = Number(testConfig.maxEventAgeMs) || 1200;
  const MAX_QUEUED_MOTION_AGE_MS = Number(testConfig.maxQueuedMotionAgeMs) || 350;
  const MAX_READ_BUFFER = 512;
  const MAX_RECOVERABLE_READ_ERRORS = Number(testConfig.maxRecoverableReadErrors) || 2;
  const REQUIRED_FIRMWARE_READY = "QT:READY:V5";

  let port = null;
  let reader = null;
  let writer = null;
  let transportOpen = false;
  let connected = false;
  let closing = false;
  let closePromise = null;
  let readBuffer = "";
  let discardingReadLine = false;
  let readTask = null;
  let connectionGeneration = 0;
  let operationGeneration = 0;
  let modeGeneration = 0;
  let activeMode = Number(control?.state?.mode?.id) || 1;
  let confirmedMode = null;
  let modeTransitioning = false;
  let modeActivatedAt = performance.now();
  let emergencyActive = false;
  let emergencyOwner = null;
  let lastIntent = "PARAR";
  let lastFreshInputAt = 0;
  let lastSerialRxAt = 0;
  let lastWriteAt = 0;
  let lastWrittenCommand = "";
  let lastAcknowledgedCommand = "PARAR";
  let motionAckInFlight = false;
  let pendingMotion = null;
  let consecutiveMotionFailures = 0;
  let writeTail = Promise.resolve();
  let lineWaiters = new Set();
  let splitBrainHandling = false;

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function cancelled(message = "Operação substituída por uma solicitação mais recente.") {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }

  function log(level, source, message, details = null) {
    control?.log?.(level, source, message, details);
  }

  function patch(section, values, meta = {}) {
    try { control?.patch?.(section, values, meta); } catch (error) { console.warn("Estado central não aceitou atualização", error); }
  }

  function reportError(message, error = null) {
    const detail = error?.message && error.message !== message ? `${message}: ${error.message}` : message;
    patch("diagnostics", { lastError: detail }, { source: "robot-serial" });
    log("ERROR", "ARDUINO", detail);
  }

  function setConnection(text, status, hint = "") {
    if (connectionStatus) connectionStatus.textContent = text;
    if (connectionDot) {
      connectionDot.classList.toggle("idle", status !== "ONLINE");
      connectionDot.dataset.status = status.toLowerCase();
    }
    if (hint && connectionHint) connectionHint.textContent = hint;
    patch("communication", { status }, { source: "robot-serial" });
    patch("robot", { connected: status === "ONLINE", status, statusLabel: text }, { source: "robot-serial" });
  }

  function markTx(line) {
    patch("communication", { lastTx: line, status: splitBrainHandling ? "ERROR" : connected ? "ONLINE" : "CONNECTING" }, { source: "serial-tx" });
  }

  function markRx(line) {
    lastSerialRxAt = performance.now();
    patch("communication", { lastRx: line, status: splitBrainHandling ? "ERROR" : connected ? "ONLINE" : "CONNECTING" }, { source: "serial-rx" });
  }

  function renderMode(activeId = activeMode, requestedId = null) {
    panel.dataset.robotMode = String(activeId);
    const activeLabel = MODE_NAMES[activeId] || String(activeId);
    if (modeStatus) modeStatus.textContent = requestedId ? `${activeLabel} → ${MODE_NAMES[requestedId]}` : activeLabel;
    for (const button of modeButtons) {
      const id = Number(button.dataset.robotMode);
      const selected = id === activeId && requestedId === null;
      button.classList.toggle("active", selected);
      button.classList.toggle("pending", id === requestedId);
      button.setAttribute("aria-checked", String(selected));
      button.setAttribute("aria-busy", String(id === requestedId));
      button.tabIndex = id === (requestedId || activeId) ? 0 : -1;
    }
  }

  function updateDeliveryHint() {
    if (!gestureDeliveryStatus) return;
    if (activeMode !== 3) gestureDeliveryStatus.textContent = "Gestos detectados, mas só são enviados no Modo 3.";
    else if (!connected) gestureDeliveryStatus.textContent = "Gesto reconhecido. Conecte o Arduino por USB para aplicá-lo ao robô.";
    else if (modeTransitioning) gestureDeliveryStatus.textContent = "Aguarde a confirmação do modo pelo Arduino.";
    else gestureDeliveryStatus.textContent = `Modo 3 ativo · último comando confirmado: ${lastAcknowledgedCommand}.`;
  }

  function setEmergencyUi(active, state = active ? "ESTOP" : null, owner = active ? "firmware" : null) {
    emergencyActive = active;
    emergencyOwner = active ? owner : null;
    emergencyButton.textContent = active ? "Liberar após conferir" : "PARADA DE EMERGÊNCIA";
    if (state && stateStatus) stateStatus.textContent = state;
    patch("safety", { emergency: active, status: active ? "EMERGENCY" : "MONITORING" }, { source: "robot-safety" });
  }

  function rejectWaiters(error, generation = null) {
    for (const waiter of [...lineWaiters]) {
      if (generation === null || waiter.connectionGeneration === generation) waiter.reject(error);
    }
  }

  function rejectSupersededOperationWaiters(activeOperationToken) {
    for (const waiter of [...lineWaiters]) {
      if (waiter.operationGeneration !== null && waiter.operationGeneration !== activeOperationToken) {
        waiter.reject(cancelled());
      }
    }
  }

  function waitForLine(predicate, options = {}) {
    const connectionToken = options.connectionToken ?? connectionGeneration;
    const operationToken = options.operationToken ?? null;
    const timeoutMs = options.timeoutMs ?? ACK_TIMEOUT_MS;
    const label = options.label || "resposta do Arduino";
    let settled = false;
    let timeoutId = 0;
    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    // A transação pode ser cancelada enquanto ainda aguarda a fila de escrita.
    // Instala o tratador imediatamente para não gerar unhandledrejection; quem
    // aguarda `promise` continua recebendo a rejeição original normalmente.
    promise.catch(() => {});
    const waiter = {
      connectionGeneration: connectionToken,
      operationGeneration: operationToken,
      accept(line) {
        if (settled || connectionToken !== connectionGeneration) return false;
        let matches = false;
        try { matches = Boolean(predicate(line)); } catch (error) { this.reject(error); return false; }
        if (!matches) return false;
        settled = true;
        window.clearTimeout(timeoutId);
        lineWaiters.delete(waiter);
        resolvePromise(line);
        return true;
      },
      reject(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        lineWaiters.delete(waiter);
        rejectPromise(error);
      },
    };
    timeoutId = window.setTimeout(() => waiter.reject(new Error(`Tempo esgotado aguardando ${label}.`)), timeoutMs);
    lineWaiters.add(waiter);
    return { promise, cancel: (error = cancelled()) => waiter.reject(error) };
  }

  function enqueueLine(line, options = {}) {
    const connectionToken = options.connectionToken ?? connectionGeneration;
    const operationToken = options.operationToken ?? null;
    const modeToken = options.modeToken ?? null;
    const maxAgeMs = options.maxAgeMs ?? Infinity;
    const createdAt = performance.now();
    const payload = new TextEncoder().encode(`${line}\n`);
    const task = writeTail.then(async () => {
      if (!transportOpen || !writer || connectionToken !== connectionGeneration) return false;
      if (operationToken !== null && operationToken !== operationGeneration) return false;
      if (modeToken !== null && modeToken !== modeGeneration) return false;
      if (performance.now() - createdAt > maxAgeMs) return false;
      await writer.write(payload);
      markTx(line);
      if (line.startsWith("CMD:")) {
        lastWrittenCommand = line.slice(4);
        lastWriteAt = performance.now();
      }
      return true;
    });
    writeTail = task.catch(() => false);
    return task;
  }

  async function transact(line, predicate, options = {}) {
    const connectionToken = options.connectionToken ?? connectionGeneration;
    const waiter = waitForLine(predicate, {
      connectionToken,
      operationToken: options.operationToken ?? null,
      timeoutMs: options.timeoutMs ?? ACK_TIMEOUT_MS,
      label: options.label || `confirmação de ${line}`,
    });
    try {
      const sent = await enqueueLine(line, options);
      if (!sent) throw cancelled(`Envio de ${line} cancelado.`);
      return await waiter.promise;
    } catch (error) {
      waiter.cancel(error);
      throw error;
    }
  }

  function resolveLineWaiters(line) {
    if (line.startsWith("ERRO:")) {
      const error = new Error(line.replaceAll("_", " "));
      for (const waiter of [...lineWaiters]) waiter.reject(error);
      return;
    }
    for (const waiter of [...lineWaiters]) waiter.accept(line);
  }

  function telemetryValues(line) {
    const values = {};
    for (const part of line.split("|").slice(1)) {
      const separator = part.indexOf(":");
      if (separator > 0) values[part.slice(0, separator)] = part.slice(separator + 1);
    }
    return values;
  }

  function failClosed(message) {
    if (splitBrainHandling || !transportOpen) return;
    splitBrainHandling = true;
    ++operationGeneration;
    ++modeGeneration;
    lastIntent = "PARAR";
    lastFreshInputAt = 0;
    pendingMotion = null;
    setEmergencyUi(true, "FALHA DE SINCRONIZAÇÃO · ESTOP", "fault");
    setConnection("FALHA DE SINCRONIZAÇÃO", "ERROR", message);
    reportError(message);
    enqueueLine("ESTOP", { connectionToken: connectionGeneration }).catch(() => {});
  }

  function parseTelemetry(line) {
    if (!line) return;
    markRx(line);
    resolveLineWaiters(line);

    if (line.startsWith("QT:READY:")) {
      if (stateStatus) stateStatus.textContent = line === REQUIRED_FIRMWARE_READY ? "FIRMWARE V5 PRONTO" : "FIRMWARE INCOMPATÍVEL";
      return;
    }
    if (line.startsWith("ALERTA:")) {
      const alert = line.slice(7).replaceAll("_", " ");
      setEmergencyUi(true, alert, line === "ALERTA:SENSOR_BLOQUEADO" ? "sensor" : "firmware");
      log("ERROR", "SEGURANÇA", alert);
      return;
    }
    if (line.startsWith("EVENTO:")) {
      const eventName = line.slice(7).replaceAll("_", " ");
      if (line === "EVENTO:SENSOR_RECUPERADO" && emergencyOwner === "sensor") setEmergencyUi(false);
      log("INFO", "ARDUINO", eventName);
      return;
    }
    if (line.startsWith("ERRO:")) {
      reportError(line.replaceAll("_", " "));
      return;
    }
    if (!line.startsWith("QT|")) return;

    const values = telemetryValues(line);
    const firmwareMode = Number(values.MODE);
    const distance = values.DIST === "ERR" ? null : Number(values.DIST);
    const firmwareState = values.STATE?.replaceAll("_", " ") || "SEM ESTADO";
    if (Number.isInteger(firmwareMode) && firmwareMode >= 1 && firmwareMode <= 3) {
      if (modeStatus && !modeTransitioning) modeStatus.textContent = MODE_NAMES[firmwareMode];
      if (connected && !modeTransitioning && firmwareMode !== activeMode) {
        confirmedMode = firmwareMode;
        failClosed(`O site está no modo ${MODE_NAMES[activeMode]}, mas o Arduino informou ${MODE_NAMES[firmwareMode]}.`);
      } else if (!modeTransitioning) {
        confirmedMode = firmwareMode;
      }
    }
    if (distanceStatus) distanceStatus.textContent = distance === null || !Number.isFinite(distance) ? "SEM ECO" : `${distance.toFixed(1)} cm`;
    if (values.CMD && commandStatus) commandStatus.textContent = values.CMD;
    if (stateStatus) stateStatus.textContent = firmwareState;

    if (values.STATE === "ESTOP") setEmergencyUi(true, "ESTOP", emergencyOwner || "firmware");
    else if (values.STATE === "SENSOR_INIT" && stateStatus) {
      stateStatus.textContent = "AGUARDANDO PRIMEIRA LEITURA DO SENSOR";
    }
    else if (values.STATE === "SENSOR_FAIL" && !["operator", "fault", "transition"].includes(emergencyOwner)) {
      setEmergencyUi(true, "SENSOR SEM RESPOSTA · MOTORES BLOQUEADOS", "sensor");
    } else if (emergencyActive && ["firmware", "sensor"].includes(emergencyOwner) && !modeTransitioning) {
      setEmergencyUi(false);
    }

    const obstacle = values.STATE === "DESVIANDO"
      ? "DESVIANDO"
      : Number.isFinite(distance)
        ? (distance <= 20 ? "DETECTADO" : "LIVRE")
        : "SEM LEITURA";
    patch("robot", {
      connected,
      status: splitBrainHandling || values.STATE === "SENSOR_FAIL" ? "ERROR" : connected ? "ONLINE" : "CONNECTING",
      command: values.CMD || "PARAR",
      firmwareState,
      distance,
    }, { source: "arduino-telemetry" });
    patch("safety", {
      emergency: emergencyActive || values.STATE === "ESTOP",
      status: values.STATE === "SENSOR_FAIL" ? "SENSOR_FAIL" : emergencyActive || values.STATE === "ESTOP" ? "EMERGENCY" : "MONITORING",
      obstacle,
    }, { source: "arduino-telemetry" });
  }

  function consumeSerialChunk(value, decoder) {
    let text = decoder.decode(value, { stream: true });
    if (discardingReadLine) {
      const newline = text.indexOf("\n");
      if (newline < 0) return;
      text = text.slice(newline + 1);
      discardingReadLine = false;
    }

    const lines = (readBuffer + text).split(/\r?\n/);
    readBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.length > MAX_READ_BUFFER) {
        reportError("Uma resposta serial longa foi descartada integralmente.");
        continue;
      }
      parseTelemetry(line.trim());
    }
    if (readBuffer.length > MAX_READ_BUFFER) {
      readBuffer = "";
      discardingReadLine = true;
      reportError("Uma resposta serial longa foi descartada até o próximo fim de linha.");
    }
  }

  async function readLoop(connectionToken) {
    const decoder = new TextDecoder();
    let recoverableErrors = 0;
    try {
      while (transportOpen && !closing && connectionToken === connectionGeneration) {
        if (!port?.readable) throw new Error("A leitura USB deixou de estar disponível.");
        const currentReader = port.readable.getReader();
        reader = currentReader;
        try {
          while (transportOpen && !closing && connectionToken === connectionGeneration) {
            const { value, done } = await currentReader.read();
            if (done) {
              if (!closing && transportOpen) throw new Error("A leitura serial foi encerrada inesperadamente.");
              break;
            }
            if (!value) continue;
            recoverableErrors = 0;
            consumeSerialChunk(value, decoder);
          }
        } catch (error) {
          if (closing || !transportOpen || connectionToken !== connectionGeneration) break;
          if (!port?.readable || recoverableErrors >= MAX_RECOVERABLE_READ_ERRORS) throw error;
          recoverableErrors += 1;
          log("WARNING", "ARDUINO", `Falha transitória na leitura USB; recuperação ${recoverableErrors}/${MAX_RECOVERABLE_READ_ERRORS}`);
        } finally {
          try { currentReader.releaseLock(); } catch { /* trava já liberada */ }
          if (reader === currentReader) reader = null;
        }
      }
    } catch (error) {
      if (!closing && connectionToken === connectionGeneration) handleConnectionFailure(error);
    }
  }

  async function initializeFirmware(connectionToken, operationToken) {
    const ready = waitForLine((line) => line.startsWith("QT:READY:"), {
      connectionToken,
      timeoutMs: READY_TIMEOUT_MS,
      label: "QT:READY do firmware",
    });
    readTask = readLoop(connectionToken);
    // O UNO normalmente reinicia ao abrir a porta, mas alguns cabos/clones nao
    // fazem isso. O bootloader também pode consumir a primeira mensagem; por
    // isso HELLO é repetido até o firmware se identificar ou o prazo expirar.
    const sendHello = () => {
      if (transportOpen && connectionToken === connectionGeneration) {
        enqueueLine("HELLO", { connectionToken, operationToken }).catch(() => {});
      }
    };
    sendHello();
    const helloProbeTimer = window.setInterval(sendHello, HELLO_PROBE_MS);
    let readyLine;
    try {
      readyLine = await ready.promise;
    } finally {
      window.clearInterval(helloProbeTimer);
    }
    if (readyLine !== REQUIRED_FIRMWARE_READY) throw new Error(`Firmware incompatível: recebido ${readyLine}; esperado ${REQUIRED_FIRMWARE_READY}.`);

    await transact("ESTOP", (line) => line === "OK:ESTOP", { connectionToken, operationToken, label: "ESTOP inicial" });
    setEmergencyUi(true, "INICIALIZAÇÃO SEGURA", "handshake");
    await transact("CMD:PARAR", (line) => line === "OK:CMD:PARAR", { connectionToken, operationToken });
    const desiredMode = Number(control?.state?.mode?.id) || activeMode;
    await transact(`MODE:${desiredMode}`, (line) => line === `OK:MODE:${desiredMode}`, { connectionToken, operationToken });
    confirmedMode = desiredMode;
    activeMode = desiredMode;
    setEmergencyUi(true, `${MODE_NAMES[desiredMode]} PRONTO · CONFIRME A LIBERAÇÃO`, "handshake");
  }

  function setControlsForConnection(status) {
    const online = status === "ONLINE";
    const busy = status === "CONNECTING";
    connectButton.disabled = online || busy;
    disconnectButton.disabled = !online && !busy;
    emergencyButton.disabled = !online;
    for (const button of modeButtons) button.disabled = busy;
  }

  function describeConnectionError(error) {
    const name = String(error?.name || "");
    const message = String(error?.message || "");
    const normalized = message.toLowerCase();
    if (name === "NotFoundError") {
      return { label: "SELEÇÃO CANCELADA", status: "OFFLINE", hint: "Nenhuma porta foi escolhida. Clique em conectar e selecione a porta do Arduino UNO." };
    }
    if (name === "SecurityError") {
      return { label: "PERMISSÃO USB BLOQUEADA", status: "ERROR", hint: "Libere o acesso à porta serial nas permissões do Chrome/Edge e tente novamente." };
    }
    if (["InvalidStateError", "NetworkError"].includes(name)
      || /access denied|acesso negado|in use|ocupad|could not open|failed to open/.test(normalized)) {
      return { label: "PORTA USB OCUPADA", status: "ERROR", hint: "Feche o Monitor Serial e o Arduino IDE, retire e recoloque o cabo USB e tente novamente." };
    }
    if (/qt:ready|firmware incompatível|firmware incompativel|aguardando qt:ready/.test(normalized)) {
      return { label: "FIRMWARE NÃO RESPONDE", status: "ERROR", hint: "Grave novamente o Código principal no UNO, feche o Arduino IDE e reconecte pelo site." };
    }
    return { label: "CONEXÃO USB FALHOU", status: "ERROR", hint: message || "Não foi possível abrir ou validar o Arduino UNO." };
  }

  async function connectRobot() {
    if (transportOpen || closing) return false;
    if (window.location?.protocol === "file:") {
      setConnection("ABRA O SITE HTTPS", "ERROR", "O controle físico foi bloqueado. Use https://jgouveaf.github.io/FECART/.");
      reportError("Web Serial bloqueado em página aberta diretamente pelo disco.");
      return false;
    }
    if (!window.isSecureContext || !("serial" in navigator)) {
      setConnection("NAVEGADOR INCOMPATÍVEL", "ERROR", "Abra o site no Chrome ou Edge para computador usando HTTPS.");
      reportError("Web Serial não está disponível neste navegador.");
      return false;
    }

    const connectionToken = ++connectionGeneration;
    const operationToken = ++operationGeneration;
    rejectSupersededOperationWaiters(operationToken);
    splitBrainHandling = false;
    connected = false;
    confirmedMode = null;
    setControlsForConnection("CONNECTING");
    setConnection("SELECIONE A PORTA", "CONNECTING", "Escolha Arduino UNO ou a porta USB correspondente.");
    log("INFO", "ARDUINO", "Seleção da porta USB solicitada");

    try {
      // A escolha é sempre explícita. Reutilizar automaticamente uma porta
      // autorizada no passado pode selecionar uma COM antiga ou outro USB.
      port = await navigator.serial.requestPort();
      if (connectionToken !== connectionGeneration) throw cancelled();
      await port.open({ baudRate: 9600, bufferSize: 1024 });
      if (connectionToken !== connectionGeneration) throw cancelled();
      writer = port.writable.getWriter();
      transportOpen = true;
      closing = false;
      readBuffer = "";
      discardingReadLine = false;
      writeTail = Promise.resolve();
      setConnection("AGUARDANDO FIRMWARE", "CONNECTING", "Validando QT:READY e colocando os motores em estado seguro.");
      await initializeFirmware(connectionToken, operationToken);
      if (connectionToken !== connectionGeneration || operationToken !== operationGeneration) throw cancelled();

      connected = true;
      lastSerialRxAt = performance.now();
      modeActivatedAt = performance.now();
      ++modeGeneration;
      lastIntent = "PARAR";
      lastFreshInputAt = 0;
      lastWrittenCommand = "";
      lastAcknowledgedCommand = "PARAR";
      consecutiveMotionFailures = 0;
      pendingMotion = null;
      setControlsForConnection("ONLINE");
      setConnection("CONECTADO · BLOQUEADO", "ONLINE", `Firmware V5 confirmado em ${MODE_NAMES[activeMode]}. Confira as rodas e clique em “Liberar após conferir”.`);
      renderMode(activeMode);
      updateDeliveryHint();
      log("WARNING", "SEGURANÇA", `Arduino sincronizado em ${MODE_NAMES[activeMode]} e mantido em ESTOP até liberação explícita`);
      return true;
    } catch (error) {
      if (error?.name !== "AbortError") {
        const description = describeConnectionError(error);
        setConnection(description.label, description.status, description.hint);
        if (description.status === "ERROR") reportError(description.hint, error);
      }
      await closePort({ sendEstop: transportOpen, reason: "CONNECT_FAILED", preserveStatus: true });
      return false;
    }
  }

  async function prepareModeDependencies(modeId, operationToken) {
    if (operationToken !== operationGeneration) throw cancelled();
    if (modeId === 2) {
      await window.quantumGestureController?.selectView?.("face");
      if (window.quantumCameraController && !window.quantumCameraController.active) await window.quantumCameraController.start();
    } else if (modeId === 3) {
      await window.quantumGestureController?.selectView?.("hand");
      if (window.quantumGestureController?.enable) await window.quantumGestureController.enable();
      else if (window.quantumCameraController && !window.quantumCameraController.active) await window.quantumCameraController.start();
    }
    if (operationToken !== operationGeneration) throw cancelled();
  }

  async function executeModeTransition(detail) {
    const nextMode = Number(detail?.next?.id);
    const previousMode = Number(detail?.previous?.id) || activeMode;
    if (!MODE_NAMES[nextMode]) return;
    const operationToken = ++operationGeneration;
    rejectSupersededOperationWaiters(operationToken);
    const connectionToken = connectionGeneration;
    const transitionModeToken = ++modeGeneration;
    modeTransitioning = true;
    lastIntent = "PARAR";
    lastFreshInputAt = 0;
    renderMode(previousMode, nextMode);
    updateDeliveryHint();

    try {
      const preserveEmergency = connected && emergencyActive;
      const preservedEmergencyOwner = emergencyOwner;
      if (connected) {
        if (emergencyActive && ["fault", "sensor", "firmware"].includes(emergencyOwner)) {
          throw new Error("Resolva a falha de segurança antes de trocar o modo.");
        }
        if (!preserveEmergency) {
          await transact("ESTOP", (line) => line === "OK:ESTOP", { connectionToken, operationToken, label: "parada para troca de modo" });
          setEmergencyUi(true, "TROCA DE MODO · MOTORES BLOQUEADOS", "transition");
        }
        await transact("CMD:PARAR", (line) => line === "OK:CMD:PARAR", { connectionToken, operationToken });
      }

      await prepareModeDependencies(nextMode, operationToken);
      if (connected) {
        await transact(`MODE:${nextMode}`, (line) => line === `OK:MODE:${nextMode}`, { connectionToken, operationToken });
        confirmedMode = nextMode;
        if (preserveEmergency) {
          setEmergencyUi(true, `${MODE_NAMES[nextMode]} PRONTO · CONFIRME A LIBERAÇÃO`, preservedEmergencyOwner || "operator");
        } else {
          await transact("RESET_ESTOP", (line) => line === "OK:RESET_ESTOP", { connectionToken, operationToken });
          setEmergencyUi(false);
        }
      }
      if (operationToken !== operationGeneration || transitionModeToken !== modeGeneration) throw cancelled();

      activeMode = nextMode;
      modeActivatedAt = performance.now();
      lastIntent = nextMode === 1 ? "FRENTE" : "PARAR";
      lastFreshInputAt = 0;
      modeTransitioning = false;
      control?.commitMode?.(nextMode, detail?.source || "robot-serial");
      renderMode(activeMode);
      updateDeliveryHint();
      log("INFO", "ARDUINO", connected ? `Modo ${MODE_NAMES[nextMode]} confirmado pelo firmware` : `Modo ${MODE_NAMES[nextMode]} preparado para a próxima conexão`);
    } catch (error) {
      if (operationToken !== operationGeneration) return;
      modeTransitioning = false;
      activeMode = previousMode;
      lastIntent = "PARAR";
      lastFreshInputAt = 0;
      control?.rejectMode?.(error, detail?.source || "robot-serial");
      renderMode(activeMode);
      updateDeliveryHint();
      if (connected) {
        setEmergencyUi(true, "TROCA DE MODO FALHOU · ESTOP", "fault");
        enqueueLine("ESTOP", { connectionToken }).catch(() => {});
      }
      reportError(`Não foi possível ativar ${MODE_NAMES[nextMode]}`, error);
    }
  }

  function requestMode(modeId, source = "ui") {
    const nextMode = Number(modeId);
    if (!MODE_NAMES[nextMode]) return false;
    if (control?.requestMode) return Boolean(control.requestMode(nextMode, source));
    const previous = { id: activeMode, label: MODE_NAMES[activeMode] };
    executeModeTransition({ previous, next: { id: nextMode, label: MODE_NAMES[nextMode] }, source });
    return true;
  }

  function eventIsFresh(detail) {
    if (detail?.modeGeneration != null && Number(detail.modeGeneration) !== modeGeneration) return false;
    const stamp = Number(detail?.emittedAt ?? detail?.timestamp ?? detail?.detectedAt);
    if (!Number.isFinite(stamp)) return true;
    const now = stamp > 1e12 ? Date.now() : performance.now();
    const activation = stamp > 1e12 ? Date.now() - (performance.now() - modeActivatedAt) : modeActivatedAt;
    const age = now - stamp;
    return age >= -1000 && age <= MAX_EVENT_AGE_MS && stamp >= activation;
  }

  function mayAcceptInput(expectedMode, detail) {
    const centralMode = control?.state?.mode;
    return connected
      && !modeTransitioning
      && !emergencyActive
      && activeMode === expectedMode
      && confirmedMode === expectedMode
      && (!centralMode || (centralMode.phase === "ACTIVE" && Number(centralMode.id) === expectedMode))
      && eventIsFresh(detail);
  }

  function sendMotion(command, options = {}) {
    if (!VALID_COMMANDS.has(command) || !connected || emergencyActive || modeTransitioning) return Promise.resolve(false);
    const modeToken = options.modeToken ?? modeGeneration;
    if (motionAckInFlight) {
      pendingMotion = { command, modeToken, createdAt: performance.now() };
      return Promise.resolve(false);
    }
    const connectionToken = connectionGeneration;
    const operationToken = operationGeneration;
    motionAckInFlight = true;
    // Telemetria pode representar um movimento anterior. Somente a resposta
    // explicita do firmware confirma que este CMD acabou de ser recebido.
    return transact(`CMD:${command}`, (line) => line === `OK:CMD:${command}`, {
      connectionToken,
      operationToken,
      modeToken,
      maxAgeMs: MAX_QUEUED_MOTION_AGE_MS,
      label: `ACK do comando ${command}`,
    }).then(() => {
      if (connectionToken !== connectionGeneration || modeToken !== modeGeneration) return false;
      consecutiveMotionFailures = 0;
      lastAcknowledgedCommand = command;
      if (commandStatus) commandStatus.textContent = command;
      if (activeMode === 3) updateDeliveryHint();
      return true;
    }).catch((error) => {
      if (error?.name === "AbortError") return false;
      consecutiveMotionFailures += 1;
      reportError(`Arduino não confirmou CMD:${command} (${consecutiveMotionFailures}/2)`, error);
      if (consecutiveMotionFailures >= 2) failClosed("Dois comandos de movimento ficaram sem confirmação do Arduino.");
      return false;
    }).finally(() => {
      motionAckInFlight = false;
      const queued = pendingMotion;
      pendingMotion = null;
      if (queued && performance.now() - queued.createdAt <= MAX_QUEUED_MOTION_AGE_MS) {
        sendMotion(queued.command, { modeToken: queued.modeToken });
      }
    });
  }

  function acceptIntent(command, source, options = {}) {
    if (!VALID_COMMANDS.has(command) || !connected || emergencyActive || modeTransitioning) return false;
    if (options.fresh !== false) lastFreshInputAt = performance.now();
    lastIntent = command;
    const changed = command !== lastWrittenCommand;
    const due = performance.now() - lastWriteAt >= COMMAND_HEARTBEAT_MS;
    if (command === "PARAR" || changed || due) sendMotion(command);
    if (source === "gesture") updateDeliveryHint();
    return true;
  }

  function watchdogTick() {
    if (!connected || emergencyActive || modeTransitioning) return;
    if (lastSerialRxAt > 0 && performance.now() - lastSerialRxAt > SERIAL_SILENCE_TIMEOUT_MS) {
      failClosed("O Arduino deixou de responder pela USB; motores bloqueados por segurança.");
      return;
    }
    if (activeMode === 1) {
      // O modo autônomo também depende de uma concessão viva do site. O UNO
      // para em até 1,5 s se a página travar, o cabo cair ou o navegador fechar.
      lastIntent = "FRENTE";
      sendMotion("FRENTE");
      return;
    }
    const hasFreshInput = lastFreshInputAt > 0 && performance.now() - lastFreshInputAt <= INPUT_TIMEOUT_MS;
    if (!hasFreshInput) {
      lastIntent = "PARAR";
      sendMotion("PARAR");
      return;
    }
    sendMotion(lastIntent);
  }

  async function toggleEmergency() {
    if (!connected || modeTransitioning) return;
    const operationToken = ++operationGeneration;
    rejectSupersededOperationWaiters(operationToken);
    const connectionToken = connectionGeneration;
    ++modeGeneration;
    lastIntent = "PARAR";
    lastFreshInputAt = 0;
    emergencyButton.disabled = true;
    try {
      if (splitBrainHandling) throw new Error("Modo dessincronizado. Desconecte e conecte novamente antes de liberar o robô.");
      if (!emergencyActive) {
        await transact("ESTOP", (line) => line === "OK:ESTOP", { connectionToken, operationToken });
        setEmergencyUi(true, "ESTOP", "operator");
        if (commandStatus) commandStatus.textContent = "PARAR";
        log("WARNING", "SEGURANÇA", "Parada de emergência confirmada pelo Arduino");
      } else if (window.confirm("As rodas estão livres e é seguro liberar a parada de emergência?")) {
        await transact("RESET_ESTOP", (line) => line === "OK:RESET_ESTOP", { connectionToken, operationToken });
        setEmergencyUi(false, MODE_NAMES[activeMode]);
        lastIntent = activeMode === 1 ? "FRENTE" : "PARAR";
        consecutiveMotionFailures = 0;
        setConnection("CONECTADO", "ONLINE", `${MODE_NAMES[activeMode]} liberado pelo operador. O HC-SR04 continua soberano.`);
        log("WARNING", "SEGURANÇA", "Parada de emergência liberada explicitamente pelo operador");
      }
    } catch (error) {
      setEmergencyUi(true, "ESTOP SEM CONFIRMAÇÃO", "fault");
      reportError("O Arduino não confirmou a operação de emergência", error);
    } finally {
      emergencyButton.disabled = !connected;
    }
  }

  async function closePort(options = {}) {
    if (closePromise) return closePromise;
    const sendEstop = options.sendEstop !== false;
    const preserveStatus = options.preserveStatus === true;
    const reason = options.reason || "USER";
    const connectionToken = connectionGeneration;
    closePromise = (async () => {
      closing = true;
      connected = false;
      const closeOperationToken = ++operationGeneration;
      rejectSupersededOperationWaiters(closeOperationToken);
      ++modeGeneration;
      modeTransitioning = false;
      lastIntent = "PARAR";
      lastFreshInputAt = 0;
      pendingMotion = null;
      motionAckInFlight = false;
      consecutiveMotionFailures = 0;
      lastAcknowledgedCommand = "PARAR";
      if (control?.pendingMode) control.rejectMode?.(new Error("Transição cancelada porque a conexão serial foi encerrada."), "robot-disconnect");

      if (sendEstop && transportOpen && writer) {
        try {
          await Promise.race([
            enqueueLine("ESTOP", { connectionToken }),
            delay(600).then(() => { throw new Error("Tempo de segurança esgotado."); }),
          ]);
        } catch (error) {
          console.warn("Não foi possível confirmar ESTOP antes de fechar a porta", error);
        }
      }

      transportOpen = false;
      ++connectionGeneration;
      rejectWaiters(cancelled("Conexão serial encerrada."), connectionToken);
      try { await reader?.cancel(); } catch { /* leitura já encerrada */ }
      try { await Promise.race([readTask || Promise.resolve(), delay(300)]); } catch { /* encerramento em andamento */ }
      try { writer?.releaseLock(); } catch { /* escrita ainda encerrando */ }
      writer = null;
      try { await port?.close(); } catch { /* porta removida */ }
      port = null;
      reader = null;
      readTask = null;
      readBuffer = "";
      discardingReadLine = false;
      lastSerialRxAt = 0;
      writeTail = Promise.resolve();
      confirmedMode = null;
      splitBrainHandling = false;
      setControlsForConnection("OFFLINE");
      if (!preserveStatus) setConnection("DESCONECTADO", "OFFLINE", "Feche o Arduino IDE e o Monitor Serial, conecte o cabo USB e use Chrome ou Edge.");
      if (stateStatus) stateStatus.textContent = "SEM TELEMETRIA";
      if (distanceStatus) distanceStatus.textContent = "—";
      if (commandStatus) commandStatus.textContent = "PARAR";
      patch("robot", {
        connected: false,
        ...(!preserveStatus && { status: "OFFLINE" }),
        ...(!preserveStatus && { statusLabel: "DESCONECTADO" }),
        command: "PARAR",
        firmwareState: "SEM TELEMETRIA",
        distance: null,
      }, { source: "robot-disconnect", reason });
      if (!preserveStatus) patch("communication", { status: "OFFLINE" }, { source: "robot-disconnect", reason });
      updateDeliveryHint();
      log("INFO", "ARDUINO", `Conexão encerrada (${reason})`);
      closing = false;
    })().finally(() => { closePromise = null; });
    return closePromise;
  }

  function handleConnectionFailure(error) {
    if (closing) return;
    console.warn("Conexão serial encerrada", error);
    setConnection("CONEXÃO PERDIDA", "ERROR", "O cabo foi removido ou a porta deixou de responder.");
    reportError("Conexão com o Arduino perdida", error);
    closePort({ sendEstop: false, reason: "CONNECTION_LOST", preserveStatus: true });
  }

  window.addEventListener("quantum:mode-will-change", (event) => {
    const detail = event.detail;
    queueMicrotask(() => executeModeTransition(detail));
  });

  window.addEventListener("quantum:gesture-command", (event) => {
    const detail = event.detail || {};
    const command = detail.command || "PARAR";
    if (!mayAcceptInput(3, detail)) return;
    if (command !== "PARAR" && detail.stable !== true) return;
    if (command !== "PARAR" && Number.isFinite(Number(detail.confidence)) && Number(detail.confidence) < 0.60) return;
    acceptIntent(command, "gesture", { fresh: true });
  });

  window.addEventListener("quantum:person-tracking", (event) => {
    const detail = event.detail || {};
    if (!mayAcceptInput(2, detail)) return;
    if (detail.visible && Number.isFinite(Number(detail.confidence)) && Number(detail.confidence) < 0.45) return;
    acceptIntent(detail.visible ? detail.command : "PARAR", "face", { fresh: true });
  });

  const heartbeatTimer = window.setInterval(watchdogTick, COMMAND_HEARTBEAT_MS);
  for (const [index, button] of modeButtons.entries()) {
    button.addEventListener("click", () => requestMode(button.dataset.robotMode, "ui"));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = modeButtons.length - 1;
      else nextIndex = (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + modeButtons.length) % modeButtons.length;
      const next = modeButtons[nextIndex];
      next.focus();
      requestMode(next.dataset.robotMode, "keyboard");
    });
  }
  connectButton.addEventListener("click", () => { connectRobot(); });
  disconnectButton.addEventListener("click", () => { closePort({ sendEstop: true, reason: "USER" }); });
  emergencyButton.addEventListener("click", () => { toggleEmergency(); });
  navigator.serial?.addEventListener?.("disconnect", (event) => {
    if (event.port === port || event.target === port) handleConnectionFailure(new Error("Arduino desconectado."));
  });
  navigator.serial?.addEventListener?.("connect", () => {
    if (!connected && !transportOpen && connectionHint) {
      connectionHint.textContent = "Dispositivo USB detectado. Clique em Conectar Arduino USB e selecione a porta.";
    }
  });
  window.addEventListener("pagehide", () => {
    ++operationGeneration;
    ++modeGeneration;
    lastIntent = "PARAR";
    lastFreshInputAt = 0;
    if (transportOpen && writer) writer.write(new TextEncoder().encode("ESTOP\n")).catch(() => {});
    window.clearInterval(heartbeatTimer);
  });

  renderMode(activeMode);
  setControlsForConnection("OFFLINE");
  setConnection("DESCONECTADO", "OFFLINE", "Feche o Arduino IDE e o Monitor Serial, conecte o cabo USB e use Chrome ou Edge.");
  updateDeliveryHint();
  log("INFO", "ARDUINO", "Controlador Web Serial pronto · aguardando conexão explícita");

  const publicApi = {
    connect: connectRobot,
    disconnect: () => closePort({ sendEstop: true, reason: "API" }),
    requestMode,
    emergencyStop: toggleEmergency,
    send(command) { return acceptIntent(String(command || "").toUpperCase(), "api", { fresh: true }); },
    get connected() { return connected; },
    get mode() { return activeMode; },
    get confirmedMode() { return confirmedMode; },
    get connectionGeneration() { return connectionGeneration; },
    get modeGeneration() { return modeGeneration; },
  };
  if (window.__QUANTUM_ROBOT_TEST__) {
    publicApi._test = Object.freeze({
      watchdogTick,
      parseTelemetry,
      describeConnectionError,
      eventIsFresh,
      get lastFreshInputAt() { return lastFreshInputAt; },
      get lastSerialRxAt() { return lastSerialRxAt; },
    });
  }
  window.quantumRobot = Object.freeze(publicApi);
})();
