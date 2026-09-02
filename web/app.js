(() => {
  "use strict";

  const canvas = document.getElementById("robotCanvas");
  const ctx = canvas.getContext("2d");
  const toggleButton = document.getElementById("toggleSimulation");
  const resetButton = document.getElementById("resetSimulation");
  const menuButton = document.getElementById("menuButton");
  const sidebar = document.querySelector(".sidebar");
  const stateValue = document.getElementById("stateValue");
  const commandValue = document.getElementById("commandValue");
  const distanceValue = document.getElementById("distanceValue");
  const eventValue = document.getElementById("eventValue");
  const safetyValue = document.getElementById("safetyValue");
  const simulatorSourceValue = document.getElementById("simulatorSourceValue");
  const simulatorHint = document.getElementById("simulatorHint");
  const simulatorCommandPanel = document.getElementById("simulatorCommandPanel");
  const autonomousModeButton = document.getElementById("simAutonomousMode");
  const followModeButton = document.getElementById("simFollowMode");
  const gestureModeButton = document.getElementById("simGestureMode");
  const simulatorCommandButtons = [...document.querySelectorAll("[data-simulator-command]")];
  const modeTestButtons = [...document.querySelectorAll("[data-run-mode-test]")];
  const followTestButtons = [...document.querySelectorAll("[data-follow-test]")];
  const gestureTestButtons = [...document.querySelectorAll("[data-gesture-test]")];
  const modeTestCards = [...document.querySelectorAll("[data-mode-test-card]")];
  const modeTestResult = document.getElementById("modeTestResult");

  const world = {
    width: 960,
    height: 540,
    running: true,
    events: 0,
    lastTime: performance.now(),
    robot: { x: 120, y: 280, angle: 0, speed: 80, avoidance: null },
    obstacles: [
      { x: 310, y: 180, w: 70, h: 190 },
      { x: 520, y: 60, w: 85, h: 190 },
      { x: 555, y: 365, w: 190, h: 65 },
      { x: 790, y: 170, w: 70, h: 210 }
    ]
  };
  const simulatorCommands = new window.QuantumSimulatorController.SimulatorCommandController(900);
  let simulatorVisible = true;
  let animationFrame = 0;
  let lastSimulatorUiSignature = "";

  function renderSimulatorControls(now = performance.now()) {
    const state = simulatorCommands.snapshot(now);
    const signature = `${state.mode}|${state.command}|${state.source}`;
    if (signature === lastSimulatorUiSignature) return;
    lastSimulatorUiSignature = signature;
    autonomousModeButton.classList.toggle("active", state.mode === "AUTONOMO");
    followModeButton.classList.toggle("active", state.mode === "SEGUIR");
    gestureModeButton.classList.toggle("active", state.mode === "GESTOS");
    autonomousModeButton.setAttribute("aria-pressed", String(state.mode === "AUTONOMO"));
    followModeButton.setAttribute("aria-pressed", String(state.mode === "SEGUIR"));
    gestureModeButton.setAttribute("aria-pressed", String(state.mode === "GESTOS"));
    simulatorCommandButtons.forEach((button) => {
      button.classList.toggle("active", state.mode === "GESTOS" && button.dataset.simulatorCommand === state.command);
      button.disabled = state.mode !== "GESTOS";
    });
    simulatorSourceValue.textContent = state.source;
    simulatorHint.textContent = state.mode === "AUTONOMO"
      ? "Autônomo ativo · o sensor virtual desvia dos obstáculos. Teclado: 1–5 ou setas."
      : state.mode === "SEGUIR"
        ? "Seguir pessoa · recebe a direção da câmera; sem alvo reconhecido, para."
      : state.source === "GESTO"
        ? `Gesto recebido · ${state.command}. Sem gesto novo por 0,9 s, o simulador para.`
        : `${state.source === "TECLADO" ? "Teclado" : "Teste manual"} · ${state.command}. Os gestos da câmera também controlam esta arena.`;
  }

  function setSimulatorMode(mode) {
    simulatorCommands.setMode(mode);
    world.robot.avoidance = null;
    renderSimulatorControls();
    scheduleAnimation();
  }

  function setSimulatorCommand(command, source = "TESTE") {
    if (!simulatorCommands.setCommand(command, source)) return false;
    if (command === "PARAR") world.robot.avoidance = null;
    renderSimulatorControls();
    scheduleAnimation();
    return true;
  }

  function reportModeTest(mode, command, message) {
    modeTestCards.forEach((card) => card.classList.toggle("testing", card.dataset.modeTestCard === String(mode)));
    if (!modeTestResult) return;
    modeTestResult.classList.add("active");
    modeTestResult.querySelector(".status-dot")?.classList.remove("idle");
    modeTestResult.querySelector("strong").textContent = `MODO ${mode} · ${command}`;
    modeTestResult.querySelector("small").textContent = message;
  }

  function startIsolatedModeTest(mode) {
    if (mode === 1) {
      setSimulatorMode("AUTONOMO");
      reportModeTest(1, "AUTÔNOMO", "Cenário ativo. O robô virtual avançará e desviará sozinho.");
    } else if (mode === 2) {
      setSimulatorMode("SEGUIR");
      simulatorCommands.setCommand("PARAR", "ROSTO SIMULADO");
      renderSimulatorControls();
      reportModeTest(2, "PARAR", "Modo isolado. Escolha uma posição facial simulada abaixo.");
    } else {
      setSimulatorMode("GESTOS");
      setSimulatorCommand("PARAR", "GESTO SIMULADO");
      reportModeTest(3, "PARAR", "Modo isolado. Pressione 1–5 para simular cada gesto.");
    }
    document.getElementById("robotCanvas")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(640, Math.round(rect.width * ratio));
    canvas.height = Math.max(330, Math.round(rect.height * ratio));
    ctx.setTransform(canvas.width / world.width, 0, 0, canvas.height / world.height, 0, 0);
  }

  function resetWorld() {
    Object.assign(world.robot, { x: 120, y: 280, angle: 0, speed: 80, avoidance: null });
    simulatorCommands.setMode("AUTONOMO");
    world.events = 0;
    world.running = true;
    world.lastTime = performance.now();
    toggleButton.textContent = "Pausar";
    renderSimulatorControls();
    scheduleAnimation();
  }

  function rayDistance() {
    const robot = world.robot;
    for (let distance = 0; distance <= 150; distance += 3) {
      const px = robot.x + Math.cos(robot.angle) * distance;
      const py = robot.y + Math.sin(robot.angle) * distance;
      if (px < 20 || py < 20 || px > world.width - 20 || py > world.height - 20) return distance;
      if (world.obstacles.some((o) => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h)) return distance;
    }
    return 150;
  }

  function update(dt, time) {
    const robot = world.robot;
    const distance = rayDistance();
    const command = simulatorCommands.current(time);
    if (command === "PARAR") {
      robot.avoidance = null;
      stateValue.textContent = "PARADO";
      commandValue.textContent = "PARAR";
      safetyValue.textContent = "PARADA SEGURA";
    } else if (robot.avoidance) {
      const phase = robot.avoidance.phase;
      if (time >= robot.avoidance.until) {
        if (phase === "PAUSA") robot.avoidance = { phase: "RE", until: time + 700, direction: robot.avoidance.direction };
        else if (phase === "RE") robot.avoidance = { phase: "CURVA", until: time + 900, direction: robot.avoidance.direction };
        else if (phase === "CURVA") robot.avoidance = { phase: "SAIDA", until: time + 600, direction: robot.avoidance.direction };
        else robot.avoidance = null;
      }
      if (robot.avoidance?.phase === "RE") {
        robot.x -= Math.cos(robot.angle) * robot.speed * 0.65 * dt;
        robot.y -= Math.sin(robot.angle) * robot.speed * 0.65 * dt;
        commandValue.textContent = "TRAS";
      } else if (robot.avoidance?.phase === "CURVA") {
        robot.angle += robot.avoidance.direction * 2.15 * dt;
        commandValue.textContent = robot.avoidance.direction > 0 ? "DIREITA" : "ESQUERDA";
      } else if (robot.avoidance?.phase === "SAIDA") {
        robot.x += Math.cos(robot.angle) * robot.speed * dt;
        robot.y += Math.sin(robot.angle) * robot.speed * dt;
        commandValue.textContent = "FRENTE";
      } else commandValue.textContent = "PARAR";
      stateValue.textContent = "DESVIANDO";
      safetyValue.textContent = "INTERVENÇÃO ATIVA";
    } else if (command === "FRENTE" && distance <= 44) {
      robot.avoidance = { phase: "PAUSA", until: time + 200, direction: world.events % 2 === 0 ? 1 : -1 };
      world.events += 1;
    } else if (command === "FRENTE") {
      robot.x += Math.cos(robot.angle) * robot.speed * dt;
      robot.y += Math.sin(robot.angle) * robot.speed * dt;
      stateValue.textContent = "AVANÇANDO";
      commandValue.textContent = "FRENTE";
      safetyValue.textContent = "MONITORANDO";
    } else if (command === "TRAS") {
      robot.x -= Math.cos(robot.angle) * robot.speed * dt;
      robot.y -= Math.sin(robot.angle) * robot.speed * dt;
      stateValue.textContent = "RECUANDO";
      commandValue.textContent = "TRAS";
      safetyValue.textContent = "COMANDO VIRTUAL";
    } else {
      const direction = command === "ESQUERDA" ? -1 : 1;
      const turnSpeed = command === "GIRAR" ? 3.2 : 1.8;
      robot.angle += direction * turnSpeed * dt;
      stateValue.textContent = command === "GIRAR" ? "GIRANDO" : `VIRANDO ${command}`;
      commandValue.textContent = command;
      safetyValue.textContent = "COMANDO VIRTUAL";
    }
    distanceValue.textContent = `${Math.round(distance)} px`;
    eventValue.textContent = String(world.events);
    renderSimulatorControls(time);
  }

  function drawGrid() {
    ctx.fillStyle = "#030913";
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.strokeStyle = "rgba(89, 132, 172, .10)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= world.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, world.height); ctx.stroke(); }
    for (let y = 0; y <= world.height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(world.width, y); ctx.stroke(); }
  }

  function draw() {
    drawGrid();
    world.obstacles.forEach((o, index) => {
      const gradient = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
      gradient.addColorStop(0, "#15263c"); gradient.addColorStop(1, "#0a1422");
      ctx.fillStyle = gradient; ctx.strokeStyle = "#294462"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#59728e"; ctx.font = "700 10px system-ui"; ctx.fillText(`OBSTÁCULO ${index + 1}`, o.x + 10, o.y + 20);
    });
    const robot = world.robot;
    const distance = rayDistance();
    ctx.save(); ctx.translate(robot.x, robot.y); ctx.rotate(robot.angle);
    ctx.strokeStyle = distance <= 44 ? "#ffbd5c" : "rgba(33,212,253,.42)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(Math.min(distance, 150), 0); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(33,212,253,.16)"; ctx.strokeStyle = "#21d4fd"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-24, -18, 48, 36, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#21d4fd"; ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(15, -8); ctx.lineTo(15, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#31e6a1"; ctx.beginPath(); ctx.arc(-8, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#9ab0c7"; ctx.font = "600 11px system-ui"; ctx.fillText("ROBÔ VIRTUAL", robot.x - 35, robot.y - 30);
  }

  function loop(time) {
    animationFrame = 0;
    const dt = Math.min((time - world.lastTime) / 1000, 0.05);
    world.lastTime = time;
    if (world.running) update(dt, time);
    draw();
    if (world.running && simulatorVisible && !document.hidden) animationFrame = requestAnimationFrame(loop);
  }

  function scheduleAnimation() {
    if (animationFrame || !world.running || !simulatorVisible || document.hidden) return;
    world.lastTime = performance.now();
    animationFrame = requestAnimationFrame(loop);
  }

  toggleButton.addEventListener("click", () => {
    world.running = !world.running;
    toggleButton.textContent = world.running ? "Pausar" : "Continuar";
    if (!world.running) {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      stateValue.textContent = "PAUSADO";
      commandValue.textContent = "PARAR";
      draw();
    } else scheduleAnimation();
  });
  resetButton.addEventListener("click", resetWorld);
  autonomousModeButton.addEventListener("click", () => setSimulatorMode("AUTONOMO"));
  followModeButton.addEventListener("click", () => setSimulatorMode("SEGUIR"));
  gestureModeButton.addEventListener("click", () => setSimulatorMode("GESTOS"));
  modeTestButtons.forEach((button) => button.addEventListener("click", () => startIsolatedModeTest(Number(button.dataset.runModeTest))));
  followTestButtons.forEach((button) => button.addEventListener("click", () => {
    setSimulatorMode("SEGUIR");
    const command = button.dataset.followTest;
    simulatorCommands.setCommand(command, command === "PARAR" ? "ALVO PERDIDO" : "ROSTO SIMULADO");
    renderSimulatorControls();
    scheduleAnimation();
    reportModeTest(2, command, command === "PARAR" ? "A perda do rosto gerou parada segura." : `Posição facial convertida no comando ${command}.`);
  }));
  gestureTestButtons.forEach((button) => button.addEventListener("click", () => {
    setSimulatorMode("GESTOS");
    const command = button.dataset.gestureTest;
    setSimulatorCommand(command, "GESTO SIMULADO");
    reportModeTest(3, command, `Gesto simulado convertido no comando ${command}.`);
  }));
  simulatorCommandButtons.forEach((button) => button.addEventListener("click", () => {
    setSimulatorCommand(button.dataset.simulatorCommand, "TESTE");
  }));
  const simulatorKeyboardCommands = Object.freeze({
    "1": "FRENTE", ArrowUp: "FRENTE", w: "FRENTE", W: "FRENTE",
    "2": "DIREITA", ArrowRight: "DIREITA", d: "DIREITA", D: "DIREITA",
    "3": "ESQUERDA", ArrowLeft: "ESQUERDA", a: "ESQUERDA", A: "ESQUERDA",
    "4": "PARAR", ArrowDown: "PARAR", s: "PARAR", S: "PARAR", " ": "PARAR",
    "5": "GIRAR", g: "GIRAR", G: "GIRAR",
  });
  simulatorCommandPanel.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target !== simulatorCommandPanel && [" ", "Enter"].includes(event.key)) return;
    const command = simulatorKeyboardCommands[event.key];
    if (!command) return;
    event.preventDefault();
    if (simulatorCommands.snapshot().mode !== "GESTOS") setSimulatorMode("GESTOS");
    setSimulatorCommand(command, "TECLADO");
  });
  window.addEventListener("quantum:gesture-command", (event) => {
    const detail = event.detail || {};
    if (detail.stable !== true || !detail.command) return;
    setSimulatorCommand(detail.command, "GESTO");
  });
  window.addEventListener("quantum:person-tracking", (event) => {
    if (simulatorCommands.snapshot().mode !== "SEGUIR") return;
    const detail = event.detail || {};
    simulatorCommands.setCommand(detail.visible ? detail.command : "PARAR", "ROSTO");
    renderSimulatorControls();
  });
  const mobileNavigation = window.matchMedia("(max-width: 920px)");
  function setMenuOpen(open) {
    sidebar.classList.toggle("open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    if (mobileNavigation.matches) {
      sidebar.setAttribute("aria-hidden", String(!open));
      sidebar.inert = !open;
    } else {
      sidebar.removeAttribute("aria-hidden");
      sidebar.inert = false;
    }
  }
  menuButton.addEventListener("click", () => setMenuOpen(!sidebar.classList.contains("open")));
  mobileNavigation.addEventListener?.("change", () => setMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("open")) {
      setMenuOpen(false);
      menuButton.focus();
    }
  });
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
    setMenuOpen(false);
  }));

  const codeElement = document.getElementById("arduinoCode");
  const codeFilename = document.getElementById("codeFilename");
  const codeStatus = document.getElementById("codeStatus");
  const runCode = document.getElementById("runCode");
  const copyCode = document.getElementById("copyCode");
  const downloadCode = document.getElementById("downloadCode");
  const saveCode = document.getElementById("saveCode");
  const restoreCode = document.getElementById("restoreCode");
  const codeEditFlag = document.getElementById("codeEditFlag");
  const codeCursorStatus = document.getElementById("codeCursorStatus");
  let bundledCodeForSource = "";
  let selectedProgram = "principal";
  let selectedSource = "";
  let selectedFilename = "";
  let downloadObjectUrl = "";

  const PROGRAM_LABELS = Object.freeze({
    principal: "Rodar autônomo",
    motores: "Rodar teste dos motores",
    sensor: "Rodar teste do sensor",
  });

  function programFromSource(source) {
    if (source.includes("teste_motores")) return "motores";
    if (source.includes("teste_sensor")) return "sensor";
    return "principal";
  }

  // Edições ficam só no localStorage deste navegador. Nada aqui é enviado
  // ao Arduino: para valer de verdade, baixe o .ino e grave pelo Arduino IDE.
  const CODE_EDIT_PREFIX = "quantumCodeEdit:";

  function readStoredCode(source) {
    try {
      return window.localStorage.getItem(CODE_EDIT_PREFIX + source);
    } catch {
      return null;
    }
  }

  function writeStoredCode(source, code) {
    try {
      window.localStorage.setItem(CODE_EDIT_PREFIX + source, code);
    } catch {
      // Sem storage disponível (modo privado, cota cheia): edição fica só na tela.
    }
  }

  function clearStoredCode(source) {
    try {
      window.localStorage.removeItem(CODE_EDIT_PREFIX + source);
    } catch {
      // ignora
    }
  }

  function updateEditIndicators() {
    const stored = readStoredCode(selectedSource);
    const edited = codeElement.value !== bundledCodeForSource;
    if (codeEditFlag) codeEditFlag.hidden = !edited;
    if (restoreCode) restoreCode.hidden = !edited && (stored === null || stored === bundledCodeForSource);
  }

  function updateCodeCursor() {
    if (!codeCursorStatus) return;
    const before = codeElement.value.slice(0, codeElement.selectionStart);
    const rows = before.split("\n");
    codeCursorStatus.textContent = `Linha ${rows.length} · Coluna ${rows.at(-1).length + 1}`;
  }

  function prepareCodeDownload(code, filename) {
    if (downloadObjectUrl) URL.revokeObjectURL(downloadObjectUrl);
    downloadObjectUrl = URL.createObjectURL(new Blob([code], { type: "text/x-arduino;charset=utf-8" }));
    downloadCode.href = downloadObjectUrl;
    downloadCode.setAttribute("download", filename);
  }

  async function loadArduinoCode(tab) {
    const source = tab.dataset.codeSource;
    const filename = tab.dataset.filename;
    selectedProgram = programFromSource(source);
    selectedSource = source;
    selectedFilename = filename;
    if (runCode) {
      runCode.textContent = PROGRAM_LABELS[selectedProgram];
      runCode.dataset.program = selectedProgram;
    }
    document.querySelectorAll(".code-tab").forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    document.getElementById("codeViewer")?.setAttribute("aria-labelledby", tab.id);
    codeFilename.textContent = filename;
    codeStatus.textContent = "CARREGANDO";
    codeElement.value = "Carregando código…";
    const bundledCode = window.QUANTUM_ARDUINO_CODES?.[source];
    if (bundledCode) {
      bundledCodeForSource = bundledCode;
      const stored = readStoredCode(source);
      const edited = stored !== null && stored !== bundledCode;
      codeElement.value = edited ? stored : bundledCode;
      codeStatus.textContent = edited ? "EDITADO NESTE NAVEGADOR" : "PRONTO · INTEGRADO";
      updateEditIndicators();
      prepareCodeDownload(codeElement.value, filename);
      return;
    }
    try {
      const response = await fetch(new URL(source, document.baseURI));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bundledCodeForSource = await response.text();
      const stored = readStoredCode(source);
      const edited = stored !== null && stored !== bundledCodeForSource;
      codeElement.value = edited ? stored : bundledCodeForSource;
      codeStatus.textContent = edited ? "EDITADO NESTE NAVEGADOR" : "PRONTO";
      updateEditIndicators();
      prepareCodeDownload(codeElement.value, filename);
    } catch (error) {
      bundledCodeForSource = "";
      codeElement.value = `Não foi possível carregar ${filename}. Abra o site publicado ou tente novamente.\n\nDetalhe: ${error.message}`;
      codeStatus.textContent = "ERRO";
    }
  }

  const codeTabs = [...document.querySelectorAll(".code-tab")];
  codeTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => loadArduinoCode(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? codeTabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + codeTabs.length) % codeTabs.length;
      codeTabs[nextIndex].focus();
      loadArduinoCode(codeTabs[nextIndex]);
    });
  });
  runCode?.addEventListener("click", async () => {
    const robot = window.quantumRobot;
    if (!robot?.runProgram) {
      codeStatus.textContent = "CONTROLE USB INDISPONÍVEL";
      return;
    }
    if (selectedProgram === "motores") {
      const confirmed = window.confirm("Levante as rodas do chão. O teste ligará os dois motores, inverterá o sentido e fará curvas. Deseja rodar agora?");
      if (!confirmed) return;
    }

    const idleLabel = PROGRAM_LABELS[selectedProgram];
    runCode.disabled = true;
    runCode.textContent = robot.connected ? "Iniciando…" : "Conectando…";
    codeStatus.textContent = robot.connected ? "INICIANDO" : "SELECIONE A PORTA USB";

    try {
      const result = await robot.runProgram(selectedProgram);
      if (selectedProgram === "principal") codeStatus.textContent = "RODANDO · AUTÔNOMO";
      else if (selectedProgram === "motores") codeStatus.textContent = "TESTE CONCLUÍDO · MOTORES PARADOS";
      else codeStatus.textContent = "SENSOR ATIVO · VEJA A DISTÂNCIA NO PAINEL";
      runCode.textContent = result?.label || idleLabel;
    } catch (error) {
      codeStatus.textContent = "NÃO FOI POSSÍVEL RODAR";
      window.alert(error?.message || "Falha ao iniciar o código selecionado.");
    } finally {
      runCode.disabled = false;
      window.setTimeout(() => { runCode.textContent = idleLabel; }, 1800);
    }
  });

  copyCode.addEventListener("click", async () => {
    if (!codeElement.value) return;
    try {
      await navigator.clipboard.writeText(codeElement.value);
      copyCode.textContent = "Copiado!";
      setTimeout(() => { copyCode.textContent = "Copiar código"; }, 1600);
    } catch {
      codeElement.focus();
      codeElement.select();
      copyCode.textContent = "Código selecionado";
      setTimeout(() => { copyCode.textContent = "Copiar código"; }, 1600);
    }
  });

  downloadCode.addEventListener("click", () => {
    prepareCodeDownload(codeElement.value, selectedFilename || "sketch.ino");
  });

  saveCode?.addEventListener("click", () => {
    if (!selectedSource) return;
    writeStoredCode(selectedSource, codeElement.value);
    updateEditIndicators();
    const original = saveCode.textContent;
    saveCode.textContent = "Salvo neste navegador";
    codeStatus.textContent = codeElement.value === bundledCodeForSource ? "PRONTO · INTEGRADO" : "EDITADO NESTE NAVEGADOR";
    setTimeout(() => { saveCode.textContent = original; }, 1600);
  });

  codeElement?.addEventListener("input", () => {
    updateEditIndicators();
    prepareCodeDownload(codeElement.value, selectedFilename || "sketch.ino");
    codeStatus.textContent = codeElement.value === bundledCodeForSource ? "PRONTO · INTEGRADO" : "EDIÇÃO NÃO SALVA";
    updateCodeCursor();
  });
  codeElement?.addEventListener("click", updateCodeCursor);
  codeElement?.addEventListener("keyup", updateCodeCursor);
  codeElement?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveCode?.click();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const start = codeElement.selectionStart;
    const end = codeElement.selectionEnd;
    codeElement.setRangeText("  ", start, end, "end");
    codeElement.dispatchEvent(new Event("input", { bubbles: true }));
  });

  restoreCode?.addEventListener("click", () => {
    if (!selectedSource) return;
    clearStoredCode(selectedSource);
    codeElement.value = bundledCodeForSource;
    codeStatus.textContent = "PRONTO · INTEGRADO";
    updateEditIndicators();
    prepareCodeDownload(codeElement.value, selectedFilename);
  });

  // Painel "Comandos & configurações": edita web/user-config.js (localStorage),
  // lido pela detecção de gestos na próxima vez que a página carregar.
  (function setupConfigPanel() {
    const configApi = window.QuantumUserConfig;
    if (!configApi) return;
    const fingerSelects = [1, 2, 3, 4, 5].map((finger) => document.getElementById(`gestureMap${finger}`));
    const confidenceInput = document.getElementById("configMinConfidence");
    const cooldownInput = document.getElementById("configCooldown");
    const unstableInput = document.getElementById("configUnstable");
    const saveConfigButton = document.getElementById("saveConfig");
    const resetConfigButton = document.getElementById("resetConfig");
    const statusElement = document.getElementById("configStatus");
    if (!saveConfigButton || !resetConfigButton) return;

    fingerSelects.forEach((select) => {
      if (!select) return;
      configApi.validCommands.forEach((command) => {
        const option = document.createElement("option");
        option.value = command;
        option.textContent = command;
        select.appendChild(option);
      });
    });

    function populate(config) {
      fingerSelects.forEach((select, index) => {
        if (select) select.value = config.gestureMap[index + 1];
      });
      if (confidenceInput) confidenceInput.value = Math.round(config.minConfidence * 100);
      if (cooldownInput) cooldownInput.value = config.commandCooldownMs;
      if (unstableInput) unstableInput.value = config.unstableStopMs;
      if (statusElement) {
        statusElement.textContent = configApi.isCustomized()
          ? "Usando configurações salvas neste navegador."
          : "Usando valores padrão.";
      }
    }

    populate(configApi.get());

    saveConfigButton.addEventListener("click", () => {
      const gestureMap = {};
      fingerSelects.forEach((select, index) => {
        if (select) gestureMap[index + 1] = select.value;
      });
      configApi.save({
        gestureMap,
        minConfidence: Number(confidenceInput?.value) / 100,
        commandCooldownMs: Number(cooldownInput?.value),
        unstableStopMs: Number(unstableInput?.value),
      });
      populate(configApi.get());
      if (statusElement) statusElement.textContent = "Salvo! Recarregue a página (F5) para aplicar aos gestos.";
    });

    resetConfigButton.addEventListener("click", () => {
      populate(configApi.reset());
      if (statusElement) statusElement.textContent = "Restaurado ao padrão. Recarregue a página (F5) para aplicar.";
    });
  })();

  window.addEventListener("resize", () => { resizeCanvas(); if (!world.running) draw(); });
  document.addEventListener("visibilitychange", scheduleAnimation);
  const simulatorSection = document.getElementById("simulador");
  if ("IntersectionObserver" in window && simulatorSection) {
    new IntersectionObserver(([entry]) => {
      simulatorVisible = entry.isIntersecting;
      if (!simulatorVisible && animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      scheduleAnimation();
    }, { rootMargin: "180px" }).observe(simulatorSection);
  }
  const firstCodeTab = document.querySelector(".code-tab");
  if (firstCodeTab) loadArduinoCode(firstCodeTab);
  resizeCanvas();
  resetWorld();
  setMenuOpen(false);
  window.QuantumSimulator = Object.freeze({
    setMode: setSimulatorMode,
    setCommand: setSimulatorCommand,
    reset: resetWorld,
    snapshot: () => ({ ...simulatorCommands.snapshot(), robot: { ...world.robot }, events: world.events }),
  });
})();
