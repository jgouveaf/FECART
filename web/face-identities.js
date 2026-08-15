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
  const personName = document.getElementById("personName");
  const registerButton = document.getElementById("registerPerson");
  const registeredPeople = document.getElementById("registeredPeople");
  const identityEmpty = document.getElementById("identityEmpty");
  const identityCount = document.getElementById("identityCount");

  const STORAGE_KEY = "quantum_tracker_face_identities_v1";
  const MODEL_URL = new URL("web/vendor/face-api/models", document.baseURI).href.replace(/\/$/, "");
  const MATCH_THRESHOLD = 0.55;
  const DETECTION_INTERVAL_MS = 360;

  let identities = loadIdentities();
  let matcher = null;
  let modelsReady = false;
  let cameraActive = false;
  let detectionBusy = false;
  let detectionTimer = 0;
  let currentFaces = [];
  let temporaryTracks = [];
  let nextTemporaryId = 1;
  let lastPreviewAt = 0;

  function setStatus(text, active = false) {
    statusElement.textContent = text;
    statusDot.classList.toggle("idle", !active);
  }

  function loadIdentities() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return parsed.filter((item) => item?.id && item?.name && Array.isArray(item.descriptor) && item.descriptor.length === 128);
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
      [new Float32Array(identity.descriptor)]
    ));
    matcher = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD);
  }

  function renderIdentities() {
    registeredPeople.replaceChildren();
    identityCount.textContent = `${identities.length} ${identities.length === 1 ? "ID" : "IDs"}`;
    identityEmpty.classList.toggle("hidden", identities.length > 0);

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

  function identifyFace(result) {
    if (matcher) {
      const match = matcher.findBestMatch(result.descriptor);
      if (match.label !== "unknown") {
        const identity = identities.find((item) => item.id === match.label);
        if (identity) return { id: identity.id, name: identity.name, registered: true, distance: match.distance };
      }
    }
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

  function updateRegistrationPanel(faces) {
    currentFaces = faces;
    const onlyFace = faces.length === 1 ? faces[0] : null;
    const canRegister = Boolean(onlyFace && !onlyFace.identity.registered && personName.value.trim());
    registerButton.disabled = !canRegister;

    if (!faces.length) {
      currentFaceId.textContent = "NENHUM";
      faceHint.textContent = "Nenhum rosto detectado. Olhe de frente para a câmera.";
      facePreview.classList.remove("has-image");
      return;
    }
    if (faces.length > 1) {
      currentFaceId.textContent = `${faces.length} ROSTOS`;
      faceHint.textContent = "Para cadastrar, deixe apenas uma pessoa na imagem.";
      facePreview.classList.remove("has-image");
      return;
    }

    currentFaceId.textContent = onlyFace.identity.id;
    faceHint.textContent = onlyFace.identity.registered
      ? `${onlyFace.identity.name} reconhecido(a).`
      : "Rosto pronto. Digite o nome e confirme o cadastro.";
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
      const faces = results.map((result) => ({ result, identity: identifyFace(result) }));
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
    clearTimeout(detectionTimer);
    context.clearRect(0, 0, canvas.width, canvas.height);
    currentFaces = [];
    temporaryTracks = [];
    registerButton.disabled = true;
    currentFaceId.textContent = "NENHUM";
    faceHint.textContent = "Inicie a câmera e fique de frente, sozinho, para cadastrar.";
    facePreview.classList.remove("has-image");
    setStatus("AGUARDANDO CÂMERA");
  }

  personName.addEventListener("input", () => updateRegistrationPanel(currentFaces));
  registerButton.addEventListener("click", () => {
    const name = personName.value.trim();
    const face = currentFaces.length === 1 ? currentFaces[0] : null;
    if (!name || !face || face.identity.registered) return;
    const identity = {
      id: nextPermanentId(),
      name,
      descriptor: Array.from(face.result.descriptor),
      photo: captureFace(face.result.detection.box),
      createdAt: new Date().toISOString(),
    };
    try {
      identities.push(identity);
      saveIdentities();
      rebuildMatcher();
      renderIdentities();
      personName.value = "";
      currentFaceId.textContent = identity.id;
      faceHint.textContent = `${identity.name} cadastrado(a) e salvo(a) neste navegador.`;
      registerButton.disabled = true;
    } catch (error) {
      identities = identities.filter((item) => item.id !== identity.id);
      faceHint.textContent = `Não foi possível salvar: ${error.message}`;
    }
  });

  window.addEventListener("quantum:camera-started", startIdentification);
  window.addEventListener("quantum:camera-stopped", stopIdentification);
  renderIdentities();
})();
