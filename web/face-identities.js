(() => {
  const faceapi = window.faceapi;
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("identityCanvas");
  const context = canvas.getContext("2d");
  const statusElement = document.getElementById("faceStatus");
  const statusDot = document.getElementById("faceStatusDot");
  const currentFaceId = document.getElementById("currentFaceId");
  const faceHint = document.getElementById("faceHint");
  const facePreview = document.getElementById("facePreview");
  const facePreviewImage = document.getElementById("facePreviewImage");
  const faceConfidence = document.getElementById("faceConfidence");
  const faceQuality = document.getElementById("faceQuality");
  const sampleProgress = document.getElementById("sampleProgress");
  const sampleProgressBar = document.getElementById("sampleProgressBar");
  const personName = document.getElementById("personName");
  const registerButton = document.getElementById("registerPerson");
  const registeredPeople = document.getElementById("registeredPeople");
  const identityEmpty = document.getElementById("identityEmpty");
  const identityCount = document.getElementById("identityCount");
  const exportButton = document.getElementById("exportIdentities");
  const importButton = document.getElementById("importIdentities");
  const backupFile = document.getElementById("identityBackupFile");

  const STORAGE_KEY = "quantum_tracker_face_identities_v1";
  const MODEL_URL = new URL("web/vendor/face-api/models", document.baseURI).href.replace(/\/$/, "");
  const MATCH_THRESHOLD = 0.55;
  const DETECTION_INTERVAL_MS = 360;
  const REQUIRED_SAMPLES = 3;
  const MIN_DETECTION_SCORE = 0.62;
  const MIN_FACE_WIDTH_RATIO = 0.16;

  let identities = loadIdentities();
  let matcher = null;
  let modelsReady = false;
  let cameraActive = false;
  let detectionBusy = false;
  let detectionTimer = 0;
  let currentFaces = [];
  let temporaryTracks = [];
  let recognitionMemory = [];
  let nextTemporaryId = 1;
  let lastPreviewAt = 0;
  let registering = false;

  function setStatus(text, active = false) {
    statusElement.textContent = text;
    statusDot.classList.toggle("idle", !active);
  }

  function normalizeIdentity(item) {
    if (!item?.id || typeof item.name !== "string" || !item.name.trim()) return null;
    const candidates = Array.isArray(item.descriptors) ? item.descriptors : [item.descriptor];
    const descriptors = candidates.filter((descriptor) => Array.isArray(descriptor) && descriptor.length === 128);
    if (!descriptors.length || typeof item.photo !== "string" || !item.photo.startsWith("data:image/")) return null;
    return {
      id: String(item.id),
      name: item.name.trim().slice(0, 60),
      descriptors,
      photo: item.photo,
      createdAt: item.createdAt || new Date().toISOString(),
    };
  }

  function loadIdentities() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeIdentity).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function saveIdentities() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identities));
  }

  function rebuildMatcher() {
    if (!modelsReady || !identities.length) {
      matcher = null;
      return;
    }
    const labeled = identities.map((identity) => new faceapi.LabeledFaceDescriptors(
      identity.id,
      identity.descriptors.map((descriptor) => new Float32Array(descriptor))
    ));
    matcher = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD);
    recognitionMemory = recognitionMemory.filter((memory) => identities.some((identity) => identity.id === memory.id));
  }

  function renderIdentities() {
    registeredPeople.replaceChildren();
    identityCount.textContent = `${identities.length} ${identities.length === 1 ? "ID" : "IDs"}`;
    identityEmpty.classList.toggle("hidden", identities.length > 0);
    exportButton.disabled = identities.length === 0;

    for (const identity of identities) {
      const card = document.createElement("article");
      card.className = "person-card";
      const image = document.createElement("img");
      image.src = identity.photo;
      image.alt = `Foto cadastrada de ${identity.name}`;
      const text = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = identity.name;
      const id = document.createElement("small");
      id.textContent = identity.id;
      text.append(name, id);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Excluir";
      remove.addEventListener("click", () => {
        if (!window.confirm(`Excluir ${identity.name} (${identity.id}) deste navegador?`)) return;
        identities = identities.filter((item) => item.id !== identity.id);
        saveIdentities();
        rebuildMatcher();
        renderIdentities();
      });
      card.append(image, text, remove);
      registeredPeople.append(card);
    }
  }

  function nextPermanentId() {
    const largest = identities.reduce((maximum, item) => {
      const value = Number.parseInt(item.id.replace(/\D/g, ""), 10);
      return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
    }, 0);
    return `QT-${String(largest + 1).padStart(3, "0")}`;
  }

  function intersectionOverUnion(first, second) {
    const left = Math.max(first.x, second.x);
    const top = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = first.width * first.height + second.width * second.height - intersection;
    return union ? intersection / union : 0;
  }

  function temporaryIdFor(box) {
    const now = performance.now();
    temporaryTracks = temporaryTracks.filter((track) => now - track.seenAt < 2500);
    let bestTrack = null;
    let bestScore = 0;
    for (const track of temporaryTracks) {
      const score = intersectionOverUnion(track.box, box);
      if (score > bestScore) {
        bestTrack = track;
        bestScore = score;
      }
    }
    if (!bestTrack || bestScore < 0.22) {
      bestTrack = { id: `TEMP-${String(nextTemporaryId++).padStart(2, "0")}`, box, seenAt: now };
      temporaryTracks.push(bestTrack);
    } else {
      bestTrack.box = box;
      bestTrack.seenAt = now;
    }
    return bestTrack.id;
  }

  function assessFaceQuality(result) {
    const score = result.detection.score;
    const widthRatio = video.videoWidth ? result.detection.box.width / video.videoWidth : 0;
    const acceptable = score >= MIN_DETECTION_SCORE && widthRatio >= MIN_FACE_WIDTH_RATIO;
    const combined = Math.min(1, score * 0.65 + Math.min(1, widthRatio / 0.3) * 0.35);
    let label = "BAIXA";
    if (combined >= 0.82 && acceptable) label = "ALTA";
    else if (combined >= 0.68 && acceptable) label = "BOA";
    const reason = widthRatio < MIN_FACE_WIDTH_RATIO
      ? "Aproxime o rosto da câmera."
      : score < MIN_DETECTION_SCORE
        ? "Melhore a iluminação e olhe de frente."
        : "Rosto em boa posição para cadastro.";
    return { score, widthRatio, combined, acceptable, label, reason };
  }

  function rememberRecognition(identity, box) {
    const now = performance.now();
    recognitionMemory = recognitionMemory.filter((memory) => now - memory.seenAt < 1400);
    const previous = recognitionMemory.find((memory) => memory.id === identity.id && intersectionOverUnion(memory.box, box) > 0.2);
    if (previous) {
      previous.box = box;
      previous.seenAt = now;
    } else {
      recognitionMemory.push({ id: identity.id, name: identity.name, box, seenAt: now });
    }
  }

  function recalledRecognition(box) {
    const now = performance.now();
    recognitionMemory = recognitionMemory.filter((memory) => now - memory.seenAt < 1400);
    let best = null;
    let bestOverlap = 0;
    for (const memory of recognitionMemory) {
      const overlap = intersectionOverUnion(memory.box, box);
      if (overlap > bestOverlap) {
        best = memory;
        bestOverlap = overlap;
      }
    }
    return bestOverlap >= 0.38 ? best : null;
  }

  function identifyFace(result) {
    if (matcher) {
      const match = matcher.findBestMatch(result.descriptor);
      if (match.label !== "unknown") {
        const identity = identities.find((item) => item.id === match.label);
        if (identity) {
          rememberRecognition(identity, result.detection.box);
          return { id: identity.id, name: identity.name, registered: true, distance: match.distance };
        }
      }
    }
    const recalled = recalledRecognition(result.detection.box);
    if (recalled) return { id: recalled.id, name: recalled.name, registered: true, distance: null, recalled: true };
    return { id: temporaryIdFor(result.detection.box), name: "Não cadastrado", registered: false, distance: null };
  }

  function captureFace(box) {
    const paddingX = box.width * 0.2;
    const paddingY = box.height * 0.3;
    const sourceX = Math.max(0, box.x - paddingX);
    const sourceY = Math.max(0, box.y - paddingY);
    const sourceWidth = Math.min(video.videoWidth - sourceX, box.width + paddingX * 2);
    const sourceHeight = Math.min(video.videoHeight - sourceY, box.height + paddingY * 2);
    const snapshot = document.createElement("canvas");
    snapshot.width = 180;
    snapshot.height = 180;
    snapshot.getContext("2d").drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 180, 180);
    return snapshot.toDataURL("image/jpeg", 0.78);
  }

  function drawFaces(faces) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = Math.max(3, canvas.width / 300);
    context.font = `700 ${Math.max(15, canvas.width / 55)}px ui-monospace, Consolas, monospace`;
    context.textBaseline = "middle";

    for (const face of faces) {
      const { box } = face.result.detection;
      const mirroredX = canvas.width - box.x - box.width;
      const color = face.identity.registered ? "#31e6a1" : "#21d4fd";
      const label = face.identity.registered
        ? `${face.identity.id} · ${face.identity.name}`
        : `${face.identity.id} · NOVO ROSTO`;
      context.strokeStyle = color;
      context.fillStyle = color;
      context.strokeRect(mirroredX, box.y, box.width, box.height);
      const labelWidth = Math.min(canvas.width - mirroredX, context.measureText(label).width + 18);
      const labelY = Math.max(0, box.y - 30);
      context.fillRect(mirroredX, labelY, labelWidth, 28);
      context.fillStyle = "#031019";
      context.fillText(label, mirroredX + 8, labelY + 14, Math.max(20, labelWidth - 14));
    }
  }

  function setSampleProgress(value) {
    const safeValue = Math.max(0, Math.min(REQUIRED_SAMPLES, value));
    sampleProgress.textContent = `${safeValue}/${REQUIRED_SAMPLES}`;
    sampleProgressBar.style.width = `${(safeValue / REQUIRED_SAMPLES) * 100}%`;
  }

  function resetFaceMetrics() {
    faceConfidence.textContent = "—";
    faceQuality.textContent = "—";
    faceQuality.className = "";
    if (!registering) setSampleProgress(0);
  }

  function showFaceMetrics(face) {
    faceConfidence.textContent = `${Math.round(face.quality.score * 100)}%`;
    faceQuality.textContent = face.quality.label;
    faceQuality.className = face.quality.acceptable ? "good" : "bad";
  }

  function updateRegistrationPanel(faces) {
    currentFaces = faces;
    const onlyFace = faces.length === 1 ? faces[0] : null;
    const canRegister = Boolean(
      onlyFace
      && !onlyFace.identity.registered
      && onlyFace.quality.acceptable
      && personName.value.trim()
      && !registering
    );
    registerButton.disabled = !canRegister;

    if (!faces.length) {
      resetFaceMetrics();
      currentFaceId.textContent = "NENHUM";
      faceHint.textContent = "Nenhum rosto detectado. Olhe de frente para a câmera.";
      facePreview.classList.remove("has-image");
      return;
    }
    if (faces.length > 1) {
      resetFaceMetrics();
      currentFaceId.textContent = `${faces.length} ROSTOS`;
      faceHint.textContent = "Para cadastrar, deixe apenas uma pessoa na imagem.";
      facePreview.classList.remove("has-image");
      return;
    }

    showFaceMetrics(onlyFace);
    if (registering) {
      currentFaceId.textContent = "CAPTURANDO";
      faceHint.textContent = "Mantenha o rosto firme e olhe para a câmera.";
      return;
    }
    currentFaceId.textContent = onlyFace.identity.id;
    faceHint.textContent = onlyFace.identity.registered
      ? `${onlyFace.identity.name} reconhecido(a).`
      : onlyFace.quality.acceptable
        ? "Rosto pronto. Digite o nome e capture três amostras."
        : onlyFace.quality.reason;
    if (performance.now() - lastPreviewAt > 900) {
      facePreviewImage.src = captureFace(onlyFace.result.detection.box);
      facePreview.classList.add("has-image");
      lastPreviewAt = performance.now();
    }
  }

  async function loadModels() {
    if (modelsReady) return;
    if (!faceapi) throw new Error("Biblioteca de identificação não foi carregada.");
    setStatus("CARREGANDO MODELOS", true);
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsReady = true;
    rebuildMatcher();
  }

  async function detectFaces() {
    if (!cameraActive || detectionBusy || video.readyState < 2) return;
    detectionBusy = true;
    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.55 });
      const results = await faceapi.detectAllFaces(video, options).withFaceLandmarks(true).withFaceDescriptors();
      const detectedAt = performance.now();
      const faces = results.map((result) => ({
        result,
        identity: identifyFace(result),
        quality: assessFaceQuality(result),
        detectedAt,
      }));
      drawFaces(faces);
      updateRegistrationPanel(faces);
      setStatus(faces.length ? `${faces.length} ROSTO${faces.length === 1 ? "" : "S"} DETECTADO${faces.length === 1 ? "" : "S"}` : "PROCURANDO ROSTO", true);
    } catch (error) {
      console.error("Falha na identificação facial", error);
      setStatus("ERRO NA IDENTIFICAÇÃO");
      faceHint.textContent = error.message;
    } finally {
      detectionBusy = false;
    }
  }

  function scheduleDetection() {
    clearTimeout(detectionTimer);
    if (!cameraActive) return;
    detectionTimer = window.setTimeout(async () => {
      await detectFaces();
      scheduleDetection();
    }, DETECTION_INTERVAL_MS);
  }

  async function startIdentification() {
    cameraActive = true;
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 540;
    try {
      await loadModels();
      if (!cameraActive) return;
      setStatus("PROCURANDO ROSTO", true);
      await detectFaces();
      scheduleDetection();
    } catch (error) {
      console.error("Modelos faciais indisponíveis", error);
      setStatus("IDENTIFICAÇÃO INDISPONÍVEL");
      faceHint.textContent = `Não foi possível carregar a identificação: ${error.message}`;
    }
  }

  function stopIdentification() {
    cameraActive = false;
    registering = false;
    clearTimeout(detectionTimer);
    context.clearRect(0, 0, canvas.width, canvas.height);
    currentFaces = [];
    temporaryTracks = [];
    registerButton.disabled = true;
    currentFaceId.textContent = "NENHUM";
    faceHint.textContent = "Inicie a câmera e fique de frente, sozinho, para cadastrar.";
    facePreview.classList.remove("has-image");
    registerButton.textContent = "Cadastrar com 3 amostras";
    resetFaceMetrics();
    setStatus("AGUARDANDO CÂMERA");
  }

  personName.addEventListener("input", () => updateRegistrationPanel(currentFaces));
  function waitForFreshFace(afterTimestamp, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const check = () => {
        if (!cameraActive) {
          reject(new Error("A câmera foi desligada durante o cadastro."));
          return;
        }
        const face = currentFaces.length === 1 ? currentFaces[0] : null;
        if (face && face.detectedAt > afterTimestamp && !face.identity.registered) {
          resolve(face);
          return;
        }
        if (performance.now() - startedAt >= timeoutMs) {
          reject(new Error("Não foi possível obter uma nova amostra. Fique sozinho e olhe para a câmera."));
          return;
        }
        window.setTimeout(check, 70);
      };
      check();
    });
  }

  registerButton.addEventListener("click", async () => {
    const name = personName.value.trim();
    let face = currentFaces.length === 1 ? currentFaces[0] : null;
    if (!name || !face || face.identity.registered || !face.quality.acceptable || registering) return;
    registering = true;
    registerButton.disabled = true;
    const descriptors = [];
    const photo = captureFace(face.result.detection.box);
    let identity = null;
    try {
      for (let index = 0; index < REQUIRED_SAMPLES; index += 1) {
        if (index > 0) face = await waitForFreshFace(face.detectedAt);
        if (!face.quality.acceptable) throw new Error(face.quality.reason);
        descriptors.push(Array.from(face.result.descriptor));
        setSampleProgress(index + 1);
        registerButton.textContent = `Capturando ${index + 1}/${REQUIRED_SAMPLES}`;
        faceHint.textContent = index + 1 < REQUIRED_SAMPLES
          ? "Ótimo. Continue olhando para a câmera."
          : "Amostras capturadas. Salvando cadastro…";
      }
      identity = {
        id: nextPermanentId(),
        name,
        descriptors,
        photo,
        createdAt: new Date().toISOString(),
      };
      identities.push(identity);
      saveIdentities();
      rebuildMatcher();
      renderIdentities();
      personName.value = "";
      currentFaceId.textContent = identity.id;
      faceHint.textContent = `${identity.name} cadastrado(a) e salvo(a) neste navegador.`;
      registerButton.textContent = "Cadastrado ✓";
      registerButton.disabled = true;
    } catch (error) {
      if (identity) identities = identities.filter((item) => item.id !== identity.id);
      faceHint.textContent = `Não foi possível salvar: ${error.message}`;
      setSampleProgress(0);
    } finally {
      registering = false;
      window.setTimeout(() => {
        registerButton.textContent = "Cadastrar com 3 amostras";
        if (!personName.value) setSampleProgress(0);
        updateRegistrationPanel(currentFaces);
      }, 1300);
    }
  });

  exportButton.addEventListener("click", () => {
    if (!identities.length) return;
    const backup = {
      format: "quantum-tracker-face-identities",
      version: 2,
      exportedAt: new Date().toISOString(),
      identities,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `quantum-tracker-identidades-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  importButton.addEventListener("click", () => backupFile.click());
  backupFile.addEventListener("change", async () => {
    const file = backupFile.files?.[0];
    backupFile.value = "";
    if (!file) return;
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("O backup ultrapassa o limite de 15 MB.");
      const backup = JSON.parse(await file.text());
      if (backup?.format !== "quantum-tracker-face-identities" || !Array.isArray(backup.identities)) {
        throw new Error("Arquivo não pertence ao Quantum Tracker.");
      }
      const imported = backup.identities.map(normalizeIdentity).filter(Boolean);
      if (!imported.length) throw new Error("Nenhum cadastro válido foi encontrado.");
      if (identities.length && !window.confirm(`Importar ${imported.length} cadastro(s) e manter os atuais?`)) return;
      let added = 0;
      for (const candidate of imported) {
        const duplicate = identities.some((identity) => identity.id === candidate.id && identity.name === candidate.name);
        if (duplicate) continue;
        if (identities.some((identity) => identity.id === candidate.id)) candidate.id = nextPermanentId();
        identities.push(candidate);
        added += 1;
      }
      saveIdentities();
      rebuildMatcher();
      renderIdentities();
      faceHint.textContent = `${added} cadastro(s) importado(s). Os IDs duplicados foram ignorados.`;
    } catch (error) {
      faceHint.textContent = `Falha ao importar backup: ${error.message}`;
    }
  });

  window.addEventListener("quantum:camera-started", startIdentification);
  window.addEventListener("quantum:camera-stopped", stopIdentification);
  renderIdentities();
})();
