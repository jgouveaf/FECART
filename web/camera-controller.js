(() => {
  "use strict";

  const control = window.QuantumControl;
  const video = document.getElementById("cameraVideo");
  const stage = document.getElementById("cameraStage");
  const startButton = document.getElementById("startCamera");
  const stopButton = document.getElementById("stopCamera");
  const statusElement = document.getElementById("cameraStatus");
  const statusDot = document.getElementById("cameraDot");
  const placeholderTitle = document.getElementById("cameraPlaceholderTitle");
  const placeholderHint = document.getElementById("cameraPlaceholderHint");
  const deviceSelect = document.getElementById("cameraDeviceSelect");
  const fpsBadge = document.getElementById("cameraFpsBadge");

  const PHASE = Object.freeze({ OFF: "OFF", STARTING: "STARTING", ACTIVE: "ACTIVE", STOPPING: "STOPPING", ERROR: "ERROR" });
  const VIDEO_CONSTRAINTS = Object.freeze({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } });
  const PERMISSION_TIMEOUT_MS = 15000;
  let phase = PHASE.OFF;
  let stream = null;
  let operation = 0;
  let pendingStart = null;
  let selectedDeviceId = "";
  let frameCallbackId = 0;
  let frameCount = 0;
  let fpsWindowStarted = 0;
  let trackEndedHandler = null;

  function setStatus(text, kind = "offline") {
    statusElement.textContent = text;
    statusElement.dataset.status = kind;
    statusDot.className = `status-dot ${kind === "online" ? "" : kind}`.trim();
    stage.dataset.cameraState = phase;
  }

  function setPlaceholder(title, hint) {
    placeholderTitle.textContent = title;
    placeholderHint.textContent = hint;
  }

  function errorMessage(error) {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      return "Permissão de câmera negada. Clique no cadeado da barra de endereço, permita a câmera e tente novamente.";
    }
    if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
      return "Câmera não encontrada. Conecte ou habilite uma webcam e tente novamente.";
    }
    if (["NotReadableError", "TrackStartError", "AbortError"].includes(error?.name)) {
      return "A câmera está ocupada ou bloqueada pelo sistema. Feche outros aplicativos que usam vídeo e tente novamente.";
    }
    if (["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(error?.name)) {
      return "A câmera não aceitou a resolução solicitada.";
    }
    return error?.message || "Erro desconhecido ao iniciar a câmera.";
  }

  function setBusy(busy, label) {
    startButton.disabled = busy || phase === PHASE.ACTIVE;
    stopButton.disabled = phase === PHASE.OFF || phase === PHASE.ERROR || phase === PHASE.STOPPING;
    startButton.setAttribute("aria-busy", String(busy));
    if (label) startButton.textContent = label;
    if (deviceSelect) deviceSelect.disabled = busy;
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
      if (deviceSelect) {
        const previous = selectedDeviceId || deviceSelect.value;
        const fragment = document.createDocumentFragment();
        devices.forEach((device, index) => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent = device.label || `Câmera ${index + 1}`;
          fragment.append(option);
        });
        deviceSelect.replaceChildren(fragment);
        if (devices.some((device) => device.deviceId === previous)) deviceSelect.value = previous;
        selectedDeviceId = deviceSelect.value || devices[0]?.deviceId || "";
        deviceSelect.disabled = phase === PHASE.STARTING || phase === PHASE.STOPPING || devices.length < 2;
      }
      return devices;
    } catch (error) {
      control?.log("WARNING", "CÂMERA", `Não foi possível listar dispositivos: ${error.message}`);
      return [];
    }
  }

  function acquireWithTimeout(constraints, token) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const timeout = window.setTimeout(() => {
        finished = true;
        const error = new Error("A permissão da câmera não foi respondida em 15 segundos. Verifique a janela de permissão e tente novamente.");
        error.name = "TimeoutError";
        reject(error);
      }, PERMISSION_TIMEOUT_MS);
      navigator.mediaDevices.getUserMedia(constraints).then((lateStream) => {
        window.clearTimeout(timeout);
        if (finished) {
          lateStream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (token !== operation) {
          finished = true;
          lateStream.getTracks().forEach((track) => track.stop());
          reject(new DOMException("Inicialização cancelada", "AbortError"));
          return;
        }
        finished = true;
        resolve(lateStream);
      }, (error) => {
        window.clearTimeout(timeout);
        if (finished) return;
        finished = true;
        reject(error);
      });
    });
  }

  async function requestStream(deviceId, token) {
    const preferred = {
      ...VIDEO_CONSTRAINTS,
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
    };
    try {
      return await acquireWithTimeout({ audio: false, video: preferred }, token);
    } catch (error) {
      if (!["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(error?.name)) throw error;
      control?.log("WARNING", "CÂMERA", "Resolução preferida indisponível; tentando modo compatível");
      return acquireWithTimeout({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : true }, token);
    }
  }

  function waitForMetadata(token) {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error("A câmera abriu, mas não entregou vídeo em 8 segundos.")), 8000);
      const finish = (error = null) => {
        window.clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
        if (token !== operation) reject(new DOMException("Inicialização cancelada", "AbortError"));
        else if (error) reject(error);
        else resolve();
      };
      const onReady = () => finish();
      const onError = () => finish(new Error("O elemento de vídeo não conseguiu reproduzir a câmera."));
      video.addEventListener("loadedmetadata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }

  function stopFpsMonitor() {
    if (frameCallbackId && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(frameCallbackId);
    frameCallbackId = 0;
    frameCount = 0;
    fpsWindowStarted = 0;
    if (fpsBadge) fpsBadge.textContent = "— FPS";
  }

  function startFpsMonitor() {
    stopFpsMonitor();
    if (typeof video.requestVideoFrameCallback !== "function") return;
    fpsWindowStarted = performance.now();
    const onFrame = (now) => {
      if (phase !== PHASE.ACTIVE) return;
      frameCount += 1;
      const elapsed = now - fpsWindowStarted;
      if (elapsed >= 1000) {
        const fps = frameCount * 1000 / elapsed;
        frameCount = 0;
        fpsWindowStarted = now;
        if (fpsBadge) fpsBadge.textContent = `${fps.toFixed(1)} FPS`;
        control?.patch("camera", { fps }, { source: "camera-fps" });
      }
      frameCallbackId = video.requestVideoFrameCallback(onFrame);
    };
    frameCallbackId = video.requestVideoFrameCallback(onFrame);
  }

  function releaseStream(target = stream) {
    if (!target) return;
    target.getTracks().forEach((track) => {
      if (trackEndedHandler) track.removeEventListener("ended", trackEndedHandler);
      try { track.stop(); } catch { /* dispositivo já removido */ }
    });
    if (target === stream) stream = null;
  }

  async function start(options = {}) {
    if (phase === PHASE.ACTIVE) return stream;
    if (phase === PHASE.STARTING && pendingStart) return pendingStart;
    const token = ++operation;
    phase = PHASE.STARTING;
    setBusy(true, "Ativando…");
    setStatus("CONNECTING…", "warning");
    setPlaceholder("Conectando à câmera", "Aguarde a permissão do navegador e a inicialização do dispositivo.");
    control?.patch("camera", { active: false, status: "CONNECTING", error: null }, { source: "camera-start" });
    control?.log("INFO", "CÂMERA", "Inicialização solicitada");

    pendingStart = (async () => {
      let candidate = null;
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          const error = new Error("Este navegador exige HTTPS e suporte a MediaDevices.");
          error.name = "SecurityError";
          throw error;
        }
        const deviceId = options.deviceId || selectedDeviceId || deviceSelect?.value || "";
        candidate = await requestStream(deviceId, token);
        if (token !== operation) throw new DOMException("Inicialização cancelada", "AbortError");
        stream = candidate;
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("O dispositivo não forneceu uma faixa de vídeo.");
        trackEndedHandler = () => {
          if (phase !== PHASE.ACTIVE) return;
          control?.log("ERROR", "CÂMERA", "A câmera foi desconectada durante o uso");
          stop("DEVICE_REMOVED").then(() => showError("A câmera foi desconectada. Reconecte o dispositivo e tente novamente."));
        };
        track?.addEventListener("ended", trackEndedHandler, { once: true });
        video.srcObject = stream;
        await waitForMetadata(token);
        await video.play();
        if (token !== operation) throw new DOMException("Inicialização cancelada", "AbortError");

        const settings = track?.getSettings?.() || {};
        selectedDeviceId = settings.deviceId || deviceId || "";
        phase = PHASE.ACTIVE;
        stage.classList.add("active");
        setBusy(false, "Câmera ativa");
        startButton.disabled = true;
        stopButton.disabled = false;
        setStatus("CAMERA ACTIVE", "online");
        setPlaceholder("Câmera desligada", "Clique em “Ativar câmera” para iniciar.");
        startFpsMonitor();
        await refreshDevices();
        const label = track?.label || deviceSelect?.selectedOptions?.[0]?.textContent || "Câmera padrão";
        control?.patch("camera", {
          active: true,
          status: "ONLINE",
          deviceId: selectedDeviceId || null,
          deviceLabel: label,
          width: settings.width || video.videoWidth || null,
          height: settings.height || video.videoHeight || null,
          error: null,
        }, { source: "camera-start" });
        control?.log("INFO", "CÂMERA", `Inicializada: ${label} · ${settings.width || video.videoWidth}×${settings.height || video.videoHeight}`);
        window.dispatchEvent(new CustomEvent("quantum:camera-started", { detail: { stream, track, settings, label } }));
        return stream;
      } catch (error) {
        if (candidate && candidate !== stream) releaseStream(candidate);
        if (token !== operation) return null;
        releaseStream();
        video.srcObject = null;
        stage.classList.remove("active");
        phase = PHASE.ERROR;
        const message = errorMessage(error);
        setBusy(false, "Tentar novamente");
        startButton.disabled = false;
        stopButton.disabled = true;
        setStatus(error?.name === "NotAllowedError" ? "NO PERMISSION" : "ERROR", "error");
        setPlaceholder("Não foi possível iniciar", message);
        control?.patch("camera", { active: false, status: error?.name === "NotAllowedError" ? "NO_PERMISSION" : "ERROR", error: message }, { source: "camera-error" });
        control?.patch("diagnostics", { lastError: message }, { source: "camera-error" });
        control?.log("ERROR", "CÂMERA", message, { name: error?.name });
        window.dispatchEvent(new CustomEvent("quantum:camera-error", { detail: { name: error?.name || "Error", message } }));
        throw error;
      } finally {
        if (token === operation) pendingStart = null;
        startButton.setAttribute("aria-busy", "false");
      }
    })();
    return pendingStart;
  }

  async function stop(reason = "USER") {
    if (phase === PHASE.OFF && !stream) return;
    ++operation;
    phase = PHASE.STOPPING;
    setBusy(true, "Encerrando…");
    setStatus("STOPPING…", "warning");
    stopFpsMonitor();
    releaseStream();
    try { video.pause(); } catch { /* sem reprodução ativa */ }
    video.srcObject = null;
    stage.classList.remove("active");
    phase = PHASE.OFF;
    setStatus("CAMERA OFF", "offline");
    setPlaceholder("Câmera desligada", "Clique em “Ativar câmera” e permita o acesso.");
    startButton.textContent = "Ativar câmera";
    startButton.disabled = false;
    stopButton.disabled = true;
    if (deviceSelect) deviceSelect.disabled = deviceSelect.options.length < 2;
    control?.patch("camera", { active: false, status: "OFFLINE", fps: 0, width: null, height: null, error: null }, { source: "camera-stop", reason });
    control?.log("INFO", "CÂMERA", `Captura encerrada (${reason})`);
    window.dispatchEvent(new CustomEvent("quantum:camera-stopped", { detail: { reason } }));
    pendingStart = null;
  }

  function showError(message) {
    phase = PHASE.ERROR;
    setStatus("ERROR", "error");
    setPlaceholder("Câmera indisponível", message);
    startButton.textContent = "Tentar novamente";
    startButton.disabled = false;
    stopButton.disabled = true;
    control?.patch("camera", { active: false, status: "ERROR", error: message }, { source: "camera-runtime-error" });
    control?.patch("diagnostics", { lastError: message }, { source: "camera-runtime-error" });
  }

  startButton.addEventListener("click", () => { start().catch(() => {}); });
  stopButton.addEventListener("click", () => { stop("USER").catch(() => {}); });
  deviceSelect?.addEventListener("change", async () => {
    selectedDeviceId = deviceSelect.value;
    control?.log("INFO", "CÂMERA", `Dispositivo selecionado: ${deviceSelect.selectedOptions[0]?.textContent || "câmera"}`);
    if (phase === PHASE.ACTIVE) {
      await stop("DEVICE_CHANGE");
      await start({ deviceId: selectedDeviceId }).catch(() => {});
    }
  });
  navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
    const devices = await refreshDevices();
    if (phase === PHASE.ACTIVE && selectedDeviceId && !devices.some((device) => device.deviceId === selectedDeviceId)) {
      await stop("DEVICE_REMOVED");
      showError("A câmera ativa foi removida do computador.");
    }
  });
  window.addEventListener("pagehide", () => { stop("PAGE_HIDE").catch(() => {}); });

  window.quantumCameraController = Object.freeze({
    PHASE,
    start,
    stop,
    refreshDevices,
    get phase() { return phase; },
    get active() { return phase === PHASE.ACTIVE; },
    get stream() { return stream; },
  });
  phase = PHASE.OFF;
  setStatus("CAMERA OFF", "offline");
  setPlaceholder("Câmera desligada", "Clique em “Ativar câmera” e permita o acesso.");
  startButton.disabled = false;
  startButton.textContent = "Ativar câmera";
  refreshDevices();
  control?.log("INFO", "CÂMERA", "Controlador pronto");
})();
