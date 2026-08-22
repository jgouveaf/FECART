(() => {
  "use strict";

  const MODES = Object.freeze({
    1: Object.freeze({ id: 1, key: "AUTONOMOUS", label: "AUTÔNOMO" }),
    2: Object.freeze({ id: 2, key: "PERSON_FOLLOW", label: "SEGUIR PESSOA" }),
    3: Object.freeze({ id: 3, key: "GESTURE_CONTROL", label: "GESTOS" }),
  });
  const MAX_LOGS = 120;
  const listeners = new Set();
  let logSequence = 0;
  let renderQueued = false;
  let logsDirty = true;
  let pendingMode = null;

  const state = {
    mode: { ...MODES[1], phase: "ACTIVE", requestedId: null, changedAt: Date.now() },
    robot: { connected: false, status: "OFFLINE", command: "PARAR", firmwareState: "SEM TELEMETRIA", distance: null },
    camera: { active: false, status: "OFFLINE", deviceId: null, deviceLabel: "—", width: null, height: null, fps: 0, error: null },
    gestures: { enabled: false, active: false, status: "OFFLINE", model: "NOT_LOADED", gesture: null, confidence: 0, command: "PARAR", fps: 0 },
    vision: { active: false, status: "OFFLINE", targetId: null, confidence: 0, tracking: "SEARCHING", direction: "PARAR", fps: 0 },
    communication: { status: "OFFLINE", lastTx: "—", lastRx: "—", updatedAt: null },
    safety: { status: "MONITORING", emergency: false, obstacle: "UNKNOWN", lastEvent: "Inicialização" },
    diagnostics: { lastError: "Nenhum", updatedAt: Date.now() },
    logs: [],
  };

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  function statusClass(status) {
    const value = String(status || "").toUpperCase();
    if (["ONLINE", "ACTIVE", "READY", "FOLLOWING", "TARGET_ACQUIRED", "MONITORING"].includes(value)) return "online";
    if (["CONNECTING", "STARTING", "LOADING", "REACQUIRING", "WARNING"].includes(value)) return "warning";
    if (["ERROR", "FAILED", "NO_PERMISSION", "EMERGENCY", "ESTOP", "SENSOR_FAIL"].includes(value)) return "error";
    return "offline";
  }

  function setIndicator(element, value) {
    if (!element) return;
    element.textContent = value;
    const parent = element.closest(".system-indicator");
    if (parent) parent.dataset.status = statusClass(value);
  }

  function renderLogs() {
    if (!logsDirty) return;
    logsDirty = false;
    const container = document.getElementById("eventLog");
    const count = document.getElementById("eventLogCount");
    if (!container) return;
    const fragment = document.createDocumentFragment();
    for (const entry of state.logs.slice(-80).reverse()) {
      const row = document.createElement("li");
      row.className = `event-log-row ${entry.level.toLowerCase()}`;
      const time = document.createElement("time");
      time.dateTime = entry.iso;
      time.textContent = entry.time;
      const source = document.createElement("b");
      source.textContent = entry.source;
      const message = document.createElement("span");
      message.textContent = entry.message;
      row.append(time, source, message);
      fragment.append(row);
    }
    container.replaceChildren(fragment);
    if (count) count.textContent = `${state.logs.length}/${MAX_LOGS}`;
  }

  function render() {
    renderQueued = false;
    setIndicator(document.getElementById("overallRobotStatus"), state.robot.status);
    setIndicator(document.getElementById("overallCameraStatus"), state.camera.status);
    setIndicator(document.getElementById("overallVisionStatus"), state.vision.status);
    setIndicator(document.getElementById("overallGestureStatus"), state.gestures.status);
    setIndicator(document.getElementById("overallCommunicationStatus"), state.communication.status);
    const mode = document.getElementById("overallModeStatus");
    const modeLabel = state.mode.phase === "PREPARING" && pendingMode ? `${state.mode.label} → ${pendingMode.next.label}` : state.mode.label;
    if (mode) mode.textContent = modeLabel;
    const missionMode = document.getElementById("missionModeStatus");
    if (missionMode) missionMode.textContent = modeLabel;
    const target = document.getElementById("overallTargetStatus");
    if (target) target.textContent = state.vision.targetId || "NENHUM";
    const obstacle = document.getElementById("overallObstacleStatus");
    if (obstacle) obstacle.textContent = state.safety.obstacle;

    const values = {
      diagnosticCamera: state.camera.deviceLabel,
      diagnosticResolution: state.camera.width && state.camera.height ? `${state.camera.width} × ${state.camera.height}` : "—",
      diagnosticCameraFps: state.camera.fps ? `${state.camera.fps.toFixed(1)} FPS` : "—",
      diagnosticGestureModel: state.gestures.model,
      diagnosticGestureFps: state.gestures.fps ? `${state.gestures.fps.toFixed(1)} FPS` : "—",
      diagnosticArduino: state.robot.status,
      diagnosticMode: state.mode.key,
      diagnosticLastTx: state.communication.lastTx,
      diagnosticLastRx: state.communication.lastRx,
      diagnosticLastError: state.diagnostics.lastError,
    };
    for (const [id, value] of Object.entries(values)) {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    }
    renderLogs();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(render);
  }

  function notify(section, previous, meta) {
    const detail = { section, previous, current: snapshot(), meta: meta || {} };
    for (const listener of listeners) {
      try { listener(detail); } catch (error) { console.error("Falha em observador do estado", error); }
    }
    window.dispatchEvent(new CustomEvent("quantum:state-changed", { detail }));
    scheduleRender();
  }

  function patch(section, values, meta = {}) {
    if (!Object.prototype.hasOwnProperty.call(state, section) || section === "logs" || section === "mode") {
      throw new Error(`Seção de estado inválida: ${section}`);
    }
    const previous = { ...state[section] };
    Object.assign(state[section], values, { updatedAt: Date.now() });
    if (section === "diagnostics" && values.lastError) state.diagnostics.lastError = String(values.lastError).slice(0, 240);
    notify(section, previous, meta);
    return { ...state[section] };
  }

  function requestMode(modeId, source = "ui") {
    const next = MODES[Number(modeId)];
    if (!next) throw new Error(`Modo inválido: ${modeId}`);
    if (state.mode.id === next.id && state.mode.phase === "ACTIVE") return null;
    if (pendingMode?.next.id === next.id) return { ...pendingMode, previous: { ...pendingMode.previous }, next: { ...pendingMode.next } };
    const previous = pendingMode?.previous ? { ...pendingMode.previous } : { ...state.mode };
    window.dispatchEvent(new CustomEvent("quantum:mode-will-change", { detail: { previous, next, source } }));
    pendingMode = { previous, next, source };
    state.mode = { ...previous, phase: "PREPARING", requestedId: next.id, changedAt: Date.now() };
    notify("mode", previous, { source });
    log("INFO", "MODO", `Preparando ${next.label}`);
    return { ...pendingMode };
  }

  function commitMode(modeId = pendingMode?.next.id, source = pendingMode?.source || "system") {
    const next = MODES[Number(modeId)];
    if (!next) throw new Error(`Modo inválido: ${modeId}`);
    const previous = pendingMode?.previous || { ...state.mode };
    state.mode = { ...next, phase: "ACTIVE", requestedId: null, changedAt: Date.now() };
    pendingMode = null;
    notify("mode", previous, { source });
    window.dispatchEvent(new CustomEvent("quantum:mode-changed", { detail: { previous, current: { ...state.mode }, source } }));
    log("INFO", "MODO", `${previous.label} → ${state.mode.label}`);
    return { ...state.mode };
  }

  function rejectMode(error, source = pendingMode?.source || "system") {
    const message = error?.message || String(error || "Transição cancelada");
    const failed = pendingMode?.next || null;
    const previous = pendingMode?.previous || { ...state.mode };
    state.mode = { ...previous, phase: "ACTIVE", requestedId: null, changedAt: Date.now() };
    pendingMode = null;
    notify("mode", previous, { source, failed, error: message });
    log("ERROR", "MODO", `${failed?.label || "Modo"} não foi ativado: ${message}`);
    return { ...state.mode };
  }

  function setMode(modeId, source = "ui") {
    const requested = requestMode(modeId, source);
    if (!requested) return { ...state.mode };
    return commitMode(modeId, source);
  }

  function log(level, source, message, details = null) {
    const now = new Date();
    const entry = {
      id: ++logSequence,
      level: String(level || "INFO").toUpperCase(),
      source: String(source || "SISTEMA").toUpperCase().slice(0, 18),
      message: String(message || "").slice(0, 220),
      details,
      iso: now.toISOString(),
      time: now.toLocaleTimeString("pt-BR", { hour12: false }),
    };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
    logsDirty = true;
    state.safety.lastEvent = entry.message;
    scheduleRender();
    window.dispatchEvent(new CustomEvent("quantum:log", { detail: entry }));
    return entry;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function clearLogs() {
    state.logs.length = 0;
    logSequence = 0;
    logsDirty = true;
    log("INFO", "SISTEMA", "Histórico de eventos limpo");
  }

  window.addEventListener("error", (event) => {
    const message = event.error?.message || event.message || "Erro JavaScript";
    state.diagnostics.lastError = String(message).slice(0, 240);
    log("ERROR", "NAVEGADOR", message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const message = event.reason?.message || String(event.reason || "Promise rejeitada");
    state.diagnostics.lastError = String(message).slice(0, 240);
    log("ERROR", "NAVEGADOR", message);
  });

  window.QuantumControl = Object.freeze({
    MODES,
    MAX_LOGS,
    snapshot,
    patch,
    requestMode,
    commitMode,
    rejectMode,
    setMode,
    log,
    subscribe,
    clearLogs,
    render,
    get state() { return snapshot(); },
    get pendingMode() { return pendingMode ? { ...pendingMode, previous: { ...pendingMode.previous }, next: { ...pendingMode.next } } : null; },
  });
  document.getElementById("clearEventLog")?.addEventListener("click", clearLogs);
  log("INFO", "SISTEMA", "Painel de controle inicializado");
  render();
})();
