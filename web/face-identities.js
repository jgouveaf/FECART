(() => {
  "use strict";

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
  const retryDetectionButton = $("retryFaceDetection");
  const presenceButton = $("confirmFacePresence");
  const presenceStatus = $("facePresenceStatus");

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
  const MAX_SAMPLES_PER_IDENTITY = 15;
  const EMBEDDING_LENGTH = 1024;
  const MATCH_THRESHOLD = window.QuantumFaceIdentityMath.MIN_SIMILARITY;
  const MIN_CONFIDENCE = 0.58;
  const MIN_FACE_SIZE = 140;
  const MIN_REAL = 0.50;
  const MIN_LIVE = 0.50;
  const DETECTION_DELAY_MS = 70;
  const MAX_CONSECUTIVE_INFERENCE_ERRORS = 3;
  const MAX_INFERENCE_BACKOFF_MS = 4000;
  const MATCH_OPTIONS = { order: 2, multiplier: 25, min: 0.2, max: 0.8 };
  const HUMAN_RUNTIME_URL = new URL("web/vendor/human/human.js?v=3.3.6", document.baseURI).href;
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
  const faceInference = new window.QuantumFaceInference.FaceInferenceClient();
  const presenceValidator = new window.QuantumFacePresence.FacePresenceValidator({
    similarity: (first, second) => human?.match.similarity(first, second, MATCH_OPTIONS) || 0,
    threshold: MATCH_THRESHOLD,
  });
  let humanLibraryPromise = null;
  let modelsPromise = null;
  let database = null;
  let identities = [];
  let modelsReady = false;
  let cameraActive = false;
  let detectionBusy = false;
  let detectionTimer = 0;
  let currentFaces = [];
  let registering = false;
  let enrollmentRequestedUntil = 0;
  let enrollmentGeneration = 0;
  let lastFaceVideoTime = -1;
  let lastPreviewAt = 0;
  let lastResult = null;
  let blinkSeenAt = 0;
  let nextTemporaryId = 1;
  let temporaryTracks = [];
  let recognitionMemory = [];
  let activeView = cameraPanel?.dataset.cameraView || "face";
  let detectionGeneration = 0;
  let selectedTargetId = null;
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
      const transaction = db.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).put(record);
      transaction.oncomplete = () => resolve(record);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Cadastro não foi salvo."));
    });
  }

  async function deleteRecord(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Exclusão não foi concluída."));
    });
  }

  function normalizeIdentity(item) {
    if (!item?.id || typeof item.name !== "string" || !item.name.trim()) return null;
    const humanEmbeddings = Array.isArray(item.embeddings)
      ? item.embeddings.filter((value) => Array.isArray(value) && value.length === EMBEDDING_LENGTH && value.every(Number.isFinite)).slice(-MAX_SAMPLES_PER_IDENTITY)
      : [];
    const legacyDescriptors = Array.isArray(item.descriptors)
      ? item.descriptors.filter((value) => Array.isArray(value) && value.length === 128 && value.every(Number.isFinite)).slice(-MAX_SAMPLES_PER_IDENTITY)
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
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
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

  function normalizedPersonName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  }

  function identityByName(value) {
    const normalized = normalizedPersonName(value);
    return normalized ? identities.find((identity) => normalizedPersonName(identity.name) === normalized) || null : null;
  }

  function mergeEmbeddings(existing = [], incoming = []) {
    const unique = new Map();
    for (const embedding of [...existing, ...incoming]) {
      if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_LENGTH) continue;
      unique.set(embedding.join(","), embedding);
    }
    return [...unique.values()].slice(-MAX_SAMPLES_PER_IDENTITY);
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
        if (selectedTargetId === identity.id) {
          selectedTargetId = null;
          publishPersonTracking([], true);
        }
        renderIdentities();
      });
      const actions = document.createElement("div");
      actions.className = "person-actions";
      const follow = document.createElement("button");
      follow.type = "button";
      follow.className = "follow-person";
      follow.textContent = selectedTargetId === identity.id ? "Parar de seguir" : "Seguir";
      follow.setAttribute("aria-pressed", String(selectedTargetId === identity.id));
      follow.disabled = legacy;
      follow.addEventListener("click", () => {
        selectedTargetId = selectedTargetId === identity.id ? null : identity.id;
        renderIdentities();
        publishPersonTracking(currentFaces, true);
        if (selectedTargetId) window.quantumPersonFollower?.prepare();
      });
      actions.append(follow, remove);
      card.classList.toggle("target-active", selectedTargetId === identity.id);
      card.append(image, text, actions);
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

  function assessFace(face, result, trackingKey, capturedAt, trackingOnly = false) {
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
      descriptor: embedding.length === EMBEDDING_LENGTH && embedding.every(Number.isFinite),
      confidence: confidence >= MIN_CONFIDENCE,
    };
    const presence = presenceValidator.update({ capturedAt, box: face.box, embedding, real, live,
      yaw: face.rotation?.angle?.yaw,
      eligible: validations.single && validations.size && validations.descriptor && validations.confidence,
    });
    const acceptable = !trackingOnly && validations.single && validations.size && validations.pose
      && presence.accepted && validations.descriptor && validations.confidence;
    const combined = (confidence + Math.min(1, size / 300) + real + live) / 4;
    let reason = "Rosto válido para cadastro.";
    if (!validations.single) reason = "Deixe apenas uma pessoa na imagem.";
    else if (!validations.size) reason = "Aproxime o rosto da câmera.";
    else if (!validations.pose) reason = "Olhe de frente para a câmera.";
    else if (!validations.confidence) reason = "Melhore a iluminação e mantenha o rosto visível.";
    else if (!validations.descriptor) reason = "Aguarde uma leitura facial nítida antes de cadastrar.";
    else if (!presence.accepted) reason = presence.message;
    return qualityStabilizer.update(trackingKey, {
      confidence, size, real, live, embedding, validations, acceptable, combined, reason, presence, trackingOnly,
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
    if (!Array.isArray(face.embedding) || face.embedding.length !== EMBEDDING_LENGTH || !face.embedding.every(Number.isFinite)) {
      window.quantumFaceDiagnostics = {
        known: identities.length,
        bestSimilarity: 0,
        decision: "INVALID_EMBEDDING",
        threshold: MATCH_THRESHOLD,
        embeddingLength: face.embedding?.length || 0,
        compared: [],
      };
      return { id: temporaryIdFor(box), name: "Não cadastrado", registered: false, similarity: 0 };
    }
    const known = identities.filter((identity) => identity.engine === HUMAN_ENGINE && identity.embeddings.length);
    const compared = known.map((identity) => ({
      identity,
      scores: identity.embeddings.map((reference) => human.match.similarity(face.embedding, reference, MATCH_OPTIONS)),
    }));
    const decision = window.QuantumFaceIdentityMath.chooseIdentity(compared);
    const bestIdentity = decision.identity;
    const bestSimilarity = decision.similarity;
    window.quantumFaceDiagnostics = {
      known: known.length,
      bestSimilarity,
      secondSimilarity: decision.secondSimilarity,
      margin: decision.margin,
      decision: decision.reason,
      threshold: MATCH_THRESHOLD,
      embeddingLength: face.embedding?.length || 0,
      selfSimilarity: human.match.similarity(face.embedding, face.embedding, MATCH_OPTIONS),
      compared: decision.ranked.map((candidate) => ({
        id: candidate.identity.id,
        name: candidate.identity.name,
        scores: candidate.scores,
        similarity: candidate.similarity,
      })),
    };
    const now = performance.now();
    recognitionMemory = recognitionMemory.filter((item) => now - item.seenAt < 1600);
    if (decision.accepted && bestIdentity) {
      const memory = recognitionMemory.find((item) => item.id === bestIdentity.id);
      if (memory) Object.assign(memory, { box, seenAt: now, similarity: bestSimilarity });
      else recognitionMemory.push({ id: bestIdentity.id, name: bestIdentity.name, box, seenAt: now, similarity: bestSimilarity });
      return { id: bestIdentity.id, name: bestIdentity.name, registered: true, similarity: bestSimilarity };
    }
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
    window.QuantumFaceMesh.draw(context, faces.map(item => item.face), human?.faceTriangulation, canvas.width, canvas.height);
  }

  // Face identification supplies evidence, never motor commands. Mode 2 owns that decision.
  function publishPersonTracking(faces, _force = false, failed = false) {
    const active = cameraActive && activeView === "face";
    window.dispatchEvent(new CustomEvent("quantum:face-observations", { detail: {
      selectedId: selectedTargetId,
      selectedName: identities.find(item => item.id === selectedTargetId)?.name || "",
      registering, failed,
      faces: active && !failed ? faces.map(item => ({
        id: item.identity.id, registered: item.identity.registered,
        confidence: item.quality.confidence, capturedAt: item.capturedAt,
        box: { x: item.face.box[0] / video.videoWidth, y: item.face.box[1] / video.videoHeight,
          width: item.face.box[2] / video.videoWidth, height: item.face.box[3] / video.videoHeight },
      })) : [],
    } }));
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
    const existing = identityByName(personName.value);
    const identityConflict = item?.identity.registered && item.identity.id !== existing?.id;
    registerButton.disabled = !(item && !identityConflict && item.quality.acceptable
      && item.quality.rawAcceptable && personName.value.trim() && !registering);
    if (!registering) registerButton.textContent = existing ? `Atualizar rosto de ${existing.name}` : "Validar e cadastrar rosto";
    setCheck(checks.single, faces.length === 1);
    if (!item) {
      if (presenceButton) presenceButton.disabled = true;
      if (presenceStatus) presenceStatus.textContent = 'Mantenha um único rosto nítido na imagem.';
      resetMetrics();
      setCheck(checks.single, faces.length === 1);
      currentFaceId.textContent = faces.length ? `${faces.length} ROSTOS` : "NENHUM";
      faceHint.textContent = faces.length ? "Para cadastrar, deixe apenas uma pessoa na imagem." : "Nenhum rosto detectado. Olhe de frente para a câmera.";
      facePreview.classList.remove("has-image");
      return;
    }
    const quality = item.quality;
    if (presenceButton) presenceButton.disabled = registering || quality.presence.accepted || !quality.validations.size
      || !quality.validations.confidence || !quality.validations.descriptor;
    if (presenceStatus) presenceStatus.textContent = quality.trackingOnly
      ? 'Identificação ativa. Para cadastrar, digite o nome ou confirme por movimento.' : quality.presence.message;
    faceConfidence.textContent = `${Math.round(quality.confidence * 100)}%`;
    faceQuality.textContent = quality.trackingOnly ? 'IDENTIFICAÇÃO' : quality.label;
    faceQuality.className = quality.trackingOnly || quality.acceptable ? "good" : "bad";
    faceSimilarity.textContent = item.identity.similarity ? `${Math.round(item.identity.similarity * 100)}%` : "—";
    setCheck(checks.single, quality.validations.single);
    setCheck(checks.size, quality.validations.size);
    setCheck(checks.pose, quality.validations.pose);
    // Model scores remain visible as auxiliary observations, not a false
    // rejection when the same person's guided presence was already confirmed.
    setCheck(checks.real, quality.validations.real, true);
    setCheck(checks.live, quality.validations.live, true);
    setCheck(checks.blink, quality.validations.blink, !quality.validations.blink);
    currentFaceId.textContent = registering ? "CAPTURANDO" : item.identity.id;
    if (!registering) {
      faceHint.textContent = item.identity.registered
        ? `${item.identity.name} reconhecido(a). ${selectedTargetId === item.identity.id
          ? 'Alvo do seguimento. Veja o estado do Modo 2 acima.' : 'Clique em Seguir no cadastro para iniciar o Modo 2.'}`
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

  async function loadHumanLibrary() {
    if (window.Human?.Human) return window.Human;
    if (!humanLibraryPromise) {
      humanLibraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = HUMAN_RUNTIME_URL;
        script.async = true;
        script.dataset.quantumHumanRuntime = "true";
        script.addEventListener("load", () => {
          if (window.Human?.Human) resolve(window.Human);
          else reject(new Error("O motor facial foi baixado, mas não inicializou."));
        }, { once: true });
        script.addEventListener("error", () => {
          script.remove();
          reject(new Error("Não foi possível carregar o motor facial local."));
        }, { once: true });
        document.head.append(script);
      });
    }
    try {
      return await humanLibraryPromise;
    } catch (error) {
      humanLibraryPromise = null;
      throw error;
    }
  }

  async function loadModels() {
    if (modelsReady && faceInference.ready) return;
    if (modelsPromise) return modelsPromise;
    if (window.location?.protocol === "file:") {
      throw new Error("O FaceID exige o site HTTPS. Abra https://jgouveaf.github.io/FECART/.");
    }
    setStatus("CARREGANDO FACEID", true);
    control?.patch("vision", { active: false, status: "LOADING", tracking: "SEARCHING" }, { source: "face-model" });
    control?.log("INFO", "VISÃO", "Carregando Human FaceID local");
    modelsPromise = (async () => {
      const HumanLibrary = await loadHumanLibrary();
      const candidate = new HumanLibrary.Human(humanConfig);
      await faceInference.load(humanConfig);
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
    if (!cameraActive || detectionBusy) return;
    if (video.readyState < 2 || video.currentTime === lastFaceVideoTime) {
      if (currentFaces.length && performance.now() - currentFaces[0].capturedAt > 800) {
        presenceValidator.reset();
        qualityStabilizer.reset();
        drawFaces([]);
        updatePanel([]);
        publishPersonTracking([]);
      }
      return;
    }
    lastFaceVideoTime = video.currentTime;
    const capturedAt = performance.now();
    const generation = detectionGeneration;
    detectionBusy = true;
    try {
      disposeResult(lastResult);
      lastResult = null;
      const processing = window.QuantumFaceProcessing.plan({ width: video.videoWidth, height: video.videoHeight,
        modeTwo: Number(control?.state.mode.id) === 2 && control?.state.mode.phase === 'ACTIVE',
        enrolling: registering || Boolean(personName.value.trim()) || performance.now() < enrollmentRequestedUntil });
      const result = await faceInference.detect(video, processing.config);
      if (generation !== detectionGeneration || !cameraActive || activeView !== "face") {
        disposeResult(result);
        return;
      }
      lastResult = result;
      consecutiveInferenceErrors = 0;
      nextDetectionDelayMs = DETECTION_DELAY_MS;
      if (retryDetectionButton) retryDetectionButton.hidden = true;
      const detectedAt = performance.now();
      window.quantumFacePerformance = { processingMs: Math.round(detectedAt - capturedAt),
        backend: result.backend || 'local', profile: processing.tracking ? 'tracking' : 'enrollment' };
      if (result.face.length !== 1) presenceValidator.reset();
      const faces = result.face.map((rawFace) => {
        const face = window.QuantumFaceProcessing.restore(rawFace, processing.scaleX, processing.scaleY);
        const identity = identifyFace(face);
        return {
          face,
          identity,
          quality: assessFace(face, result, identity.id, capturedAt, processing.tracking),
          detectedAt,
          capturedAt,
        };
      });
      drawFaces(faces);
      updatePanel(faces);
      publishPersonTracking(faces);
      control?.patch("vision", { active: true, status: "ONLINE" }, { source: "face-loop" });
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
      currentFaces = [];
      presenceValidator.reset();
      qualityStabilizer.reset();
      drawFaces([]);
      updatePanel([]);
      registerButton.disabled = true;
      publishPersonTracking([], true, true);
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

  function scheduleDetection(delayMs = nextDetectionDelayMs) {
    clearTimeout(detectionTimer);
    if (!cameraActive || activeView !== "face" || inferenceSuspended) return;
    detectionTimer = window.setTimeout(async () => {
      const startedAt = performance.now();
      await detectFaces();
      const modeTwo = Number(control?.state.mode.id) === 2 && control?.state.mode.phase === 'ACTIVE';
      const delay = modeTwo && !registering && consecutiveInferenceErrors === 0
        ? Math.max(20, DETECTION_DELAY_MS - (performance.now() - startedAt)) : nextDetectionDelayMs;
      scheduleDetection(delay);
    }, delayMs);
  }

  async function startIdentification() {
    const generation = ++detectionGeneration;
    cameraActive = true;
    lastFaceVideoTime = -1;
    presenceValidator.reset();
    qualityStabilizer.reset();
    updatePanel([]);
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
    ++enrollmentGeneration;
    cameraActive = false;
    registering = false;
    enrollmentRequestedUntil = 0;
    clearTimeout(detectionTimer);
    disposeResult(lastResult);
    lastResult = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    currentFaces = [];
    temporaryTracks = [];
    window.quantumFacePerformance = null;
    qualityStabilizer.reset();
    presenceValidator.reset();
    if (presenceButton) presenceButton.disabled = true;
    if (presenceStatus) presenceStatus.textContent = 'Ative a câmera para confirmar a presença.';
    lastFaceVideoTime = -1;
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

  function waitForFreshFace(afterTimestamp, allowedIdentityId = null, token, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const check = () => {
        if (token !== enrollmentGeneration) return reject(new Error("Cadastro cancelado; tente novamente."));
        if (!cameraActive) return reject(new Error("A câmera foi desligada durante o cadastro."));
        if (activeView !== "face") return reject(new Error("O cadastro foi interrompido porque a aba da câmera mudou."));
        const item = currentFaces.length === 1 ? currentFaces[0] : null;
        const permittedIdentity = !item?.identity.registered || item.identity.id === allowedIdentityId;
        if (item && item.capturedAt - afterTimestamp >= 180 && performance.now() - item.capturedAt < 800 && permittedIdentity
          && item.quality.acceptable && item.quality.rawAcceptable) return resolve(item);
        if (performance.now() - start >= timeoutMs) return reject(new Error("Não obtive uma nova amostra válida. Olhe de frente e melhore a iluminação."));
        window.setTimeout(check, 80);
      };
      check();
    });
  }

  personName.addEventListener("input", () => updatePanel(currentFaces));
  presenceButton?.addEventListener('click', () => {
    if (registering || currentFaces.length !== 1) return;
    enrollmentRequestedUntil = performance.now() + 30000;
    if (presenceValidator.beginGuided(performance.now())) {
      presenceStatus.textContent = '1/3 · Olhe de frente para começar.';
    }
  });
  retryDetectionButton?.addEventListener("click", async () => {
    if (!cameraActive || activeView !== "face") return;
    retryDetectionButton.disabled = true;
    control?.log("INFO", "VISÃO", "Nova tentativa manual do FaceID");
    await startIdentification();
    retryDetectionButton.disabled = false;
  });
  registerButton.addEventListener("click", async () => {
    const name = personName.value.trim().replace(/\s+/g, " ").slice(0, 60);
    const existing = identityByName(name);
    let item = currentFaces.length === 1 ? currentFaces[0] : null;
    const identityConflict = item?.identity.registered && item.identity.id !== existing?.id;
    if (item && performance.now() - item.capturedAt > 800) {
      faceHint.textContent = "Imagem atrasada ou congelada. Aguarde uma imagem nova antes de cadastrar.";
      registerButton.disabled = true;
      return;
    }
    if (!name || !item || identityConflict || !item.quality.acceptable
      || !item.quality.rawAcceptable || registering) return;
    if (existing && !item.identity.registered
      && !window.confirm(`${existing.name} já está salvo. Deseja acrescentar estas novas amostras ao cadastro existente?`)) return;
    registering = true;
    const token = ++enrollmentGeneration;
    publishPersonTracking(currentFaces, true);
    registerButton.disabled = true;
    const embeddings = [];
    const photo = captureFace(item.face);
    try {
      for (let index = 0; index < REQUIRED_SAMPLES; index += 1) {
        if (index > 0) item = await waitForFreshFace(item.capturedAt, existing?.id || null, token);
        if (token !== enrollmentGeneration) throw new Error("Cadastro cancelado.");
        if (embeddings.length && human.match.similarity(item.quality.embedding, embeddings[0], MATCH_OPTIONS) < MATCH_THRESHOLD) {
          throw new Error("O rosto mudou durante a captura. Cadastre uma pessoa por vez.");
        }
        embeddings.push(Array.from(item.quality.embedding));
        setSampleProgress(index + 1);
        registerButton.textContent = `Capturando ${index + 1}/${REQUIRED_SAMPLES}`;
        faceHint.textContent = index + 1 < REQUIRED_SAMPLES ? "Continue olhando para a câmera e mova levemente a cabeça." : "Salvando cadastro local…";
      }
      const identity = {
        id: existing?.id || nextPermanentId(),
        name,
        engine: HUMAN_ENGINE,
        embeddings: mergeEmbeddings(existing?.embeddings, embeddings),
        descriptors: [],
        photo,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        enrollment: {
          samples: mergeEmbeddings(existing?.embeddings, embeddings).length,
          confidence: item.quality.confidence,
          real: item.quality.real,
          live: item.quality.live,
          presenceMethod: item.quality.presence.method,
        },
      };
      await putRecord(identity);
      // Persistence is best effort: export is still required for backup or another PC.
      navigator.storage?.persist?.().catch(() => {});
      if (existing) identities = identities.map((candidate) => candidate.id === existing.id ? identity : candidate);
      else identities.push(identity);
      renderIdentities();
      personName.value = "";
      currentFaceId.textContent = identity.id;
      faceHint.textContent = existing
        ? `${identity.name} atualizado(a). O cadastro agora possui ${identity.embeddings.length} amostras.`
        : `${identity.name} cadastrado(a) com ${REQUIRED_SAMPLES} amostras neste navegador.`;
      registerButton.textContent = existing ? "Cadastro atualizado ✓" : "Cadastrado ✓";
    } catch (error) {
      faceHint.textContent = `Não foi possível cadastrar: ${error.message}`;
      setSampleProgress(0);
    } finally {
      if (token === enrollmentGeneration) registering = false;
      publishPersonTracking(currentFaces, true);
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
      let updated = 0;
      for (const candidate of imported) {
        const sameName = identityByName(candidate.name);
        if (sameName) {
          const mergedEmbeddings = mergeEmbeddings(sameName.embeddings, candidate.embeddings);
          const merged = {
            ...sameName,
            engine: mergedEmbeddings.length ? HUMAN_ENGINE : sameName.engine,
            embeddings: mergedEmbeddings,
            photo: candidate.photo || sameName.photo,
            updatedAt: new Date().toISOString(),
            enrollment: { ...(sameName.enrollment || {}), samples: mergedEmbeddings.length },
          };
          await putRecord(merged);
          identities = identities.map((identity) => identity.id === sameName.id ? merged : identity);
          updated += 1;
          continue;
        }
        if (identities.some((identity) => identity.id === candidate.id)) candidate.id = nextPermanentId();
        await putRecord(candidate);
        identities.push(candidate);
        added += 1;
      }
      renderIdentities();
      faceHint.textContent = `${added} cadastro(s) novo(s) e ${updated} atualizado(s).`;
    } catch (error) {
      faceHint.textContent = `Falha ao importar backup: ${error.message}`;
    }
  });

  window.addEventListener("quantum:camera-started", startIdentification);
  window.addEventListener('pagehide', () => faceInference.close());
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
      presenceValidator.reset();
      qualityStabilizer.reset();
      ++enrollmentGeneration;
      registering = false;
      updatePanel([]);
      lastFaceVideoTime = -1;
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
