(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const video = $("cameraVideo"), canvas = $("personCanvas");
  if (!video || !canvas || !window.QuantumPersonFollowMath) return;
  const ctx = canvas.getContext("2d"), control = window.QuantumControl;
  const follower = new window.QuantumPersonFollowMath.PersonFollower();
  const labels = { SELECT_TARGET: "Escolha uma pessoa cadastrada", CONFIRMING: "Confirmando o alvo",
    FOLLOWING: "Pessoa identificada", BODY_TRACKING: "Acompanhando o corpo · ID temporariamente mantido",
    APPEARANCE_TRACKING: "Alvo mantido pelo corpo e roupa · rosto fora de vista",
    AMBIGUOUS: "Pessoas sobrepostas · confirme o rosto", REIDENTIFY: "Mostre o rosto para confirmar o alvo",
    TARGET_LOST: "Alvo perdido · parado", PREDICTED_STOP: "Posição estimada · robô parado",
    KEEP_DISTANCE: "Distância de parada atingida", SENSOR_WAIT: "Aguardando leitura atual do sensor",
    STALE_FRAME: "Imagem atrasada ou congelada · parado", LOADING: "Carregando detector de pessoas",
    LOW_BODY_CONFIDENCE: "Detecção do corpo incerta · parado",
    OFFLINE: "Ative o Modo 2 e a câmera", ERROR: "Detector indisponível · parado", PAUSED: "Seguimento pausado",
    ENROLLING: "Cadastro em andamento · seguimento pausado" };
  let worker = null, generation = 0, ready = false, pending = null, schedule = 0;
  let lastVideoTime = -1, lastFrameAt = 0, cameraActive = false, activeView = "face";
  let faces = [], selectedName = "", paused = false, enrolling = false;
  let distance = null, sensorAt = 0, lastOutput = null, lastEmitAt = 0, sequence = 0;
  const diagnostics = { frameAgeMs: null, frameIntervalMs: null, lastStop: null, transitions: [] };
  const modeTwo = () => Number(control?.state.mode.id) === 2 && control?.state.mode.phase === "ACTIVE";
  const enabled = () => modeTwo() && cameraActive && activeView === "face" && !paused && !document.hidden && Boolean(follower.id);
  const movingCamera = () => ["DIREITA", "ESQUERDA", "GIRAR"].includes(control?.state.robot.command)
    || control?.state.robot.firmwareState === "DESVIANDO";

  function publish(result, people = []) {
    const now = performance.now();
    const changed = !lastOutput || lastOutput.state !== result.state || lastOutput.command !== result.command;
    const reason = result.reason || result.state;
    if (changed) {
      diagnostics.transitions.push({ atMs: Math.round(now), state: result.state, reason,
        command: result.command, frameAgeMs: lastFrameAt ? Math.round(now - lastFrameAt) : null,
        bodyConfidence: Number.isFinite(result.confidence) ? result.confidence : null,
        sensorCm: distance, sensorAgeMs: sensorAt ? Math.round(now - sensorAt) : null });
      if (diagnostics.transitions.length > 60) diagnostics.transitions.shift();
    }
    if (result.command === 'PARAR' && !['SELECT_TARGET', 'CONFIRMING', 'LOADING', 'OFFLINE', 'PAUSED', 'ENROLLING'].includes(result.state)) {
      diagnostics.lastStop = { reason, label: labels[reason] || reason, atMs: Math.round(now) };
    }
    lastOutput = result;
    const freshTargetFace = faces.some(f => f.id === follower.id && f.registered
      && now - f.capturedAt >= 0 && now - f.capturedAt <= 800);
    const framingNeeded = freshTargetFace && ['REIDENTIFY', 'TARGET_LOST'].includes(reason);
    $("personFollowStatus").textContent = framingNeeded
      ? 'Rosto identificado; enquadre rosto, tronco e pernas juntos para seguir.' : labels[result.state] || result.state;
    if (result.state === 'FOLLOWING') $("personFollowStatus").textContent += result.appearanceReady
      ? ' · continuidade visual pronta' : ' · preparando continuidade visual';
    $("personCount").textContent = String(people.length);
    $("personTarget").textContent = follower.id ? `${selectedName || follower.id} · ${follower.id}` : "Nenhum";
    $("personPrediction").textContent = result.prediction
      ? `${Math.round(result.prediction.x * 100)}% da largura · estimativa de ${Math.round(result.prediction.ageMs)} ms`
      : "Sem previsão ativa";
    $("faceTrackingState").textContent = labels[result.state] || result.state;
    $("faceDirection").textContent = result.command;
    if ($('personFrameAge')) $('personFrameAge').textContent = diagnostics.frameAgeMs == null ? '—' : `${diagnostics.frameAgeMs} ms`;
    if ($('personFrameInterval')) $('personFrameInterval').textContent = diagnostics.frameIntervalMs == null ? '—' : `${diagnostics.frameIntervalMs} ms`;
    if ($('personLastStop')) $('personLastStop').textContent = diagnostics.lastStop?.label || 'Nenhuma parada registrada';
    if ($('personFaceProcessing')) $('personFaceProcessing').textContent = window.quantumFacePerformance
      ? `${window.quantumFacePerformance.processingMs} ms` : '—';
    $("personFollowDelivery").textContent = !modeTwo() ? "Somente o Modo 2 recebe estas decisões."
      : !control.state.robot.connected ? "Prévia local: Arduino desconectado. Nenhum movimento físico."
        : control.state.safety.emergency ? "Arduino conectado, mas bloqueado pela parada de emergência."
          : `${result.command === 'PARAR' ? `Parado: ${$('personFollowStatus').textContent}` : `Pedido: ${result.command}`} · última resposta USB: ${control.state.communication.lastRx || "—"}`;
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
      worker = new Worker(new URL("web/person-detector.worker.js?v=3", document.baseURI));
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
        diagnostics.frameAgeMs = Math.round(now - data.capturedAt);
        diagnostics.frameIntervalMs = lastFrameAt ? Math.round(data.capturedAt - lastFrameAt) : null;
        lastFrameAt = data.capturedAt;
        const result = follower.update({ people: data.people, faces, now, capturedAt: data.capturedAt,
          cameraMoving: movingCamera(), requireSensor: Boolean(control.state.robot.connected),
          distance, sensorAgeMs: now - sensorAt });
        publish(result, data.people);
        if (token !== generation || !enabled()) return;
        // Resume from completion instead of waiting for the next polling tick.
        // At most one frame is in flight, and starts remain at least 100 ms apart.
        clearTimeout(schedule);
        schedule = setTimeout(() => frame(token), Math.max(0, 100 - (performance.now() - data.capturedAt)));
      };
      worker.postMessage({ type: "init" });
    } catch (error) { fail(error.message); }
  }
  const watchdog = setInterval(() => {
    if (!enabled() || !worker || enrolling) return;
    const now = performance.now();
    if (pending && now - pending.capturedAt > (ready ? 5000 : 30000)) { fail("Tempo de processamento esgotado"); return; }
    if (ready && (!lastFrameAt || now - lastFrameAt > 600)) {
      // Stop the expired command, but let the next observed frame decide if the
      // track is continuous. A timer firing before an in-flight result must not
      // erase face evidence. update() still rejects stale frames and long gaps.
      publish(follower.stop("STALE_FRAME"));
    }
  }, 100);

  window.addEventListener("quantum:face-observations", ({ detail }) => {
    faces = detail.faces || [];
    enrolling = Boolean(detail.registering);
    if (follower.id !== detail.selectedId) {
      follower.select(detail.selectedId); selectedName = detail.selectedName || "";
      if (!follower.id) stop('SELECT_TARGET');
      else { stopped('CONFIRMING'); start(); }
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
  window.addEventListener("quantum:mode-changed", () => {
    paused = false;
    if (modeTwo() && !follower.id) stopped('SELECT_TARGET');
    start();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop("PAUSED"); else start(); });
  window.addEventListener("pagehide", () => { stop(); clearInterval(watchdog); });
  control?.subscribe?.(({ section, current, meta }) => {
    if (section === "robot" && meta?.source === "arduino-telemetry") { distance = current.robot.distance; sensorAt = performance.now(); }
  });
  async function prepare() {
    paused = false;
    if (!modeTwo()) window.quantumRobot?.requestMode(2, "person-follow");
    else {
      try { await window.quantumGestureController?.selectView("face"); await window.quantumCameraController?.start(); start(); }
      catch (error) { fail(error.message); }
    }
  }
  $("preparePersonFollow").addEventListener("click", prepare);
  $("pausePersonFollow").addEventListener("click", () => { paused = true; stop("PAUSED"); });
  $("retryPersonDetection").addEventListener("click", () => { stop(); paused = false; start(); });
  function diagnosticSnapshot() {
    return JSON.parse(JSON.stringify({ version: 1, ...diagnostics, face: window.quantumFacePerformance || null }));
  }
  $('downloadPersonDiagnostics')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(diagnosticSnapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'quantum-modo2-diagnostico.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.quantumPersonFollower = Object.freeze({ prepare, get snapshot() { return lastOutput; },
    get diagnostics() { return diagnosticSnapshot(); } });
  stopped("OFFLINE");
})();
