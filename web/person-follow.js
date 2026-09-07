(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const video = $("cameraVideo"), canvas = $("personCanvas");
  if (!video || !canvas || !window.QuantumPersonFollowMath) return;
  const ctx = canvas.getContext("2d"), control = window.QuantumControl;
  const follower = new window.QuantumPersonFollowMath.PersonFollower();
  const labels = { SELECT_TARGET: "Escolha uma pessoa cadastrada", CONFIRMING: "Confirmando o alvo",
    FOLLOWING: "Pessoa identificada", BODY_TRACKING: "Acompanhando o corpo · ID temporariamente mantido",
    AMBIGUOUS: "Pessoas sobrepostas · confirme o rosto", REIDENTIFY: "Mostre o rosto para confirmar o alvo",
    TARGET_LOST: "Alvo perdido · parado", PREDICTED_STOP: "Posição estimada · robô parado",
    KEEP_DISTANCE: "Distância de parada atingida", SENSOR_WAIT: "Aguardando leitura atual do sensor",
    STALE_FRAME: "Imagem atrasada ou congelada · parado", LOADING: "Carregando detector de pessoas",
    OFFLINE: "Ative o Modo 2 e a câmera", ERROR: "Detector indisponível · parado", PAUSED: "Seguimento pausado",
    ENROLLING: "Cadastro em andamento · seguimento pausado" };
  let worker = null, generation = 0, ready = false, pending = null, schedule = 0;
  let lastVideoTime = -1, lastFrameAt = 0, cameraActive = false, activeView = "face";
  let faces = [], selectedName = "", paused = false, enrolling = false;
  let distance = null, sensorAt = 0, lastOutput = null, lastEmitAt = 0, sequence = 0;
  const modeTwo = () => Number(control?.state.mode.id) === 2 && control?.state.mode.phase === "ACTIVE";
  const enabled = () => modeTwo() && cameraActive && activeView === "face" && !paused && !document.hidden;
  const movingCamera = () => ["DIREITA", "ESQUERDA", "GIRAR"].includes(control?.state.robot.command)
    || control?.state.robot.firmwareState === "DESVIANDO";

  function publish(result, people = []) {
    const now = performance.now();
    lastOutput = result;
    $("personFollowStatus").textContent = labels[result.state] || result.state;
    $("personCount").textContent = String(people.length);
    $("personTarget").textContent = follower.id ? `${selectedName || follower.id} · ${follower.id}` : "Nenhum";
    $("personPrediction").textContent = result.prediction
      ? `${Math.round(result.prediction.x * 100)}% da largura · estimativa de ${Math.round(result.prediction.ageMs)} ms`
      : "Sem previsão ativa";
    $("faceTrackingState").textContent = labels[result.state] || result.state;
    $("faceDirection").textContent = result.command;
    $("personFollowDelivery").textContent = !modeTwo() ? "Somente o Modo 2 recebe estas decisões."
      : !control.state.robot.connected ? "Prévia local: Arduino desconectado. Nenhum movimento físico."
        : control.state.safety.emergency ? "Arduino conectado, mas bloqueado pela parada de emergência."
          : `Pedido: ${result.command} · última confirmação USB: ${control.state.communication.lastRx || "—"}`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of people) {
      const selected = result.box && window.QuantumPersonFollowMath.overlap(result.box, p.box) > 0.8;
      const b = p.box, x = (1 - b.x - b.width) * canvas.width, y = b.y * canvas.height;
      ctx.strokeStyle = selected ? "#187653" : "#1666a8";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, b.width * canvas.width, b.height * canvas.height);
      ctx.font = "16px sans-serif";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(selected ? (selectedName || follower.id) : "Pessoa", x + 4, Math.max(18, y - 8));
    }
    if (result.prediction) {
      const x = (1 - result.prediction.x) * canvas.width;
      ctx.setLineDash([8, 6]); ctx.strokeStyle = "#ad6400";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); ctx.setLineDash([]);
    }
    // Do not publish decisions into other modes, including their simulator input.
    if (!modeTwo()) return;
    control?.patch("vision", { targetId: follower.id, tracking: result.state,
      direction: result.command, confidence: result.confidence || 0 }, { source: "person-follow" });
    const unchanged = publish.signature === `${result.state}:${result.command}:${follower.id}`;
    if (unchanged && now - lastEmitAt < 150) return;
    publish.signature = `${result.state}:${result.command}:${follower.id}`;
    lastEmitAt = now;
    window.dispatchEvent(new CustomEvent("quantum:person-tracking", { detail: {
      ...result, tracking: result.state, emittedAt: now, modeGeneration: window.quantumRobot?.modeGeneration,
      // Prediction is NEVER presented as visible to the existing USB controller.
      visible: result.visible === true && !result.prediction, registered: Boolean(follower.id),
    } }));
  }
  function stopped(state) { publish(follower.stop(state)); }
  function stop(state = "OFFLINE") {
    ++generation;
    clearTimeout(schedule);
    worker?.terminate(); worker = null;
    ready = false; pending = null; lastVideoTime = -1; lastFrameAt = 0;
    follower.reset(); stopped(state);
  }
  function fail(message) {
    stop("ERROR");
    $("personFollowStatus").textContent = `Detector indisponível: ${message}`;
    $("retryPersonDetection").hidden = false;
    control?.log("ERROR", "MODO 2", `Detector de pessoas: ${message}`);
  }
  async function frame(token) {
    if (token !== generation || !enabled() || !ready) return;
    try {
      if (enrolling) { stopped("ENROLLING"); return; }
      if (pending || video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const capturedAt = performance.now(), id = ++sequence;
      pending = { id, capturedAt };
      const bitmap = await createImageBitmap(video);
      if (token !== generation || !enabled()) { bitmap.close(); return; }
      worker.postMessage({ type: "frame", id, capturedAt, bitmap }, [bitmap]);
    } catch (error) { if (token === generation) fail(error.message); }
    finally { if (token === generation && enabled()) schedule = setTimeout(() => frame(token), 100); }
  }
  function start() {
    if (!enabled() || worker) return;
    const token = ++generation;
    canvas.width = video.videoWidth || 960; canvas.height = video.videoHeight || 540;
    stopped("LOADING");
    $("retryPersonDetection").hidden = true;
    try {
      worker = new Worker(new URL("web/person-detector.worker.js?v=1", document.baseURI));
      const startedAt = performance.now();
      pending = { id: "loading", capturedAt: startedAt };
      worker.onerror = error => { if (token === generation) fail(error.message || "Falha no worker local"); };
      worker.onmessage = ({ data }) => {
        if (token !== generation || !enabled()) return;
        if (data.type === "ready") { ready = true; pending = null; frame(token); return; }
        if (data.type === "error") { fail(data.message); return; }
        if (data.type !== "result" || !pending || pending.id !== data.id) return;
        pending = null;
        const now = performance.now();
        if (enrolling) { stopped("ENROLLING"); return; }
        lastFrameAt = data.capturedAt;
        const result = follower.update({ people: data.people, faces, now, capturedAt: data.capturedAt,
          cameraMoving: movingCamera(), requireSensor: Boolean(control.state.robot.connected),
          distance, sensorAgeMs: now - sensorAt });
        publish(result, data.people);
      };
      worker.postMessage({ type: "init" });
    } catch (error) { fail(error.message); }
  }
  const watchdog = setInterval(() => {
    if (!enabled() || !worker || enrolling) return;
    const now = performance.now();
    if (pending && now - pending.capturedAt > (ready ? 5000 : 30000)) { fail("Tempo de processamento esgotado"); return; }
    if (ready && (!lastFrameAt || now - lastFrameAt > 600)) {
      publish(follower.missing(now, "STALE_FRAME", movingCamera()));
    }
  }, 100);

  window.addEventListener("quantum:face-observations", ({ detail }) => {
    faces = detail.faces || [];
    enrolling = Boolean(detail.registering);
    if (follower.id !== detail.selectedId) {
      follower.select(detail.selectedId); selectedName = detail.selectedName || "";
      stopped(follower.id ? "CONFIRMING" : "SELECT_TARGET");
    }
    if (detail.failed) { faces = []; follower.reset(); stopped("ERROR"); }
    if (enrolling) { follower.reset(); stopped("ENROLLING"); }
  });
  window.addEventListener("quantum:camera-started", () => { cameraActive = true; start(); });
  window.addEventListener("quantum:camera-stopped", () => { cameraActive = false; faces = []; stop(); });
  window.addEventListener("quantum:camera-error", () => { cameraActive = false; faces = []; stop("ERROR"); });
  window.addEventListener("quantum:camera-view-changed", ({ detail }) => {
    activeView = detail.view;
    if (activeView !== "face") { faces = []; stop("PAUSED"); } else start();
  });
  window.addEventListener("quantum:mode-will-change", () => { stop("PAUSED"); });
  window.addEventListener("quantum:mode-changed", () => { paused = false; start(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop("PAUSED"); else start(); });
  window.addEventListener("pagehide", () => { stop(); clearInterval(watchdog); });
  control?.subscribe?.(({ section, current, meta }) => {
    if (section === "robot" && meta?.source === "arduino-telemetry") { distance = current.robot.distance; sensorAt = performance.now(); }
  });
  $("preparePersonFollow").addEventListener("click", async () => {
    paused = false;
    if (!modeTwo()) window.quantumRobot?.requestMode(2, "person-follow");
    else {
      try { await window.quantumGestureController?.selectView("face"); await window.quantumCameraController?.start(); start(); }
      catch (error) { fail(error.message); }
    }
  });
  $("pausePersonFollow").addEventListener("click", () => { paused = true; stop("PAUSED"); });
  $("retryPersonDetection").addEventListener("click", () => { stop(); paused = false; start(); });
  window.quantumPersonFollower = Object.freeze({ get snapshot() { return lastOutput; } });
  stopped("OFFLINE");
})();
