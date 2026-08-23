(() => {
  "use strict";

  const HumanLibrary = window.Human;
  const control = window.QuantumControl;
  const $ = (id) => document.getElementById(id);
  const video = $("cameraVideo");
  const canvas = $("identityCanvas");
  const context = canvas.getContext("2d");
  const statusElement = $("faceStatus");
  const statusDot = $("faceStatusDot");
  const currentFaceId = $("currentFaceId");
  const faceHint = $("faceHint");
  const facePreview = $("facePreview");
  const facePreviewImage = $("facePreviewImage");
  const faceConfidence = $("faceConfidence");
  const faceQuality = $("faceQuality");
  const faceSimilarity = $("faceSimilarity");
  const sampleProgress = $("sampleProgress");
  const sampleProgressBar = $("sampleProgressBar");
  const personName = $("personName");
  const registerButton = $("registerPerson");
  const registeredPeople = $("registeredPeople");
  const identityEmpty = $("identityEmpty");
  const identityCount = $("identityCount");
  const exportButton = $("exportIdentities");
  const importButton = $("importIdentities");
  const backupFile = $("identityBackupFile");
  const cameraPanel = $("camera-gestos");
  const trackingStateElement = $("faceTrackingState");
  const directionElement = $("faceDirection");
  const retryDetectionButton = $("retryFaceDetection");

  const checks = {
    single: $("checkSingle"),
    size: $("checkSize"),
    pose: $("checkPose"),
    real: $("checkReal"),
    live: $("checkLive"),
    blink: $("checkBlink"),
  };

  const DB_NAME = "quantum_tracker_biometrics";
  const DB_STORE = "identities";
  const LEGACY_STORAGE_KEY = "quantum_tracker_face_identities_v1";
  const MIGRATION_KEY = "quantum_tracker_indexeddb_migrated_v1";
  const HUMAN_ENGINE = "human-faceres-3.3.6";
  const REQUIRED_SAMPLES = 5;
  const EMBEDDING_LENGTH = 1024;
  const MATCH_THRESHOLD = 0.50;
  const MIN_CONFIDENCE = 0.58;
  const MIN_FACE_SIZE = 140;
  const MIN_REAL = 0.50;
  const MIN_LIVE = 0.50;
  const DETECTION_DELAY_MS = 70;
  const MAX_CONSECUTIVE_INFERENCE_ERRORS = 3;
  const MAX_INFERENCE_BACKOFF_MS = 4000;
  const MATCH_OPTIONS = { order: 2, multiplier: 25, min: 0.2, max: 0.8 };
  const MODEL_URL = new URL("web/vendor/human/models/", document.baseURI).href;
  const qualityStabilizer = new window.QuantumFaceQuality.FaceQualityStabilizer({
    alpha: 0.22,
    riseFrames: 5,
    fallFrames: 4,
    highEnter: 0.84,
    highExit: 0.77,
  });

  const humanConfig = {
    backend: "webgl",
    modelBasePath: MODEL_URL,
    cacheSensitivity: 0.01,
    cacheModels: true,
    filter: { enabled: true, equalization: true },
    face: {
      enabled: true,
      detector: { rotation: true, return: true, mask: false, maxDetected: 3, minConfidence: 0.45, minSize: 70, skipFrames: 2, skipTime: 120 },
      mesh: { enabled: true, keepInvalid: false },
      iris: { enabled: true, skipFrames: 2 },
      description: { enabled: true, minConfidence: 0.55, skipFrames: 2 },
      emotion: { enabled: false },
      antispoof: { enabled: true, skipFrames: 4 },
      liveness: { enabled: true, skipFrames: 4 },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: true },
  };

  let human = null;
  let modelsPromise = null;
  let database = null;
  let identities = [];
  let modelsReady = false;
  let cameraActive = false;
  let detectionBusy = false;
  let detectionTimer = 0;
  let currentFaces = [];
  let registering = false;
  let lastPreviewAt = 0;
  let lastResult = null;
  let blinkSeenAt = 0;
  let nextTemporaryId = 1;
  let temporaryTracks = [];
  let recognitionMemory = [];
  let activeView = cameraPanel?.dataset.cameraView || "face";
  let detectionGeneration = 0;
  let lockedTargetId = null;
  let targetMisses = 0;
  let lastTrackingSignature = "";
  let lastTrackingAt = 0;
  let faceFrames = 0;
  let faceFpsWindowAt = 0;
  let consecutiveInferenceErrors = 0;
  let nextDetectionDelayMs = DETECTION_DELAY_MS;
  let inferenceSuspended = false;

  function setStatus(text, active = false) {
    statusElement.textContent = text;
    statusDot.classList.toggle("idle", !active);
  }

  function resetInferenceCircuit() {
    consecutiveInferenceErrors = 0;
    nextDetectionDelayMs = DETECTION_DELAY_MS;
    inferenceSuspended = false;
    if (retryDetectionButton) retryDetectionButton.hidden = true;
  }

  function openDatabase() {
    if (database) return Promise.resolve(database);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE)) {
          request.result.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        database = request.result;
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB indisponível."));
    });
  }

  async function getAllRecords() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function putRecord(record) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteRecord(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function normalizeIdentity(item) {
    if (!item?.id || typeof item.name !== "string" || !item.name.trim()) return null;
    const humanEmbeddings = Array.isArray(item.embeddings)
      ? item.embeddings.filter((value) => Array.isArray(value) && value.length === EMBEDDING_LENGTH)
      : [];
    const legacyDescriptors = Array.isArray(item.descriptors)
      ? item.descriptors.filter((value) => Array.isArray(value) && value.length === 128)
      : [];
    const engine = humanEmbeddings.length ? HUMAN_ENGINE : legacyDescriptors.length ? "face-api-legacy" : "";
    if (!engine || typeof item.photo !== "string" || !item.photo.startsWith("data:image/")) return null;
    return {
      id: String(item.id),
      name: item.name.trim().slice(0, 60),
      engine,
      embeddings: humanEmbeddings,
      descriptors: legacyDescriptors,
      photo: item.photo,
      createdAt: item.createdAt || new Date().toISOString(),
      enrollment: item.enrollment || null,
    };
  }

  async function migrateLegacyRecords() {
    if (localStorage.getItem(MIGRATION_KEY) === "done") return;
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const record = normalizeIdentity(item);
          if (record) await putRecord(record);
        }
      }
      localStorage.setItem(MIGRATION_KEY, "done");
    } catch (error) {
      console.warn("Não foi possível migrar cadastros antigos", error);
    }
  }

  async function loadIdentities() {
    await openDatabase();
    await migrateLegacyRecords();
    identities = (await getAllRecords()).map(normalizeIdentity).filter(Boolean);
    renderIdentities();
  }

  function nextPermanentId() {
    const largest = identities.reduce((maximum, item) => {
      const number = Number.parseInt(item.id.replace(/\D/g, ""), 10);
      return Number.isFinite(number) ? Math.max(maximum, number) : maximum;
    }, 0);
    return `QT-${String(largest + 1).padStart(3, "0")}`;
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
      const legacy = identity.engine === "face-api-legacy";
      id.textContent = legacy ? `${identity.id} · LEGADO — RECADASTRE` : `${identity.id} · ${identity.embeddings.length} amostras`;
      id.classList.toggle("legacy", legacy);
      text.append(name, id);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Excluir";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Excluir ${identity.name} (${identity.id}) deste navegador?`)) return;
        await deleteRecord(identity.id);
        identities = identities.filter((item) => item.id !== identity.id);
        recognitionMemory = recognitionMemory.filter((item) => item.id !== identity.id);
        renderIdentities();
      });
      card.append(image, text, remove);
      registeredPeople.append(card);
    }
  }

  function setCheck(element, passed, warning = false) {
    element.classList.toggle("pass", passed);
    element.classList.toggle("warn", !passed && warning);
    element.setAttribute("aria-label", `${element.textContent}: ${passed ? "aprovado" : warning ? "recomendado" : "reprovado"}`);
  }

  function resetChecks() {
    Object.values(checks).forEach((element) => setCheck(element, false));
  }

  function gesturesFrom(result) {
    return (result?.gesture || []).map((item) => String(item.gesture || "").toLowerCase());
  }

  function assessFace(face, result, trackingKey) {
    const gestures = gesturesFrom(result);
    if (gestures.some((gesture) => gesture.includes("blink"))) blinkSeenAt = performance.now();
    const confidence = Number(face.faceScore || face.boxScore || face.score || 0);
    const size = Math.min(Number(face.box?.[2] || 0), Number(face.box?.[3] || 0));
    const angle = face.rotation?.angle || {};
    const yaw = Number(angle.yaw || 0);
    const pitch = Number(angle.pitch || 0);
    const roll = Number(angle.roll || 0);
    const poseByAngle = Math.abs(yaw) <= 0.38 && Math.abs(pitch) <= 0.34 && Math.abs(roll) <= 0.42;
    const pose = gestures.includes("facing center") || poseByAngle;
    const real = Number(face.real || 0);
    const live = Number(face.live || 0);
    const embedding = Array.isArray(face.embedding) ? face.embedding : [];
    const validations = {
      single: result.face.length === 1,
      size: size >= MIN_FACE_SIZE,
      pose,
      real: real >= MIN_REAL,
      live: live >= MIN_LIVE,
      blink: performance.now() - blinkSeenAt < 10000,
      descriptor: embedding.length === EMBEDDING_LENGTH,
      confidence: confidence >= MIN_CONFIDENCE,
    };
    const acceptable = validations.single && validations.size && validations.pose
      && validations.real && validations.live && validations.descriptor && validations.confidence;
    const combined = (confidence + Math.min(1, size / 300) + real + live) / 4;
    let reason = "Rosto válido para cadastro.";
    if (!validations.single) reason = "Deixe apenas uma pessoa na imagem.";
    else if (!validations.size) reason = "Aproxime o rosto da câmera.";
    else if (!validations.pose) reason = "Olhe de frente para a câmera.";
    else if (!validations.confidence) reason = "Melhore a iluminação e mantenha o rosto visível.";
    else if (!validations.real || !validations.live) reason = "A validação de presença não foi aprovada. Pisque e mova levemente a cabeça.";
    return qualityStabilizer.update(trackingKey, {
      confidence, size, real, live, embedding, validations, acceptable, combined, reason,
    });
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

  function boxObject(face) {
    return { x: face.box[0], y: face.box[1], width: face.box[2], height: face.box[3] };
  }

  function temporaryIdFor(box) {
    const now = performance.now();
    temporaryTracks = temporaryTracks.filter((track) => now - track.seenAt < 2500);
    let best = temporaryTracks.map((track) => ({ track, overlap: intersectionOverUnion(track.box, box) }))
      .sort((a, b) => b.overlap - a.overlap)[0];
    if (!best || best.overlap < 0.22) {
      const track = { id: `TEMP-${String(nextTemporaryId++).padStart(2, "0")}`, box, seenAt: now };
      temporaryTracks.push(track);
      return track.id;
    }
    best.track.box = box;
    best.track.seenAt = now;
    return best.track.id;
  }

  function identifyFace(face) {
    const box = boxObject(face);
    const known = identities.filter((identity) => identity.engine === HUMAN_ENGINE && identity.embeddings.length);
    let bestIdentity = null;
    let bestSimilarity = 0;
    const compared = [];
    for (const identity of known) {
      const match = human.match.find(face.embedding, identity.embeddings, MATCH_OPTIONS);
      const pairwise = identity.embeddings.map((reference) => human.match.similarity(face.embedding, reference, MATCH_OPTIONS));
      const similarity = Math.max(Number(match.similarity) || 0, ...pairwise.filter(Number.isFinite));
      compared.push({ id: identity.id, find: match.similarity, pairwise, similarity });
      if (similarity > bestSimilarity) {
        bestIdentity = identity;
        bestSimilarity = similarity;
      }
    }
    window.quantumFaceDiagnostics = {
      known: known.length,
      bestSimilarity,
      embeddingLength: face.embedding?.length || 0,
      selfSimilarity: human.match.similarity(face.embedding, face.embedding, MATCH_OPTIONS),
      compared,
    };
    const now = performance.now();
    recognitionMemory = recognitionMemory.filter((item) => now - item.seenAt < 1600);
    if (bestIdentity && bestSimilarity >= MATCH_THRESHOLD) {
      const memory = recognitionMemory.find((item) => item.id === bestIdentity.id);
      if (memory) Object.assign(memory, { box, seenAt: now, similarity: bestSimilarity });
      else recognitionMemory.push({ id: bestIdentity.id, name: bestIdentity.name, box, seenAt: now, similarity: bestSimilarity });
      return { id: bestIdentity.id, name: bestIdentity.name, registered: true, similarity: bestSimilarity };
    }
    const recalled = recognitionMemory
      .map((item) => ({ item, overlap: intersectionOverUnion(item.box, box) }))
      .sort((a, b) => b.overlap - a.overlap)[0];
    if (recalled?.overlap >= 0.38) return { ...recalled.item, registered: true, recalled: true };
    return { id: temporaryIdFor(box), name: "Não cadastrado", registered: false, similarity: bestSimilarity };
  }

  function captureFace(face) {
    const [x, y, width, height] = face.box;
    const paddingX = width * 0.2;
    const paddingY = height * 0.3;
    const sourceX = Math.max(0, x - paddingX);
    const sourceY = Math.max(0, y - paddingY);
    const sourceWidth = Math.min(video.videoWidth - sourceX, width + paddingX * 2);
    const sourceHeight = Math.min(video.videoHeight - sourceY, height + paddingY * 2);
    const snapshot = document.createElement("canvas");
    snapshot.width = 180;
    snapshot.height = 180;
    snapshot.getContext("2d").drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 180, 180);
    return snapshot.toDataURL("image/jpeg", 0.8);
  }

  function drawFaces(faces) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = Math.max(3, canvas.width / 300);
    context.font = `700 ${Math.max(15, canvas.width / 55)}px ui-monospace, Consolas, monospace`;
    context.textBaseline = "middle";
    for (const item of faces) {
      const [x, y, width, height] = item.face.box;
      const mirroredX = canvas.width - x - width;
      const color = item.identity.registered ? "#31e6a1" : item.quality.acceptable ? "#21d4fd" : "#ffb454";
      const label = item.identity.registered
        ? `${item.identity.id} · ${item.identity.name}`
        : `${item.identity.id} · ${item.quality.acceptable ? "PRONTO" : "AJUSTE O ROSTO"}`;
      context.strokeStyle = color;
      context.fillStyle = color;
      context.strokeRect(mirroredX, y, width, height);
      const labelWidth = Math.min(canvas.width - mirroredX, context.measureText(label).width + 18);
      const labelY = Math.max(0, y - 30);
      context.fillRect(mirroredX, labelY, labelWidth, 28);
      context.fillStyle = "#031019";
      context.fillText(label, mirroredX + 8, labelY + 14, Math.max(20, labelWidth - 14));
    }
  }

  function emitPersonTracking(detail, tracking, force = false) {
    const now = performance.now();
    const signature = `${tracking}:${detail.visible}:${detail.command}:${detail.id || "-"}`;
    if (!force && signature === lastTrackingSignature && now - lastTrackingAt < 400) return;
    lastTrackingSignature = signature;
    lastTrackingAt = now;
    if (trackingStateElement) trackingStateElement.textContent = tracking;
    if (directionElement) directionElement.textContent = detail.command;
    control?.patch("vision", {
      active: cameraActive && activeView === "face",
      status: cameraActive && activeView === "face" ? "ONLINE" : "OFFLINE",
      targetId: detail.id || null,
      confidence: detail.confidence || 0,
      tracking,
      direction: detail.command,
    }, { source: "face-tracking" });
    window.dispatchEvent(new CustomEvent("quantum:person-tracking", {
      detail: {
        ...detail,
        tracking,
        emittedAt: performance.now(),
        modeGeneration: window.quantumRobot?.modeGeneration,
      },
    }));
  }

  function publishPersonTracking(faces, force = false) {
    const candidates = faces.filter((item) => item.quality.confidence >= MIN_CONFIDENCE);
    if (activeView !== "face" || !cameraActive) {
      lockedTargetId = null;
      targetMisses = 0;
      emitPersonTracking({ visible: false, command: "PARAR" }, "SEARCHING", true);
      return;
    }
    let target = lockedTargetId ? candidates.find((item) => item.identity.id === lockedTargetId) : null;
    if (!target && lockedTargetId) {
      targetMisses += 1;
      if (targetMisses < 4) {
        emitPersonTracking({ visible: false, command: "PARAR", id: lockedTargetId }, "REACQUIRING", force);
        return;
      }
      lockedTargetId = null;
    }
    if (!target && candidates.length) {
      target = [...candidates].sort((first, second) => second.face.box[2] * second.face.box[3] - first.face.box[2] * first.face.box[3])[0];
      lockedTargetId = target.identity.id;
    }
    if (!target) {
      targetMisses = Math.min(255, targetMisses + 1);
      emitPersonTracking({ visible: false, command: "PARAR" }, targetMisses > 3 ? "TARGET_LOST" : "SEARCHING", force);
      return;
    }
    targetMisses = 0;
    const center = (target.face.box[0] + target.face.box[2] / 2) / Math.max(1, video.videoWidth);
    const command = center < 0.38 ? "ESQUERDA" : center > 0.62 ? "DIREITA" : "FRENTE";
    emitPersonTracking({
      visible: true,
      command,
      center,
      id: target.identity.id,
      registered: target.identity.registered,
      confidence: target.quality.confidence,
    }, lastTrackingSignature.includes(target.identity.id) ? "FOLLOWING" : "TARGET_ACQUIRED", force);
  }

  function setSampleProgress(value) {
    const safe = Math.max(0, Math.min(REQUIRED_SAMPLES, value));
    sampleProgress.textContent = `${safe}/${REQUIRED_SAMPLES}`;
    sampleProgressBar.style.width = `${(safe / REQUIRED_SAMPLES) * 100}%`;
  }

  function resetMetrics() {
    faceConfidence.textContent = "—";
    faceQuality.textContent = "—";
    faceQuality.className = "";
    faceSimilarity.textContent = "—";
    resetChecks();
    if (!registering) setSampleProgress(0);
  }

  function updatePanel(faces) {
    currentFaces = faces;
    const item = faces.length === 1 ? faces[0] : null;
    registerButton.disabled = !(item && !item.identity.registered && item.quality.acceptable
      && item.quality.rawAcceptable && personName.value.trim() && !registering);
    setCheck(checks.single, faces.length === 1);
    if (!item) {
      resetMetrics();
      setCheck(checks.single, faces.length === 1);
      currentFaceId.textContent = faces.length ? `${faces.length} ROSTOS` : "NENHUM";
      faceHint.textContent = faces.length ? "Para cadastrar, deixe apenas uma pessoa na imagem." : "Nenhum rosto detectado. Olhe de frente para a câmera.";
      facePreview.classList.remove("has-image");
      return;
    }
    const quality = item.quality;
    faceConfidence.textContent = `${Math.round(quality.confidence * 100)}%`;
    faceQuality.textContent = quality.label;
    faceQuality.className = quality.acceptable ? "good" : "bad";
    faceSimilarity.textContent = item.identity.similarity ? `${Math.round(item.identity.similarity * 100)}%` : "—";
    setCheck(checks.single, quality.validations.single);
    setCheck(checks.size, quality.validations.size);
    setCheck(checks.pose, quality.validations.pose);
    setCheck(checks.real, quality.validations.real);
    setCheck(checks.live, quality.validations.live);
    setCheck(checks.blink, quality.validations.blink, !quality.validations.blink);
    currentFaceId.textContent = registering ? "CAPTURANDO" : item.identity.id;
    if (!registering) {
      faceHint.textContent = item.identity.registered
        ? `${item.identity.name} reconhecido(a) com ${Math.round((item.identity.similarity || 0) * 100)}% de similaridade.`
        : quality.acceptable
          ? `Rosto pronto. Digite o nome e capture ${REQUIRED_SAMPLES} amostras.`
          : quality.reason;
    }
    if (performance.now() - lastPreviewAt > 900) {
      facePreviewImage.src = captureFace(item.face);
      facePreview.classList.add("has-image");
      lastPreviewAt = performance.now();
    }
  }

  async function loadModels() {
    if (modelsReady) return;
    if (modelsPromise) return modelsPromise;
    if (window.location?.protocol === "file:") {
      throw new Error("O FaceID exige o site HTTPS. Abra https://jgouveaf.github.io/FECART/.");
    }
    if (!HumanLibrary?.Human) throw new Error("Biblioteca Human FaceID não foi carregada.");
    setStatus("CARREGANDO FACEID", true);
    control?.patch("vision", { active: false, status: "LOADING", tracking: "SEARCHING" }, { source: "face-model" });
    control?.log("INFO", "VISÃO", "Carregando Human FaceID local");
    modelsPromise = (async () => {
      const candidate = new HumanLibrary.Human(humanConfig);
      await candidate.load();
      await candidate.warmup();
      human = candidate;
      modelsReady = true;
      control?.log("INFO", "VISÃO", "Human FaceID pronto");
    })();
    try {
      await modelsPromise;
    } catch (error) {
      modelsReady = false;
      human = null;
      control?.patch("vision", { active: false, status: "ERROR", tracking: "SEARCHING" }, { source: "face-model" });
      control?.patch("diagnostics", { lastError: `FaceID: ${error.message}` }, { source: "face-model" });
      control?.log("ERROR", "VISÃO", `FaceID não carregou: ${error.message}`);
      throw error;
    } finally {
      modelsPromise = null;
    }
  }

  function disposeResult(result) {
    if (!result?.face || !human) return;
    for (const face of result.face) if (face.tensor) human.tf.dispose(face.tensor);
  }

  async function detectFaces() {
    if (!cameraActive || detectionBusy || video.readyState < 2) return;
    const generation = detectionGeneration;
    detectionBusy = true;
    try {
      disposeResult(lastResult);
      lastResult = null;
      const result = await human.detect(video);
      if (generation !== detectionGeneration || !cameraActive || activeView !== "face") {
        disposeResult(result);
        return;
      }
      lastResult = result;
      consecutiveInferenceErrors = 0;
      nextDetectionDelayMs = DETECTION_DELAY_MS;
      if (retryDetectionButton) retryDetectionButton.hidden = true;
      const detectedAt = performance.now();
      const faces = result.face.map((face) => {
        const identity = identifyFace(face);
        return {
          face,
          identity,
          quality: assessFace(face, result, identity.id),
          detectedAt,
        };
      });
      drawFaces(faces);
      updatePanel(faces);
      publishPersonTracking(faces);
      faceFrames += 1;
      if (!faceFpsWindowAt) faceFpsWindowAt = detectedAt;
      const fpsElapsed = detectedAt - faceFpsWindowAt;
      if (fpsElapsed >= 1000) {
        const fps = faceFrames * 1000 / fpsElapsed;
        faceFrames = 0;
        faceFpsWindowAt = detectedAt;
        control?.patch("vision", { fps }, { source: "face-fps" });
      }
      const count = faces.length;
      setStatus(count ? `${count} ROSTO${count === 1 ? "" : "S"} DETECTADO${count === 1 ? "" : "S"}` : "PROCURANDO ROSTO", true);
    } catch (error) {
      if (generation !== detectionGeneration) return;
      consecutiveInferenceErrors += 1;
      nextDetectionDelayMs = Math.min(MAX_INFERENCE_BACKOFF_MS, 500 * (2 ** (consecutiveInferenceErrors - 1)));
      const persistent = consecutiveInferenceErrors >= MAX_CONSECUTIVE_INFERENCE_ERRORS;
      if (persistent) {
        inferenceSuspended = true;
        if (retryDetectionButton) retryDetectionButton.hidden = false;
        console.error("FaceID suspenso após falhas consecutivas", error);
      } else {
        console.warn(`Falha temporária no Human FaceID (${consecutiveInferenceErrors}/${MAX_CONSECUTIVE_INFERENCE_ERRORS})`, error);
      }
      setStatus(persistent ? "FACEID PAUSADO APÓS ERROS" : `RECUPERANDO FACEID ${consecutiveInferenceErrors}/${MAX_CONSECUTIVE_INFERENCE_ERRORS}`);
      faceHint.textContent = persistent
        ? `A identificação foi pausada para proteger o navegador: ${error.message}`
        : `Falha temporária na identificação; nova tentativa em ${nextDetectionDelayMs / 1000}s.`;
      control?.patch("vision", { active: false, status: "ERROR" }, { source: "face-loop" });
      control?.patch("diagnostics", { lastError: `FaceID: ${error.message}` }, { source: "face-loop" });
      control?.log(persistent ? "ERROR" : "WARNING", "VISÃO", persistent
        ? `FaceID pausado após ${consecutiveInferenceErrors} falhas: ${error.message}`
        : `Falha temporária ${consecutiveInferenceErrors}/${MAX_CONSECUTIVE_INFERENCE_ERRORS}: ${error.message}`);
    } finally {
      detectionBusy = false;
    }
  }

  function scheduleDetection() {
    clearTimeout(detectionTimer);
    if (!cameraActive || activeView !== "face" || inferenceSuspended) return;
    detectionTimer = window.setTimeout(async () => {
      await detectFaces();
      scheduleDetection();
    }, nextDetectionDelayMs);
  }

  async function startIdentification() {
    const generation = ++detectionGeneration;
    cameraActive = true;
    resetInferenceCircuit();
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 540;
    if (activeView !== "face") return;
    try {
      await loadModels();
      await loadIdentities();
      if (generation !== detectionGeneration || !cameraActive || activeView !== "face") return;
      setStatus("HUMAN FACEID PRONTO", true);
      control?.patch("vision", { active: true, status: "ONLINE", tracking: "SEARCHING" }, { source: "face-start" });
      await detectFaces();
      scheduleDetection();
    } catch (error) {
      console.error("Identificação indisponível", error);
      setStatus("IDENTIFICAÇÃO INDISPONÍVEL");
      faceHint.textContent = `Não foi possível iniciar o FaceID: ${error.message}`;
      inferenceSuspended = true;
      if (retryDetectionButton) retryDetectionButton.hidden = false;
    }
  }

  function stopIdentification() {
    ++detectionGeneration;
    cameraActive = false;
    registering = false;
    clearTimeout(detectionTimer);
    disposeResult(lastResult);
    lastResult = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    currentFaces = [];
    temporaryTracks = [];
    qualityStabilizer.reset();
    lockedTargetId = null;
    targetMisses = 0;
    faceFrames = 0;
    faceFpsWindowAt = 0;
    resetInferenceCircuit();
    registerButton.disabled = true;
    registerButton.textContent = "Validar e cadastrar rosto";
    currentFaceId.textContent = "NENHUM";
    faceHint.textContent = "Inicie a câmera e fique de frente, sozinho, para cadastrar.";
    facePreview.classList.remove("has-image");
    resetMetrics();
    setStatus("AGUARDANDO CÂMERA");
    publishPersonTracking([], true);
    control?.patch("vision", { active: false, status: "OFFLINE", targetId: null, confidence: 0, tracking: "SEARCHING", direction: "PARAR", fps: 0 }, { source: "face-stop" });
  }

  function waitForFreshFace(afterTimestamp, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const check = () => {
        if (!cameraActive) return reject(new Error("A câmera foi desligada durante o cadastro."));
        if (activeView !== "face") return reject(new Error("O cadastro foi interrompido porque a aba da câmera mudou."));
        const item = currentFaces.length === 1 ? currentFaces[0] : null;
        if (item && item.detectedAt > afterTimestamp && !item.identity.registered
          && item.quality.acceptable && item.quality.rawAcceptable) return resolve(item);
        if (performance.now() - start >= timeoutMs) return reject(new Error("Não obtive uma nova amostra válida. Olhe de frente e melhore a iluminação."));
        window.setTimeout(check, 80);
      };
      check();
    });
  }

  personName.addEventListener("input", () => updatePanel(currentFaces));
  retryDetectionButton?.addEventListener("click", async () => {
    if (!cameraActive || activeView !== "face") return;
    retryDetectionButton.disabled = true;
    control?.log("INFO", "VISÃO", "Nova tentativa manual do FaceID");
    await startIdentification();
    retryDetectionButton.disabled = false;
  });
  registerButton.addEventListener("click", async () => {
    const name = personName.value.trim();
    let item = currentFaces.length === 1 ? currentFaces[0] : null;
    if (!name || !item || item.identity.registered || !item.quality.acceptable
      || !item.quality.rawAcceptable || registering) return;
    registering = true;
    registerButton.disabled = true;
    const embeddings = [];
    const photo = captureFace(item.face);
    try {
      for (let index = 0; index < REQUIRED_SAMPLES; index += 1) {
        if (index > 0) item = await waitForFreshFace(item.detectedAt);
        embeddings.push(Array.from(item.quality.embedding));
        setSampleProgress(index + 1);
        registerButton.textContent = `Capturando ${index + 1}/${REQUIRED_SAMPLES}`;
        faceHint.textContent = index + 1 < REQUIRED_SAMPLES ? "Continue olhando para a câmera e mova levemente a cabeça." : "Salvando cadastro local…";
      }
      const identity = {
        id: nextPermanentId(),
        name,
        engine: HUMAN_ENGINE,
        embeddings,
        descriptors: [],
        photo,
        createdAt: new Date().toISOString(),
        enrollment: { samples: REQUIRED_SAMPLES, confidence: item.quality.confidence, real: item.quality.real, live: item.quality.live },
      };
      identities.push(identity);
      try {
        await putRecord(identity);
      } catch (error) {
        identities = identities.filter((item) => item !== identity);
        throw error;
      }
      renderIdentities();
      personName.value = "";
      currentFaceId.textContent = identity.id;
      faceHint.textContent = `${identity.name} cadastrado(a) com ${REQUIRED_SAMPLES} amostras no navegador.`;
      registerButton.textContent = "Cadastrado ✓";
    } catch (error) {
      faceHint.textContent = `Não foi possível cadastrar: ${error.message}`;
      setSampleProgress(0);
    } finally {
      registering = false;
      window.setTimeout(() => {
        registerButton.textContent = "Validar e cadastrar rosto";
        if (!personName.value) setSampleProgress(0);
        updatePanel(currentFaces);
      }, 1400);
    }
  });

  exportButton.addEventListener("click", () => {
    if (!identities.length) return;
    const backup = { format: "quantum-tracker-face-identities", version: 3, engine: HUMAN_ENGINE, exportedAt: new Date().toISOString(), identities };
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
      if (file.size > 30 * 1024 * 1024) throw new Error("O backup ultrapassa 30 MB.");
      const backup = JSON.parse(await file.text());
      if (backup?.format !== "quantum-tracker-face-identities" || !Array.isArray(backup.identities)) throw new Error("Arquivo inválido.");
      const imported = backup.identities.map(normalizeIdentity).filter(Boolean);
      if (!imported.length) throw new Error("Nenhum cadastro facial válido foi encontrado.");
      if (identities.length && !window.confirm(`Importar ${imported.length} cadastro(s) e manter os atuais?`)) return;
      let added = 0;
      for (const candidate of imported) {
        if (identities.some((identity) => identity.id === candidate.id && identity.name === candidate.name)) continue;
        if (identities.some((identity) => identity.id === candidate.id)) candidate.id = nextPermanentId();
        await putRecord(candidate);
        identities.push(candidate);
        added += 1;
      }
      renderIdentities();
      faceHint.textContent = `${added} cadastro(s) importado(s).`;
    } catch (error) {
      faceHint.textContent = `Falha ao importar backup: ${error.message}`;
    }
  });

  window.addEventListener("quantum:camera-started", startIdentification);
  window.addEventListener("quantum:camera-stopped", stopIdentification);
  window.addEventListener("quantum:camera-error", (event) => {
    stopIdentification();
    setStatus("CÂMERA INDISPONÍVEL");
    faceHint.textContent = event.detail?.message || "Não foi possível abrir a câmera.";
    registerButton.disabled = true;
  });
  window.addEventListener("quantum:camera-view-changed", async (event) => {
    const generation = ++detectionGeneration;
    activeView = event.detail?.view === "hand" ? "hand" : "face";
    clearTimeout(detectionTimer);
    if (activeView !== "face") {
      context.clearRect(0, 0, canvas.width, canvas.height);
      registerButton.disabled = true;
      setStatus(cameraActive ? "PAUSADA · ABA DA MÃO" : "AGUARDANDO CÂMERA");
      publishPersonTracking([], true);
      control?.patch("vision", { active: false, status: cameraActive ? "READY" : "OFFLINE", targetId: null, confidence: 0, tracking: "SEARCHING", direction: "PARAR" }, { source: "face-view" });
      return;
    }
    if (!cameraActive) return;
    if (inferenceSuspended) {
      setStatus("FACEID PAUSADO APÓS ERROS");
      if (retryDetectionButton) retryDetectionButton.hidden = false;
      return;
    }
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 540;
    try {
      await loadModels();
      if (generation !== detectionGeneration || !cameraActive || activeView !== "face") return;
      await detectFaces();
      scheduleDetection();
    } catch (error) {
      setStatus("IDENTIFICAÇÃO INDISPONÍVEL");
      faceHint.textContent = `Não foi possível retomar o FaceID: ${error.message}`;
    }
  });
  loadIdentities().catch((error) => {
    console.error("Falha ao abrir banco facial", error);
    faceHint.textContent = "O navegador bloqueou o armazenamento local dos cadastros.";
  });
})();
