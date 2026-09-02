(() => {
  "use strict";

  const control = window.QuantumControl;
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("gestureCanvas");
  const context = canvas.getContext("2d");
  const cameraPanel = document.getElementById("camera-gestos");
  const facePanel = document.getElementById("faceCameraPanel");
  const gesturePanel = document.getElementById("gestureCameraPanel");
  const cameraTabs = document.querySelectorAll(".camera-view-tab");
  const toggleButton = document.getElementById("toggleGestures");
  const detectorStatus = document.getElementById("gestureDetectorStatus");
  const commandElement = document.getElementById("gestureCommand");
  const countElement = document.getElementById("fingerCount");
  const confidenceElement = document.getElementById("gestureConfidence");
  const fpsElement = document.getElementById("gestureFps");
  const deliveryStatus = document.getElementById("gestureDeliveryStatus");

  const defaultCommands = { 1: "FRENTE", 2: "DIREITA", 3: "ESQUERDA", 4: "PARAR", 5: "GIRAR" };
  let userConfig = window.QuantumUserConfig?.get() || null;
  let COMMANDS = Object.freeze(userConfig ? { ...userConfig.gestureMap } : defaultCommands);
  const CONNECTIONS = Object.freeze([
    [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8], [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16], [13,17],[17,18],[18,19],[19,20],[0,17],
  ]);
  let MIN_CONFIDENCE = userConfig?.minConfidence ?? 0.65;
  const CONFIRM_FRAMES = 4;
  const STOP_CONFIRM_FRAMES = 2;
  const CONFIRM_MS = 180;
  let COMMAND_COOLDOWN_MS = userConfig?.commandCooldownMs ?? 650;
  const COMMAND_HEARTBEAT_MS = 400;
  const LOST_HAND_STOP_MS = 500;
  let UNSTABLE_GESTURE_STOP_MS = userConfig?.unstableStopMs ?? 500;
  const INFERENCE_INTERVAL_MS = 83;
  const MODEL_IDLE_RELEASE_MS = 60000;

  let model = null;
  let modelPromise = null;
  let modelState = "NOT_LOADED";
  let modelReleaseTimer = 0;
  let enabled = false;
  let active = false;
  let activeView = "face";
  let loopGeneration = 0;
  let animationId = 0;
  let lastVideoTime = -1;
  let lastInferenceAt = 0;
  let candidateCount = 0;
  let candidateFrames = 0;
  let candidateSince = 0;
  let confirmedCount = 0;
  let confirmedCommand = null;
  let lastDispatchAt = 0;
  let cooldownUntil = 0;
  let lastHandAt = 0;
  let unstableSince = 0;
  let inferenceFrames = 0;
  let fpsWindowAt = 0;

  function setDetectorStatus(status, detail = "") {
    if (detectorStatus) detectorStatus.textContent = status;
    if (detail) countElement.textContent = detail;
    toggleButton.dataset.state = status;
  }

  function setToggleState(state) {
    toggleButton.disabled = state === "LOADING" || state === "STOPPING";
    toggleButton.setAttribute("aria-pressed", String(state === "ACTIVE"));
    if (state === "LOADING") toggleButton.textContent = "Carregando detector…";
    else if (state === "ACTIVE") toggleButton.textContent = "Desativar gestos";
    else if (state === "ERROR") toggleButton.textContent = "Tentar novamente";
    else toggleButton.textContent = "Ativar gestos";
  }

  function updateDeliveryText() {
    const mode = control?.state.mode.id || 1;
    if (!enabled) deliveryStatus.textContent = "Detector desligado. Ative-o para testar os gestos.";
    else if (mode !== 3) deliveryStatus.textContent = "Detector ativo para teste. Os comandos só chegam ao robô no Modo Gestos.";
    else if (!control?.state.robot.connected) deliveryStatus.textContent = "Gesto validado, mas o Arduino USB está desconectado.";
    else deliveryStatus.textContent = `Modo Gestos ativo · último comando: ${confirmedCommand || "PARAR"}.`;
  }

  function clearOverlay() {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function clearCandidate() {
    candidateCount = 0;
    candidateFrames = 0;
    candidateSince = 0;
  }

  function renderGestureMapLabels() {
    document.querySelectorAll(".gesture-map [data-fingers]").forEach((item) => {
      const label = item.querySelector("span");
      const command = COMMANDS[Number(item.dataset.fingers)];
      if (label && command) label.textContent = command.charAt(0) + command.slice(1).toLocaleLowerCase("pt-BR");
    });
  }

  function updateGestureUi(count, confidence, stable) {
    document.querySelectorAll(".gesture-map [data-fingers]").forEach((item) => {
      item.classList.toggle("active", stable && Number(item.dataset.fingers) === count);
    });
    confidenceElement.textContent = confidence ? `${Math.round(confidence * 100)}%` : "—";
    if (!count) {
      commandElement.textContent = "NENHUM";
      countElement.textContent = "Nenhum gesto detectado";
      return;
    }
    if (!stable) {
      commandElement.textContent = "VALIDANDO";
      countElement.textContent = `${count} dedo(s) · mantenha a mão firme`;
      return;
    }
    commandElement.textContent = COMMANDS[count];
    countElement.textContent = `${count} dedo(s) confirmados`;
  }

  function dispatchCommand(command, count, confidence, reason = "CONFIRMED") {
    lastDispatchAt = performance.now();
    window.dispatchEvent(new CustomEvent("quantum:gesture-command", {
      detail: {
        command,
        count,
        confidence,
        stable: reason === "CONFIRMED" || reason === "HEARTBEAT",
        reason,
        emittedAt: performance.now(),
        modeGeneration: window.quantumRobot?.modeGeneration,
      },
    }));
  }

  function forceStop(reason, logEvent = true) {
    const hadCommand = confirmedCommand && confirmedCommand !== "PARAR";
    confirmedCount = 0;
    confirmedCommand = null;
    unstableSince = 0;
    clearCandidate();
    updateGestureUi(0, 0, false);
    if (hadCommand || reason === "MODE_CHANGE" || reason === "DISABLED" || reason === "CAMERA_STOPPED") {
      dispatchCommand("PARAR", 0, 1, reason);
      if (logEvent) control?.log("INFO", "GESTOS", `Comando limpo · ${reason}`);
    }
    control?.patch("gestures", { gesture: null, confidence: 0, command: "PARAR" }, { source: "gesture-stop", reason });
    updateDeliveryText();
  }

  function classifyFingerCount(landmarks, worldLandmarks) {
    return window.QuantumGestureMath?.classifyFingerCountDetails?.(landmarks, worldLandmarks)
      || { count: window.QuantumGestureMath?.classifyFingerCount(landmarks, worldLandmarks) || 0, confidence: 0 };
  }

  function drawHand(landmarks) {
    clearOverlay();
    context.lineWidth = Math.max(2, canvas.width / 420);
    context.strokeStyle = "#3ad8ff";
    context.fillStyle = "#4cf2b1";
    for (const [from, to] of CONNECTIONS) {
      context.beginPath();
      context.moveTo(landmarks[from].x * canvas.width, landmarks[from].y * canvas.height);
      context.lineTo(landmarks[to].x * canvas.width, landmarks[to].y * canvas.height);
      context.stroke();
    }
    for (const point of landmarks) {
      context.beginPath();
      context.arc(point.x * canvas.width, point.y * canvas.height, Math.max(3, canvas.width / 190), 0, Math.PI * 2);
      context.fill();
    }
  }

  async function loadModel() {
    if (model) return model;
    if (modelPromise) return modelPromise;
    if (window.location?.protocol === "file:") {
      const target = window.QuantumRuntime?.publicSiteUrl || "o painel HTTPS publicado";
      throw new Error(`Gestos exigem o site HTTPS. Abra ${target}.`);
    }
    window.clearTimeout(modelReleaseTimer);
    modelState = "LOADING";
    setToggleState("LOADING");
    setDetectorStatus("LOADING", "Carregando MediaPipe local…");
    control?.patch("gestures", { status: "LOADING", model: "LOADING" }, { source: "gesture-model" });
    control?.log("INFO", "GESTOS", "Carregando detector local de mãos");

    modelPromise = (async () => {
      try {
        const moduleUrl = new URL("web/vendor/mediapipe/vision_bundle.js", document.baseURI).href;
        const wasmUrl = new URL("web/vendor/mediapipe/wasm", document.baseURI).href.replace(/\/$/, "");
        const modelUrl = new URL("web/vendor/mediapipe/hand_landmarker.task", document.baseURI).href;
        const { FilesetResolver, HandLandmarker } = await import(moduleUrl);
        const vision = await FilesetResolver.forVisionTasks(wasmUrl);
        const options = {
          baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: MIN_CONFIDENCE,
          minHandPresenceConfidence: MIN_CONFIDENCE,
          minTrackingConfidence: 0.6,
        };
        try {
          model = await HandLandmarker.createFromOptions(vision, options);
        } catch (gpuError) {
          control?.log("WARNING", "GESTOS", "GPU indisponível; detector alternado para CPU");
          options.baseOptions.delegate = "CPU";
          model = await HandLandmarker.createFromOptions(vision, options);
        }
        modelState = "READY";
        control?.patch("gestures", { status: enabled ? "ONLINE" : "READY", model: "READY" }, { source: "gesture-model" });
        control?.log("INFO", "GESTOS", "Modelo local carregado");
        return model;
      } catch (error) {
        modelState = "ERROR";
        model = null;
        control?.patch("gestures", { status: "ERROR", model: "ERROR" }, { source: "gesture-model" });
        control?.patch("diagnostics", { lastError: `Modelo de gestos: ${error.message}` }, { source: "gesture-model" });
        control?.log("ERROR", "GESTOS", `Modelo não carregou: ${error.message}`);
        throw error;
      } finally {
        modelPromise = null;
      }
    })();
    return modelPromise;
  }

  function scheduleModelRelease() {
    window.clearTimeout(modelReleaseTimer);
    modelReleaseTimer = window.setTimeout(() => {
      if (enabled || !model) return;
      try { model.close(); } catch { /* modelo já liberado */ }
      model = null;
      modelState = "NOT_LOADED";
      control?.patch("gestures", { model: "NOT_LOADED", status: "OFFLINE" }, { source: "gesture-idle-release" });
      control?.log("INFO", "GESTOS", "Modelo liberado após 60 s inativo");
    }, MODEL_IDLE_RELEASE_MS);
  }

  function confirmTemporal(count, now) {
    // O score retornado em `handedness` mede apenas a certeza Left/Right, não
    // a presença da mão. A presença já foi filtrada pelo modelo na criação.
    if (!COMMANDS[count]) {
      clearCandidate();
      return false;
    }
    if (candidateCount !== count) {
      candidateCount = count;
      candidateFrames = 1;
      candidateSince = now;
    } else {
      candidateFrames += 1;
    }
    const requiredFrames = count === 4 ? STOP_CONFIRM_FRAMES : CONFIRM_FRAMES;
    const requiredTime = count === 4 ? 80 : CONFIRM_MS;
    return candidateFrames >= requiredFrames && now - candidateSince >= requiredTime;
  }

  function handleNoHand(now) {
    clearOverlay();
    clearCandidate();
    if (!lastHandAt || now - lastHandAt >= LOST_HAND_STOP_MS) {
      if (confirmedCommand) {
        control?.log("WARNING", "GESTOS", "Mão perdida; comando PARAR aplicado");
        forceStop("HAND_LOST", false);
      } else {
        updateGestureUi(0, 0, false);
      }
    }
  }

  function processResult(result, now) {
    if (!result.landmarks?.length) {
      handleNoHand(now);
      return;
    }
    lastHandAt = now;
    const landmarks = result.landmarks[0];
    const worldLandmarks = result.worldLandmarks?.[0];
    const classification = classifyFingerCount(landmarks, worldLandmarks);
    const count = classification.count;
    // Confiança geométrica do gesto. O score de handedness informa apenas se
    // a mão parece esquerda/direita e não mede quantos dedos estão levantados.
    const confidence = Number(classification.confidence) || 0;
    drawHand(landmarks);
    if (confidence < MIN_CONFIDENCE) clearCandidate();
    const stable = confidence >= MIN_CONFIDENCE && confirmTemporal(count, now);
    updateGestureUi(count, confidence, stable);
    control?.patch("gestures", { gesture: count || null, confidence, status: "ONLINE" }, { source: "gesture-frame" });
    if (!stable) {
      if (!unstableSince) unstableSince = now;
      if (confirmedCommand && now - unstableSince >= UNSTABLE_GESTURE_STOP_MS) {
        control?.log("WARNING", "GESTOS", "Gesto deixou de ser estável; comando PARAR aplicado");
        forceStop("GESTURE_UNSTABLE", false);
      }
      return;
    }
    unstableSince = 0;

    const command = COMMANDS[count];
    const changed = command !== confirmedCommand;
    const stopCommand = command === "PARAR";
    if (changed && (stopCommand || now >= cooldownUntil)) {
      confirmedCount = count;
      confirmedCommand = command;
      cooldownUntil = now + COMMAND_COOLDOWN_MS;
      dispatchCommand(command, count, confidence);
      control?.patch("gestures", { command, gesture: count, confidence }, { source: "gesture-confirmed" });
      control?.log("INFO", "GESTOS", `Confirmado: ${command} · ${Math.round(confidence * 100)}%`);
      updateDeliveryText();
    } else if (!changed && now - lastDispatchAt >= COMMAND_HEARTBEAT_MS) {
      dispatchCommand(command, count, confidence, "HEARTBEAT");
    }
  }

  function updateInferenceFps(now) {
    inferenceFrames += 1;
    if (!fpsWindowAt) fpsWindowAt = now;
    const elapsed = now - fpsWindowAt;
    if (elapsed < 1000) return;
    const fps = inferenceFrames * 1000 / elapsed;
    inferenceFrames = 0;
    fpsWindowAt = now;
    fpsElement.textContent = `${fps.toFixed(1)} FPS`;
    control?.patch("gestures", { fps }, { source: "gesture-fps" });
  }

  function startLoop() {
    const generation = ++loopGeneration;
    cancelAnimationFrame(animationId);
    lastVideoTime = -1;
    lastInferenceAt = 0;
    inferenceFrames = 0;
    fpsWindowAt = performance.now();
    const frame = (now) => {
      if (generation !== loopGeneration || !active || !enabled || activeView !== "hand") return;
      animationId = requestAnimationFrame(frame);
      if (!model || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === lastVideoTime || now - lastInferenceAt < INFERENCE_INTERVAL_MS) return;
      lastVideoTime = video.currentTime;
      lastInferenceAt = now;
      try {
        const result = model.detectForVideo(video, now);
        processResult(result, now);
        updateInferenceFps(now);
      } catch (error) {
        control?.log("ERROR", "GESTOS", `Falha durante inferência: ${error.message}`);
        control?.patch("diagnostics", { lastError: `Gestos: ${error.message}` }, { source: "gesture-loop" });
        disable("RUNTIME_ERROR");
        setToggleState("ERROR");
        setDetectorStatus("ERROR", "O detector encontrou um erro. Clique em tentar novamente.");
      }
    };
    animationId = requestAnimationFrame(frame);
  }

  async function enable() {
    if (enabled && active) return;
    enabled = true;
    window.clearTimeout(modelReleaseTimer);
    setToggleState("LOADING");
    updateDeliveryText();
    control?.patch("gestures", { enabled: true, active: false, status: "STARTING" }, { source: "gesture-enable" });
    control?.log("INFO", "GESTOS", "Ativação solicitada");
    try {
      if (activeView !== "hand") await setCameraView("hand");
      if (!window.quantumCameraController?.active) await window.quantumCameraController.start();
      if (!enabled || activeView !== "hand" || !window.quantumCameraController?.active) return;
      await loadModel();
      if (!enabled || activeView !== "hand" || !window.quantumCameraController.active) return;
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      active = true;
      setToggleState("ACTIVE");
      setDetectorStatus("ONLINE", "Aguardando um gesto estável…");
      control?.patch("gestures", { enabled: true, active: true, status: "ONLINE", model: "READY" }, { source: "gesture-enable" });
      control?.log("INFO", "GESTOS", "Reconhecimento contínuo iniciado");
      startLoop();
      updateDeliveryText();
    } catch (error) {
      if (!enabled) return;
      enabled = false;
      active = false;
      setToggleState("ERROR");
      setDetectorStatus("ERROR", `Não foi possível ativar: ${error.message}`);
      control?.patch("gestures", { enabled: false, active: false, status: "ERROR" }, { source: "gesture-enable" });
      updateDeliveryText();
    }
  }

  function disable(reason = "DISABLED") {
    const wasEnabled = enabled || active;
    enabled = false;
    active = false;
    ++loopGeneration;
    cancelAnimationFrame(animationId);
    animationId = 0;
    clearOverlay();
    forceStop(reason, wasEnabled);
    setToggleState("OFFLINE");
    setDetectorStatus("OFFLINE", "Nenhum gesto detectado");
    fpsElement.textContent = "— FPS";
    control?.patch("gestures", { enabled: false, active: false, status: "OFFLINE", gesture: null, confidence: 0, command: "PARAR", fps: 0 }, { source: "gesture-disable", reason });
    if (wasEnabled) control?.log("INFO", "GESTOS", `Detector desativado (${reason})`);
    scheduleModelRelease();
    updateDeliveryText();
  }

  async function setCameraView(view) {
    const nextView = view === "hand" ? "hand" : "face";
    if (activeView === nextView && cameraPanel.dataset.cameraView === nextView) return;
    if (activeView === "hand" && nextView !== "hand") disable("VIEW_CHANGE");
    activeView = nextView;
    cameraPanel.dataset.cameraView = activeView;
    cameraTabs.forEach((button) => {
      const selected = button.dataset.cameraView === activeView;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    facePanel.hidden = activeView !== "face";
    gesturePanel.hidden = activeView !== "hand";
    clearOverlay();
    window.dispatchEvent(new CustomEvent("quantum:camera-view-changed", { detail: { view: activeView } }));
    control?.log("INFO", "INTERFACE", `Visão selecionada: ${activeView === "face" ? "ROSTO" : "MÃO"}`);
  }

  cameraTabs.forEach((button, index) => {
    button.addEventListener("click", () => { setCameraView(button.dataset.cameraView); });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = cameraTabs.length - 1;
      else nextIndex = (index + (event.key === "ArrowRight" ? 1 : -1) + cameraTabs.length) % cameraTabs.length;
      const next = cameraTabs[nextIndex];
      setCameraView(next.dataset.cameraView);
      next.focus();
    });
  });
  toggleButton.addEventListener("click", () => { if (enabled) disable("USER"); else enable(); });
  window.addEventListener("quantum:camera-stopped", () => disable("CAMERA_STOPPED"));
  window.addEventListener("quantum:camera-error", () => disable("CAMERA_ERROR"));
  window.addEventListener("quantum:mode-will-change", (event) => {
    if (event.detail?.previous?.id === 3) disable("MODE_CHANGE");
  });
  window.addEventListener("quantum:mode-changed", (event) => {
    const mode = event.detail?.current?.id;
    if (mode === 2) setCameraView("face");
    if (mode === 3) setCameraView("hand");
    updateDeliveryText();
  });
  window.addEventListener("quantum:user-config-changed", (event) => {
    const config = event.detail?.config;
    if (!config) return;
    userConfig = config;
    COMMANDS = Object.freeze({ ...config.gestureMap });
    MIN_CONFIDENCE = config.minConfidence;
    COMMAND_COOLDOWN_MS = config.commandCooldownMs;
    UNSTABLE_GESTURE_STOP_MS = config.unstableStopMs;
    clearCandidate();
    renderGestureMapLabels();
    updateGestureUi(0, 0, false);
    control?.log("INFO", "GESTOS", "Configurações aplicadas sem recarregar a página");
  });
  window.addEventListener("pagehide", () => {
    disable("PAGE_HIDE");
    window.clearTimeout(modelReleaseTimer);
    try { model?.close(); } catch { /* modelo já liberado */ }
    model = null;
  });

  window.quantumGestureController = Object.freeze({
    enable,
    disable,
    selectView: setCameraView,
    get enabled() { return enabled; },
    get active() { return active; },
    get view() { return activeView; },
    get modelState() { return modelState; },
  });
  cameraPanel.dataset.cameraView = "face";
  renderGestureMapLabels();
  facePanel.hidden = false;
  gesturePanel.hidden = true;
  setToggleState("OFFLINE");
  setDetectorStatus("OFFLINE", "Nenhum gesto detectado");
  updateGestureUi(0, 0, false);
  updateDeliveryText();
  control?.patch("gestures", { status: "OFFLINE", model: "NOT_LOADED" }, { source: "gesture-init" });
  control?.log("INFO", "GESTOS", "Controlador pronto · modelo local sob demanda");
})();
