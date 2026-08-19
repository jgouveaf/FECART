const video = document.getElementById("cameraVideo");
const canvas = document.getElementById("gestureCanvas");
const context = canvas.getContext("2d");
const stage = document.getElementById("cameraStage");
const startButton = document.getElementById("startCamera");
const stopButton = document.getElementById("stopCamera");
const statusElement = document.getElementById("cameraStatus");
const statusDot = document.getElementById("cameraDot");
const commandElement = document.getElementById("gestureCommand");
const countElement = document.getElementById("fingerCount");
const cameraPanel = document.getElementById("camera-gestos");
const facePanel = document.getElementById("faceCameraPanel");
const gesturePanel = document.getElementById("gestureCameraPanel");
const cameraTabs = document.querySelectorAll(".camera-view-tab");

const COMMANDS = {
  1: "FRENTE",
  2: "DIREITA",
  3: "ESQUERDA",
  4: "PARAR",
  5: "GIRAR",
};

const VISION_SOURCES = [
  {
    module: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs",
    wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
  },
  {
    module: "https://unpkg.com/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs",
    wasm: "https://unpkg.com/@mediapipe/tasks-vision@1.0.1/wasm",
  },
];

const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17],
];

let handLandmarker = null;
let stream = null;
let running = false;
let animationId = 0;
let lastVideoTime = -1;
let lastInferenceAt = 0;
let pendingCount = 0;
let pendingFrames = 0;
let stableCount = 0;
let activeView = "face";
let lastGestureAt = 0;
let lastDispatchAt = 0;
let lastDispatchedCommand = "";

function setStatus(text, active = false) {
  statusElement.textContent = text;
  statusDot.classList.toggle("idle", !active);
}

function setGesture(count, stable = false) {
  document.querySelectorAll(".gesture-map [data-fingers]").forEach((item) => {
    item.classList.toggle("active", stable && Number(item.dataset.fingers) === count);
  });
  if (!stable || !COMMANDS[count]) {
    commandElement.textContent = "ANALISANDO";
    countElement.textContent = count ? `${count} dedo(s) — mantenha a mão firme` : "Nenhuma mão detectada";
    return;
  }
  commandElement.textContent = COMMANDS[count];
  countElement.textContent = `${count} dedo(s) reconhecido(s) · comando pronto`;
  lastGestureAt = performance.now();
  const command = COMMANDS[count];
  if (command !== lastDispatchedCommand || command === "PARAR" || performance.now() - lastDispatchAt >= 450) {
    lastDispatchedCommand = command;
    lastDispatchAt = performance.now();
    window.dispatchEvent(new CustomEvent("quantum:gesture-command", { detail: { command, count, stable: true } }));
  }
}

function stopGestureOutput() {
  lastDispatchedCommand = "PARAR";
  lastDispatchAt = performance.now();
  window.dispatchEvent(new CustomEvent("quantum:gesture-command", { detail: { command: "PARAR", count: 0, stable: false } }));
}

function classifyFingerCount(landmarks, handedness) {
  const fingers = [
    landmarks[8].y < landmarks[6].y,
    landmarks[12].y < landmarks[10].y,
    landmarks[16].y < landmarks[14].y,
    landmarks[20].y < landmarks[18].y,
  ];
  let thumb = false;
  if (handedness === "Right") thumb = landmarks[4].x < landmarks[3].x;
  if (handedness === "Left") thumb = landmarks[4].x > landmarks[3].x;
  return fingers.filter(Boolean).length + Number(thumb);
}

function stabilizeCount(count) {
  if (count === 4) {
    pendingCount = 4;
    pendingFrames = 3;
    stableCount = 4;
    return true;
  }
  if (count === pendingCount) pendingFrames += 1;
  else { pendingCount = count; pendingFrames = 1; }
  if (pendingFrames >= 3) stableCount = count;
  return pendingFrames >= 3 && stableCount === count;
}

function drawHand(landmarks) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineWidth = 3;
  context.strokeStyle = "#21d4fd";
  context.fillStyle = "#31e6a1";
  for (const [from, to] of CONNECTIONS) {
    context.beginPath();
    context.moveTo(landmarks[from].x * canvas.width, landmarks[from].y * canvas.height);
    context.lineTo(landmarks[to].x * canvas.width, landmarks[to].y * canvas.height);
    context.stroke();
  }
  for (const point of landmarks) {
    context.beginPath();
    context.arc(point.x * canvas.width, point.y * canvas.height, 5, 0, Math.PI * 2);
    context.fill();
  }
}

