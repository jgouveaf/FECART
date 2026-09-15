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
  const testTargetSimulatorButton = document.getElementById("testTargetSimulator");
  const testTargetArduinoButton = document.getElementById("testTargetArduino");
  const testConnectArduinoButton = document.getElementById("testConnectArduino");
  const testTargetStatus = document.getElementById("testTargetStatus");
  const testEnvironmentValue = document.getElementById("testEnvironmentValue");
  const testCanvasBadge = document.getElementById("testCanvasBadge");

  const world = new window.QuantumSimulatorWorld.World();
  let simulation3D = null, simulationLoading = null;
  function ensureSimulation3D() {
    if (simulation3D || simulationLoading || !simulatorVisible) return;
    simulationLoading = window.QuantumSimulator3D.create(document.getElementById('simulationViewport'), world)
      .then(view => { simulation3D = view; draw(); })
      .catch(error => { document.getElementById('simGraphicsStatus').textContent = '3D indisponível · visão superior ativa'; console.warn('Simulador 3D:', error.message); });
  }
  const simulatorCommands = new window.QuantumSimulatorController.SimulatorCommandController(900);
  let simulatorVisible = !('IntersectionObserver' in window);
  let animationFrame = 0;
  let lastSimulatorUiSignature = "";
  let testTarget = "simulator";

  const ROBOT_MODE_BY_SIMULATOR_MODE = Object.freeze({ AUTONOMO: 1, SEGUIR: 2, GESTOS: 3 });

  function robotTestState() {
    const robot = window.quantumRobot;
    const central = window.QuantumControl?.state;
    return {
      available: Boolean(robot),
      connected: Boolean(robot?.connected),
      emergency: Boolean(central?.safety?.emergency),
      transitioning: central?.mode?.phase === "PREPARING",
    };
  }

  function renderTestTarget() {
    const robotState = robotTestState();
    const physical = testTarget === "arduino";
    testTargetSimulatorButton.classList.toggle("active", !physical);
    testTargetArduinoButton.classList.toggle("active", physical);
    testTargetSimulatorButton.setAttribute("aria-pressed", String(!physical));
    testTargetArduinoButton.setAttribute("aria-pressed", String(physical));
    testConnectArduinoButton.hidden = !physical || robotState.connected;
    testEnvironmentValue.textContent = physical ? (robotState.connected ? "ARDUINO USB" : "ARDUINO OFFLINE") : "VIRTUAL";
    testCanvasBadge.textContent = physical ? "PRÉVIA + ARDUINO" : "SIMULAÇÃO ATIVA";
    if (!physical) testTargetStatus.textContent = "Somente a prévia virtual receberá os comandos.";
    else if (!robotState.available) testTargetStatus.textContent = "Controle USB ainda não carregou. Atualize a página.";
    else if (!robotState.connected) testTargetStatus.textContent = "Arduino desconectado. Clique em “Conectar Arduino”.";
    else if (robotState.transitioning) testTargetStatus.textContent = "Arduino conectado · aguardando confirmação da troca de modo.";
    else if (robotState.emergency) testTargetStatus.textContent = "Arduino conectado, mas bloqueado por segurança. Confira as rodas e libere o ESTOP no painel abaixo.";
    else testTargetStatus.textContent = "Arduino conectado · os botões e o teclado enviam comandos reais por cerca de 1 segundo.";
  }

  function setTestTarget(target) {
    if (!["simulator", "arduino"].includes(target)) return false;
    testTarget = target;
    lastSimulatorUiSignature = "";
    renderTestTarget();
    renderSimulatorControls();
    return true;
  }

  function sendModeToArduino(mode) {
    if (testTarget !== "arduino") return true;
    const robot = window.quantumRobot;
    if (!robot?.connected) {
      renderTestTarget();
      return false;
    }
    const accepted = robot.requestMode(ROBOT_MODE_BY_SIMULATOR_MODE[mode], "test-panel");
    testTargetStatus.textContent = accepted
      ? `Solicitando modo ${mode} ao Arduino…`
      : `Modo ${mode} já selecionado. Se estiver bloqueado, libere o ESTOP no painel abaixo.`;
    return accepted;
  }

  function sendCommandToArduino(command, source) {
    if (testTarget !== "arduino" || source === "GESTO") return true;
    const robot = window.quantumRobot;
    if (!robot?.connected) {
      renderTestTarget();
      return false;
    }
    const accepted = robot.send(command);
    testTargetStatus.textContent = accepted
      ? `${command} enviado ao Arduino · o comando expira automaticamente se não for repetido.`
      : `${command} não foi enviado. Confira conexão, modo, sensor e ESTOP.`;
    return accepted;
  }

  function renderSimulatorControls(now = performance.now()) {
    const state = simulatorCommands.snapshot(now);
    const robotState = robotTestState();
    const signature = `${state.mode}|${state.command}|${state.source}|${testTarget}|${robotState.connected}|${robotState.emergency}|${robotState.transitioning}`;
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
    const targetLabel = testTarget === "arduino" ? "Arduino e prévia" : "Simulador";
    simulatorHint.textContent = state.mode === "AUTONOMO"
      ? `${targetLabel}: autônomo ativo · o sensor desvia dos obstáculos. Teclado: 1–5 ou setas.`
      : state.mode === "SEGUIR"
        ? testTarget === 'simulator' ? 'Segue a pessoa escolhida neste cenário. Se ela sair de vista ou ficar atrás de um obstáculo, para.'
          : "Seguir pessoa · recebe a direção da câmera; sem alvo reconhecido, para."
      : state.source === "GESTO"
        ? `Gesto recebido · ${state.command}. Sem gesto novo por 0,9 s, o simulador para.`
        : `${state.source === "TECLADO" ? "Teclado" : "Teste manual"} · ${state.command}. Os gestos da câmera também controlam esta arena.`;
  }

  function setSimulatorMode(mode) {
    simulatorCommands.setMode(mode);
    world.resetControl();
    world.robot.avoidance = null;
    renderSimulatorControls();
    scheduleAnimation();
    sendModeToArduino(mode);
  }

  function setSimulatorCommand(command, source = "TESTE") {
    if (!simulatorCommands.setCommand(command, source)) return false;
    if (command === "PARAR") world.robot.avoidance = null;
    renderSimulatorControls();
    scheduleAnimation();
    sendCommandToArduino(command, source);
    return true;
  }

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(640, Math.round(rect.width * ratio));
    canvas.height = Math.max(330, Math.round(rect.height * ratio));
    ctx.setTransform(canvas.width / world.width, 0, 0, canvas.height / world.height, 0, 0);
  }

  function resetWorld() {
    world.reset();
    simulatorCommands.setMode("AUTONOMO");
    world.lastTime = performance.now();
    toggleButton.textContent = "Pausar";
    renderPeopleControls();
    renderSimulatorControls();
    scheduleAnimation();
    draw();
  }

  function rayDistance() { return world.sensor(); }

  function update(dt, time) {
    const mode = simulatorCommands.snapshot(time).mode;
    const virtualFollow = mode === 'SEGUIR' && testTarget === 'simulator';
    const result = world.step(dt, { mode, command: simulatorCommands.current(time), virtualFollow });
    if (virtualFollow) simulatorCommands.setCommand(result.command, 'PESSOA VIRTUAL', time);
    stateValue.textContent = result.state;
    commandValue.textContent = result.command;
    distanceValue.textContent = `${Math.round(result.distance)} cm`;
    safetyValue.textContent = result.safety;
    eventValue.textContent = String(world.events);
    document.getElementById('simWheelLeft').textContent = `${Math.round(result.left)} cm/s`;
    document.getElementById('simWheelRight').textContent = `${Math.round(result.right)} cm/s`;
    renderSimulatorControls(time);
  }

  function renderPeopleControls() {
    const select = document.getElementById('simPersonSelect');
    select.replaceChildren(...world.people.map(p => { const option = document.createElement('option'); option.value=p.id; option.textContent=p.name; return option; }));
    select.value = world.targetId;
    document.getElementById('simPeopleVisibility').textContent = world.peopleVisible ? 'Ocultar pessoas' : 'Mostrar pessoas';
    document.getElementById('simPeopleMotion').textContent = world.peopleMoving ? 'Pausar pessoas' : 'Mover pessoas';
    document.getElementById('simAddPerson').disabled = world.people.length >= 5;
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
    ensureSimulation3D();
    drawGrid();
    world.obstacles.forEach((o, index) => {
      const gradient = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
      gradient.addColorStop(0, "#15263c"); gradient.addColorStop(1, "#0a1422");
      ctx.fillStyle = gradient; ctx.strokeStyle = "#294462"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#59728e"; ctx.font = "700 10px system-ui"; ctx.fillText(`OBSTÁCULO ${index + 1}`, o.x + 10, o.y + 20);
    });
    if (world.peopleVisible) for (const p of world.people) {
      ctx.fillStyle = p.id === world.targetId ? '#31e6a1' : '#efb96a';ctx.beginPath();ctx.arc(p.x,p.y,18,0,Math.PI*2);ctx.fill();
      ctx.font='600 13px system-ui';ctx.fillText(p.name,p.x-15,p.y-24);
    }
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
    simulation3D?.render(performance.now(), !world.running);
  }

  function loop(time) {
    animationFrame = 0;
    if (!world.running || !simulatorVisible || document.hidden) return;
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
      world.robot.left = 0; world.robot.right = 0;
      draw();
    } else scheduleAnimation();
  });
  resetButton.addEventListener("click", resetWorld);
  function setSimulationView(view) {
    ensureSimulation3D();
    simulationLoading?.then(() => { simulation3D?.setView(view);simulation3D?.render(performance.now(),true); });
    document.getElementById('simViewFirst').setAttribute('aria-pressed',String(view==='first'));
    document.getElementById('simViewThird').setAttribute('aria-pressed',String(view==='third'));
    document.getElementById('simViewFirst').classList.toggle('active',view==='first');
    document.getElementById('simViewThird').classList.toggle('active',view==='third');
  }
  document.getElementById('simViewFirst').addEventListener('click',()=>setSimulationView('first'));
  document.getElementById('simViewThird').addEventListener('click',()=>setSimulationView('third'));
  document.getElementById('simFullscreen').addEventListener('click',async()=>{
    try {if(document.fullscreenElement) await document.exitFullscreen();else {await document.getElementById('simulationViewport').requestFullscreen();document.getElementById('simulationViewport').focus();}}
    catch {document.getElementById('simGraphicsStatus').textContent='Tela cheia indisponível neste navegador';}
  });
  document.getElementById('simPersonSelect').addEventListener('change',e=>{world.selectPerson(e.target.value);world.resetControl();draw();});
  document.getElementById('simPeopleVisibility').addEventListener('click',()=>{world.peopleVisible=!world.peopleVisible;renderPeopleControls();draw();});
  document.getElementById('simPeopleMotion').addEventListener('click',()=>{world.peopleMoving=!world.peopleMoving;renderPeopleControls();draw();});
  document.getElementById('simAddPerson').addEventListener('click',()=>{world.addPerson();renderPeopleControls();draw();});
  document.getElementById('simulationViewport').addEventListener('viewinput',draw);
  window.addEventListener('pagehide',()=>simulation3D?.dispose());
  testTargetSimulatorButton.addEventListener("click", () => setTestTarget("simulator"));
  testTargetArduinoButton.addEventListener("click", () => setTestTarget("arduino"));
  testConnectArduinoButton.addEventListener("click", async () => {
    testConnectArduinoButton.disabled = true;
    testTargetStatus.textContent = "Selecione a porta USB do Arduino…";
    try {
      await window.quantumRobot?.connect();
    } finally {
      testConnectArduinoButton.disabled = false;
      lastSimulatorUiSignature = "";
      renderTestTarget();
      renderSimulatorControls();
    }
  });
  autonomousModeButton.addEventListener("click", () => setSimulatorMode("AUTONOMO"));
  followModeButton.addEventListener("click", () => setSimulatorMode("SEGUIR"));
  gestureModeButton.addEventListener("click", () => setSimulatorMode("GESTOS"));
  simulatorCommandButtons.forEach((button) => button.addEventListener("click", () => {
    setSimulatorCommand(button.dataset.simulatorCommand, "TESTE");
  }));
  const simulatorKeyboardCommands = Object.freeze({
    "1": "FRENTE", ArrowUp: "FRENTE", w: "FRENTE", W: "FRENTE",
    "2": "DIREITA", ArrowRight: "DIREITA", d: "DIREITA", D: "DIREITA",
    "3": "ESQUERDA", ArrowLeft: "ESQUERDA", a: "ESQUERDA", A: "ESQUERDA",
    "4": "TRAS", ArrowDown: "TRAS",
    s: "PARAR", S: "PARAR", " ": "PARAR",
    "5": "GIRAR", g: "GIRAR", G: "GIRAR",
  });
  for (const keyboardArea of [simulatorCommandPanel, document.getElementById('simulationViewport')]) keyboardArea.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest?.('select,input,textarea') || event.key === 'Enter'
      || event.key === ' ' && event.target.closest?.('button')) return;
    const command = simulatorKeyboardCommands[event.key];
    if (!command) return;
    event.preventDefault();
    if (simulatorCommands.snapshot().mode !== "GESTOS") setSimulatorMode("GESTOS");
    setSimulatorCommand(command, "TECLADO");
  });
  window.addEventListener("quantum:gesture-command", (event) => {
    const detail = event.detail || {};
    if (!detail.command || (detail.command !== "PARAR" && detail.stable !== true)) return;
    setSimulatorCommand(detail.command, "GESTO");
  });
  window.addEventListener("quantum:person-tracking", (event) => {
    if (testTarget !== 'arduino' || simulatorCommands.snapshot().mode !== "SEGUIR") return;
    const detail = event.detail || {};
    simulatorCommands.setCommand(detail.visible ? detail.command : "PARAR", "ROSTO");
    renderSimulatorControls();
  });
  window.addEventListener("quantum:state-changed", () => {
    lastSimulatorUiSignature = "";
    renderTestTarget();
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
  const updateCode = document.getElementById("updateCode");
  const codeFileInput = document.getElementById("codeFileInput");
  const saveCode = document.getElementById("saveCode");
  const restoreCode = document.getElementById("restoreCode");
  const codeEditFlag = document.getElementById("codeEditFlag");
  let bundledCodeForSource = "";
  let selectedProgram = "principal";
  let selectedSource = "";
  let selectedFilename = "";
  let downloadObjectUrl = "";
  let codeLoadGeneration = 0;

  const codeEditorUtils = window.QuantumCodeEditorUtils;
  const MAX_CODE_FILE_BYTES = codeEditorUtils.MAX_CODE_FILE_BYTES;

  const PROGRAM_LABELS = Object.freeze({
    principal: "Ativar Modo 1",
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
      return window.localStorage.getItem(CODE_EDIT_PREFIX + source) === code;
    } catch {
      return false;
    }
  }

  function clearStoredCode(source) {
    try {
      window.localStorage.removeItem(CODE_EDIT_PREFIX + source);
      return window.localStorage.getItem(CODE_EDIT_PREFIX + source) === null;
    } catch {
      return false;
    }
  }

  function persistedCode() {
    const stored = readStoredCode(selectedSource);
    return stored === null ? bundledCodeForSource : stored;
  }

  function codeHasUnsavedChanges() {
    return Boolean(selectedSource) && codeElement.value !== persistedCode();
  }

  const validateArduinoCode = codeEditorUtils.validateArduinoCode;

  function updateEditIndicators() {
    const stored = readStoredCode(selectedSource);
    const customized = stored !== null && stored !== bundledCodeForSource;
    const dirty = codeHasUnsavedChanges();
    if (codeEditFlag) {
      codeEditFlag.hidden = !customized && !dirty;
      codeEditFlag.textContent = dirty ? "Alterações não salvas" : "Edição salva neste navegador";
      codeEditFlag.classList.toggle("saved", customized && !dirty);
    }
    if (restoreCode) restoreCode.hidden = !customized && !dirty;
    if (saveCode) saveCode.disabled = !dirty;
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
    if (source !== selectedSource && codeHasUnsavedChanges()
      && !window.confirm("Há alterações não salvas no código atual. Deseja descartá-las e trocar de aba?")) return false;
    const generation = ++codeLoadGeneration;
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
      return true;
    }
    try {
      const response = await fetch(new URL(source, document.baseURI));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bundledCodeForSource = await response.text();
      if (generation !== codeLoadGeneration) return false;
      const stored = readStoredCode(source);
      const edited = stored !== null && stored !== bundledCodeForSource;
      codeElement.value = edited ? stored : bundledCodeForSource;
      codeStatus.textContent = edited ? "EDITADO NESTE NAVEGADOR" : "PRONTO";
      updateEditIndicators();
      prepareCodeDownload(codeElement.value, filename);
      return true;
    } catch (error) {
      bundledCodeForSource = "";
      codeElement.value = `Não foi possível carregar ${filename}. Abra o site publicado ou tente novamente.\n\nDetalhe: ${error.message}`;
      codeStatus.textContent = "ERRO";
      return false;
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
  codeElement.addEventListener("input", () => {
    const validationError = validateArduinoCode(codeElement.value);
    codeStatus.textContent = validationError ? "EDIÇÃO INCOMPLETA" : "ALTERAÇÕES NÃO SALVAS";
    updateEditIndicators();
    prepareCodeDownload(codeElement.value, selectedFilename || "sketch.ino");
  });

  updateCode?.addEventListener("click", () => codeFileInput?.click());
  codeFileInput?.addEventListener("change", async () => {
    const file = codeFileInput.files?.[0];
    codeFileInput.value = "";
    if (!file) return;
    if (file.size > MAX_CODE_FILE_BYTES) {
      codeStatus.textContent = "ARQUIVO MUITO GRANDE";
      window.alert("Escolha um arquivo .ino ou .txt de até 256 KB.");
      return;
    }
    try {
      const imported = codeEditorUtils.normalizeImportedCode(await file.text());
      const validationError = validateArduinoCode(imported);
      if (validationError) throw new Error(validationError);
      if (codeHasUnsavedChanges()
        && !window.confirm("Substituir as alterações ainda não salvas pelo arquivo escolhido?")) return;
      codeElement.value = imported;
      codeStatus.textContent = "IMPORTADO · SALVE A EDIÇÃO";
      updateEditIndicators();
      prepareCodeDownload(imported, selectedFilename || file.name || "sketch.ino");
      codeElement.focus();
    } catch (error) {
      codeStatus.textContent = "ARQUIVO INVÁLIDO";
      window.alert(`Não foi possível atualizar o código: ${error.message}`);
    }
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
      runCode.textContent = idleLabel;
      window.alert(error?.message || "Falha ao iniciar o código selecionado.");
    } finally {
      runCode.disabled = false;
      // Iniciar o modo não é um teste com duração limitada. Não trocar o
      // rótulo por temporizador: isso parecia encerrar o autônomo em 1,8 s.
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
    const validationError = validateArduinoCode(codeElement.value);
    if (validationError) {
      codeStatus.textContent = "CÓDIGO INCOMPLETO";
      window.alert(validationError);
      return;
    }
    if (!writeStoredCode(selectedSource, codeElement.value)) {
      codeStatus.textContent = "NÃO FOI POSSÍVEL SALVAR";
      window.alert("O navegador bloqueou o armazenamento local ou está sem espaço. Baixe o arquivo para não perder as alterações.");
      return;
    }
    updateEditIndicators();
    const original = saveCode.textContent;
    saveCode.textContent = "Salvo neste navegador";
    codeStatus.textContent = codeElement.value === bundledCodeForSource ? "PRONTO · INTEGRADO" : "EDITADO NESTE NAVEGADOR";
    setTimeout(() => { saveCode.textContent = original; }, 1600);
  });

  restoreCode?.addEventListener("click", () => {
    if (!selectedSource) return;
    if (!window.confirm("Restaurar o código original desta aba? A edição local será descartada.")) return;
    if (!clearStoredCode(selectedSource)) {
      codeStatus.textContent = "NÃO FOI POSSÍVEL RESTAURAR";
      return;
    }
    codeElement.value = bundledCodeForSource;
    codeStatus.textContent = "PRONTO · INTEGRADO";
    updateEditIndicators();
    prepareCodeDownload(codeElement.value, selectedFilename);
  });

  window.addEventListener("beforeunload", (event) => {
    if (!codeHasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  document.getElementById("logoutButton")?.addEventListener("click", () => {
    if (codeHasUnsavedChanges() && !window.confirm("Há alterações de código não salvas. Sair mesmo assim?")) return;
    window.QuantumAuthGate?.lock();
  });

  // Painel "Comandos & configurações": edita web/user-config.js (localStorage),
  // aplicado imediatamente pela detecção de gestos e persistido localmente.
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
        option.textContent = command === "TRAS" ? "RÉ" : command;
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
      if (statusElement) statusElement.textContent = configApi.wasLastSavePersistent()
        ? "Salvo e aplicado aos gestos agora."
        : "Aplicado nesta sessão, mas o navegador bloqueou o armazenamento permanente.";
    });

    resetConfigButton.addEventListener("click", () => {
      populate(configApi.reset());
      if (statusElement) statusElement.textContent = "Restaurado e aplicado ao padrão agora.";
    });
  })();

  window.addEventListener("resize", () => { resizeCanvas(); if (!world.running) draw(); });
  document.addEventListener("visibilitychange", scheduleAnimation);
  const simulatorSection = document.getElementById("simulationViewport");
  if ("IntersectionObserver" in window && simulatorSection) {
    new IntersectionObserver(([entry]) => {
      simulatorVisible = entry.isIntersecting && entry.intersectionRatio >= .1;
      if (simulatorVisible) ensureSimulation3D();
      if (!simulatorVisible && animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      scheduleAnimation();
    }, { threshold: [0,.1] }).observe(simulatorSection);
  }
  const firstCodeTab = document.querySelector(".code-tab");
  if (firstCodeTab) loadArduinoCode(firstCodeTab);
  resizeCanvas();
  resetWorld();
  setMenuOpen(false);
  window.QuantumSimulator = Object.freeze({
    setMode: setSimulatorMode,
    setCommand: setSimulatorCommand,
    setTarget: setTestTarget,
    reset: resetWorld,
    snapshot: () => ({ ...simulatorCommands.snapshot(), target: testTarget, robot: { ...world.robot }, events: world.events,
      scene: { ...world.output }, people: world.people.map(p=>({id:p.id,name:p.name,x:p.x,y:p.y})),
      view:document.getElementById('simulationViewport').dataset.view, graphicsReady:Boolean(simulation3D?.ready) }),
  });
})();