async function initializeModel() {
  if (handLandmarker) return;
  const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
  let lastError = null;

  for (let index = 0; index < VISION_SOURCES.length; index += 1) {
    const source = VISION_SOURCES[index];
    setStatus(`CÂMERA ATIVA · CARREGANDO IA ${index + 1}/${VISION_SOURCES.length}`, true);
    try {
      const { FilesetResolver, HandLandmarker } = await import(source.module);
      const vision = await FilesetResolver.forVisionTasks(source.wasm);
      const options = {
        baseOptions: { modelAssetPath, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.55,
      };
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      } catch {
        options.baseOptions.delegate = "CPU";
        handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      }
      return;
    } catch (error) {
      lastError = error;
      console.warn(`MediaPipe não carregou por ${source.module}`, error);
    }
  }

  throw new Error(lastError?.message || "Não foi possível carregar a inteligência de gestos.");
}

function processFrame(now) {
  if (!running || activeView !== "hand") return;
  animationId = requestAnimationFrame(processFrame);
  if (video.readyState < 2 || video.currentTime === lastVideoTime || now - lastInferenceAt < 70) return;
  lastVideoTime = video.currentTime;
  lastInferenceAt = now;
  const result = handLandmarker.detectForVideo(video, now);
  if (!result.landmarks?.length) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    pendingFrames = 0;
    stableCount = 0;
    setGesture(0, false);
    if (performance.now() - lastGestureAt > 700 && lastDispatchedCommand !== "PARAR") stopGestureOutput();
    return;
  }
  const landmarks = result.landmarks[0];
  const handedness = result.handedness?.[0]?.[0]?.categoryName || "";
  drawHand(landmarks);
  const count = classifyFingerCount(landmarks, handedness);
  setGesture(count, stabilizeCount(count));
}

async function setCameraView(view) {
  activeView = view === "hand" ? "hand" : "face";
  cameraPanel.dataset.cameraView = activeView;
  cameraTabs.forEach((button) => {
    const selected = button.dataset.cameraView === activeView;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  facePanel.hidden = activeView !== "face";
  gesturePanel.hidden = activeView !== "hand";
  cancelAnimationFrame(animationId);
  context.clearRect(0, 0, canvas.width, canvas.height);
  window.dispatchEvent(new CustomEvent("quantum:camera-view-changed", { detail: { view: activeView } }));
  if (!running) return;
  if (activeView === "face") {
    stopGestureOutput();
    setStatus("CÂMERA FACIAL ATIVA", true);
    return;
  }
  setStatus("CÂMERA ATIVA · CARREGANDO GESTOS", true);
  commandElement.textContent = "CARREGANDO";
  countElement.textContent = "Preparando o reconhecimento da mão…";
  try {
    await initializeModel();
    if (!running || activeView !== "hand") return;
    setStatus("CÂMERA DE GESTOS ATIVA", true);
    animationId = requestAnimationFrame(processFrame);
  } catch (error) {
    setStatus("CÂMERA ATIVA · GESTOS INDISPONÍVEIS", true);
    commandElement.textContent = "ERRO";
    countElement.textContent = `Não foi possível carregar os gestos: ${error.message}`;
  }
}

async function startCamera() {
  if (running) return;
  startButton.disabled = true;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador exige HTTPS e suporte a câmera.");
    }
    setStatus("PEDINDO PERMISSÃO");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
    });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 540;
    stage.classList.add("active");
    running = true;
    stopButton.disabled = false;
    window.dispatchEvent(new CustomEvent("quantum:camera-started"));
    setStatus("CÂMERA ATIVA", true);
    commandElement.textContent = "CÂMERA OK";
    countElement.textContent = "Escolha rosto ou mão nas abas acima.";
    await setCameraView(activeView);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    stage.classList.remove("active");
    setStatus("ERRO");
    commandElement.textContent = "INDISPONÍVEL";
    if (error?.name === "NotAllowedError") {
      countElement.textContent = "Permissão negada. Clique no cadeado da barra de endereço, permita a câmera e tente novamente.";
    } else if (error?.name === "NotFoundError") {
      countElement.textContent = "Nenhuma câmera foi encontrada neste computador.";
    } else if (error?.name === "NotReadableError") {
      countElement.textContent = "A câmera está ocupada por outro programa. Feche-o e tente novamente.";
    } else {
      countElement.textContent = error?.message || "Não foi possível abrir a câmera.";
    }
    startButton.disabled = false;
  }
}

function stopCamera() {
  stopGestureOutput();
  running = false;
  cancelAnimationFrame(animationId);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  stage.classList.remove("active");
  startButton.disabled = false;
  stopButton.disabled = true;
  commandElement.textContent = "NENHUM";
  countElement.textContent = "Câmera desligada";
  setStatus("AGUARDANDO");
  document.querySelectorAll(".gesture-map .active").forEach((item) => item.classList.remove("active"));
  window.dispatchEvent(new CustomEvent("quantum:camera-stopped"));
}

cameraTabs.forEach((button) => button.addEventListener("click", () => setCameraView(button.dataset.cameraView)));
startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
window.addEventListener("pagehide", stopCamera);
cameraPanel.dataset.cameraView = "face";
setCameraView("face");
setStatus("PRONTO PARA INICIAR");
