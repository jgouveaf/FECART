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

  const checks = {
    single: $("checkSingle"),
    size: $("checkSize"),
    pose: $("checkPose"),
  };

  const DB_NAME = "quantum_tracker_biometrics";
  const DB_STORE = "identities";
  const LEGACY_STORAGE_KEY = "quantum_tracker_face_identities_v1";
  const MIGRATION_KEY = "quantum_tracker_indexeddb_migrated_v1";
  const HUMAN_ENGINE = "human-faceres-3.3.6";
  const profiles = window.QuantumFaceProfiles;
  let activeEngine = null;
  const REQUIRED_SAMPLES = 5;
  const MAX_SAMPLES_PER_IDENTITY = 15;
  const EMBEDDING_LENGTH = 1024;
  const MIN_CONFIDENCE = 0.58;
  const MIN_FACE_SIZE = 140;
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
      iris: { enabled: false },
      description: { enabled: true, minConfidence: 0.55, skipFrames: 2 },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: true },
  };

  let human = null;
  const faceInference = new window.QuantumFaceInference.FaceInferenceClient();
  let humanLibraryPromise = null;
  let modelsPromise = null;
  let modelsPromiseEngine = null;
  let database = null;
  let identities = [];
  let modelsReady = false;
  let cameraActive = false;
  let detectionBusy = false;
  let detectionTimer = 0;
  let currentFaces = [];
  let registering = false;
  let enrollmentGeneration = 0;
  let lastFaceVideoTime = -1;
  let lastPreviewAt = 0;
  let lastResult = null;
  let nextTemporaryId = 1;
  let temporaryTracks = [];
  const identityTracker = new window.QuantumFaceIdentityMath.FaceIdentityTracker();
  let recognitionReference = null;
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
    const sfaceEmbeddings = profiles.samples(item, profiles.ONNX);
    const engine = sfaceEmbeddings.length ? profiles.engineFor({embeddings:humanEmbeddings,sfaceEmbeddings})
      : humanEmbeddings.length ? HUMAN_ENGINE : legacyDescriptors.length ? "face-api-legacy" : "";
    if (!engine || typeof item.photo !== "string" || !item.photo.startsWith("data:image/")) return null;
    return {
      id: String(item.id),
      name: item.name.trim().slice(0, 60),
      engine,
      embeddings: humanEmbeddings,
      sfaceEmbeddings,
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

  function mergeEmbeddings(existing = [], incoming = [], engine = HUMAN_ENGINE) {
    return window.QuantumFaceIdentityMath.mergeSamples(existing, incoming, MAX_SAMPLES_PER_IDENTITY, profiles.profile(engine).length);
  }

  function desiredEngine() {
    if (personName.value.trim()) return profiles.DEFAULT_ENGINE;
    const selected = identities.find(item => item.id === selectedTargetId);
    if (selected) return profiles.engineFor(selected);
    // Existing galleries continue working until their owner updates the face.
    if (identities.some(item => profiles.samples(item, HUMAN_ENGINE).length)
      && !identities.some(item => profiles.samples(item, profiles.ONNX).length >= 3)) return HUMAN_ENGINE;
    return profiles.DEFAULT_ENGINE;
  }

  function similarity(first, second, engine = activeEngine) {
    return engine === profiles.ONNX ? window.QuantumFaceONNXMath.cosine(first, second)
      : human.match.similarity(first, second, MATCH_OPTIONS);
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
      const recordEngine = profiles.engineFor(identity);
      const sampleCount = profiles.samples(identity, recordEngine).length;
      const incomplete = !legacy && sampleCount < window.QuantumFaceIdentityMath.MIN_REFERENCE_SAMPLES;
      id.textContent = legacy ? `${identity.id} · LEGADO — RECADASTRE` : `${identity.id} · ${sampleCount} amostras`;
      if (incomplete) id.textContent += ' · complete o cadastro';
      id.classList.toggle("legacy", legacy);
      text.append(name, id);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Excluir";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Excluir ${identity.name} (${identity.id}) deste navegador?`)) return;
        await deleteRecord(identity.id);
        identities = identities.filter((item) => item.id !== identity.id);
        resetRecognition();
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
      follow.textContent = incomplete ? 'Completar cadastro' : selectedTargetId === identity.id ? "Parar de seguir" : "Seguir";
      follow.setAttribute("aria-pressed", String(selectedTargetId === identity.id));
      follow.disabled = legacy;
      follow.addEventListener("click", () => {
        if (registering) { ++enrollmentGeneration; registering = false; setSampleProgress(0); }
        if (incomplete) {
          selectedTargetId = null;
          personName.value = identity.name;
          renderIdentities();
          publishPersonTracking([], true);
          window.quantumPersonFollower?.prepare();
          personName.focus();
          return;
        }
        selectedTargetId = selectedTargetId === identity.id ? null : identity.id;
        resetRecognition();
        personName.value = '';
        renderIdentities();
        currentFaces = [];
        qualityStabilizer.reset();
        publishPersonTracking([], true);
        if (selectedTargetId) window.quantumPersonFollower?.prepare();
      });
      actions.append(follow, remove);
      if (recordEngine === HUMAN_ENGINE && profiles.DEFAULT_ENGINE !== HUMAN_ENGINE) {
        const upgrade = document.createElement('button');
        upgrade.type = 'button'; upgrade.className = 'upgrade-person'; upgrade.textContent = 'Atualizar reconhecimento';
        upgrade.addEventListener('click', () => {
          selectedTargetId = null; personName.value = identity.name; currentFaces = [];
          qualityStabilizer.reset(); renderIdentities(); updatePanel([]); publishPersonTracking([], true);
          window.quantumPersonFollower?.prepare(); personName.focus();
        });
        actions.append(upgrade);
      }
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
    const confidence = Number(face.faceScore || face.boxScore || face.score || 0);
    const size = Math.min(Number(face.box?.[2] || 0), Number(face.box?.[3] || 0));
    const angle = face.rotation?.angle || {};
    const yaw = Number(angle.yaw || 0);
    const pitch = Number(angle.pitch || 0);
    const roll = Number(angle.roll || 0);
    const poseByAngle = Math.abs(yaw) <= 0.38 && Math.abs(pitch) <= 0.34 && Math.abs(roll) <= 0.42;
    const pose = gestures.includes("facing center") || poseByAngle;
    const embedding = Array.isArray(face.embedding) ? face.embedding : [];
    // SCRFD returns a tighter facial box than Human; SFace aligns to 112 px.
    const requiredSize = activeEngine === profiles.ONNX ? 100 : MIN_FACE_SIZE;
    const validations = {
      single: result.face.length === 1,
      size: size >= requiredSize,
      pose,
      fresh: Number.isFinite(capturedAt) && capturedAt <= performance.now() && performance.now() - capturedAt <= 800,
      descriptor: profiles.valid(embedding, activeEngine),
      confidence: confidence >= MIN_CONFIDENCE,
    };
    const acceptable = !trackingOnly && validations.single && validations.size && validations.pose
      && validations.fresh && validations.descriptor && validations.confidence;
    const combined = (confidence + Math.min(1, size / 300)) / 2;
    let reason = "Rosto válido para cadastro.";
    if (!validations.single) reason = "Deixe apenas uma pessoa na imagem.";
    else if (!validations.size) reason = "Aproxime o rosto da câmera.";
    else if (!validations.pose) reason = "Olhe de frente para a câmera.";
    else if (!validations.confidence) reason = "Melhore a iluminação e mantenha o rosto visível.";
    else if (!validations.descriptor) reason = "Aguarde uma leitura facial nítida antes de cadastrar.";
    else if (!validations.fresh) reason = "Imagem atrasada. Aguarde uma leitura nova da câmera.";
    else if (trackingOnly) reason = "Identificação ativa. Para cadastrar, digite o nome abaixo.";
    return qualityStabilizer.update(trackingKey, {
      confidence, size, embedding, validations, acceptable, combined, reason, trackingOnly,
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

  function resetRecognition() {
    identityTracker.reset();
    recognitionReference = null;
    window.quantumFaceRecognition = null;
  }

  function identifyFace(face, capturedAt, tracking) {
    const box = boxObject(face);
    const engineProfile = profiles.profile(activeEngine);
    if (!profiles.valid(face.embedding, activeEngine)) {
      resetRecognition();
      window.quantumFaceDiagnostics = {
        known: identities.length,
        bestSimilarity: 0,
        decision: "INVALID_EMBEDDING",
        threshold: engineProfile.threshold,
        embeddingLength: face.embedding?.length || 0,
        compared: [],
      };
      return { id: temporaryIdFor(box), name: "Não cadastrado", registered: false, similarity: 0 };
    }
    const known = identities.filter((identity) => profiles.samples(identity, activeEngine).length);
    const compared = known.map((identity) => ({
      identity,
      scores: profiles.samples(identity, activeEngine).map((reference) => similarity(face.embedding, reference)),
    }));
    const decision = tracking ? identityTracker.update({ candidates: compared, profile: engineProfile,
      box, capturedAt, now: performance.now(), single: true,
      confidence: Number(face.faceScore || face.boxScore || face.score || 0),
      referenceSimilarity: recognitionReference ? similarity(face.embedding, recognitionReference) : NaN,
    }) : window.QuantumFaceIdentityMath.chooseIdentity(compared, engineProfile);
    if (tracking && decision.reason === 'MATCH') recognitionReference = face.embedding.slice();
    else if (!decision.accepted) recognitionReference = null;
    const bestIdentity = decision.identity;
    const bestSimilarity = decision.similarity;
    window.quantumFaceDiagnostics = {
      known: known.length,
      bestSimilarity,
      secondSimilarity: decision.secondSimilarity,
      margin: decision.margin,
      decision: decision.reason,
      threshold: engineProfile.threshold,
      engine: activeEngine,
      embeddingLength: face.embedding?.length || 0,
      selfSimilarity: similarity(face.embedding, face.embedding),
      compared: decision.ranked.map((candidate) => ({
        id: candidate.identity.id,
        name: candidate.identity.name,
        scores: candidate.scores,
        similarity: candidate.similarity,
      })),
    };
    if (decision.accepted && bestIdentity) {
      return { id: bestIdentity.id, name: bestIdentity.name, registered: true,
        similarity: bestSimilarity, reason: decision.reason };
    }
    return { id: temporaryIdFor(box), name: "Não cadastrado", registered: false,
      similarity: bestSimilarity, reason: decision.reason };
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

  let lastMeshDrawnAt = -Infinity;
  function drawFaces(faces) {
    window.QuantumFaceMesh.draw(context, faces.map(item => item.face), human?.faceTriangulation, canvas.width, canvas.height);
    if (faces.some(item => item.face.mesh?.length)) lastMeshDrawnAt = performance.now();
  }

  faceInference.onMesh = ({ id, faces }) => {
    if (!cameraActive || activeView !== 'face' || lastResult?.frameId !== id || !Array.isArray(faces)) return;
    const { scaleX, scaleY } = lastResult.processing;
    currentFaces.forEach((item, index) => {
      item.face.mesh = faces[index]?.mesh?.map(p => [p[0] * scaleX, p[1] * scaleY, (p[2] || 0) * scaleX]);
    });
    // A late visual update never refreshes identity evidence or motor commands.
    drawFaces(currentFaces);
  };

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
    const selected = identities.find(identity => identity.id === selectedTargetId);
    const existing = identityByName(personName.value);
    const identityConflict = item?.identity.registered && item.identity.id !== existing?.id;
    registerButton.disabled = !(item && !identityConflict && item.quality.acceptable
      && item.quality.rawAcceptable && personName.value.trim() && !registering);
    if (!registering) registerButton.textContent = existing ? `Atualizar rosto de ${existing.name}` : "Validar e cadastrar rosto";
    setCheck(checks.single, faces.length === 1);
    if (!item) {
      resetMetrics();
      setCheck(checks.single, faces.length === 1);
      currentFaceId.textContent = faces.length ? `${faces.length} ROSTOS` : selected ? 'ROSTO FORA DE VISTA' : 'NENHUM';
      faceHint.textContent = faces.length ? 'Para cadastrar, deixe apenas uma pessoa na imagem.'
        : selected ? `O alvo escolhido continua sendo ${selected.name}. Nenhum rosto detectado nesta leitura.`
          : 'Nenhum rosto detectado. Olhe de frente para a câmera.';
      facePreview.classList.remove("has-image");
      return;
    }
    const quality = item.quality;
    faceConfidence.textContent = `${Math.round(quality.confidence * 100)}%`;
    faceQuality.textContent = quality.trackingOnly ? 'IDENTIFICAÇÃO' : quality.label;
    faceQuality.className = quality.trackingOnly || quality.acceptable ? "good" : "bad";
    faceSimilarity.textContent = item.identity.similarity ? `${Math.round(item.identity.similarity * 100)}%` : "—";
    setCheck(checks.single, quality.validations.single);
    setCheck(checks.size, quality.validations.size);
    setCheck(checks.pose, quality.validations.pose);
    currentFaceId.textContent = registering ? 'CAPTURANDO'
      : selectedTargetId && !item.identity.registered ? 'NÃO CONFIRMADO' : item.identity.id;
    if (!registering) {
      faceHint.textContent = selectedTargetId && !item.identity.registered
        ? item.identity.reason === 'AMBIGUOUS'
          ? 'Leitura parecida com mais de um cadastro. Separe as pessoas na imagem.'
          : 'Rosto visível, mas a identidade não conferiu nesta leitura. Mantenha o rosto nítido; a confirmação é automática.'
        : item.identity.registered
        ? `${item.identity.name} reconhecido(a). ${selectedTargetId === item.identity.id
          ? 'Alvo do seguimento. Veja o estado do Modo 2 acima.' : 'Clique em Seguir no cadastro para iniciar o Modo 2.'}`
        : quality.acceptable
          ? `Rosto pronto. Digite o nome e capture ${REQUIRED_SAMPLES} amostras.`
          : quality.reason;
      if (selectedTargetId && item.identity.id !== selectedTargetId) {
        faceHint.textContent += ` O alvo escolhido permanece ${selected?.name || selectedTargetId}.`;
      }
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

  async function loadModels(engine = desiredEngine()) {
    if (modelsReady && faceInference.ready && activeEngine === engine) return;
    if (modelsPromise && modelsPromiseEngine === engine) return modelsPromise;
    if (modelsPromise) await modelsPromise.catch(() => {});
    if (modelsReady && faceInference.ready && activeEngine === engine) return;
    if (window.location?.protocol === "file:") {
      throw new Error("O FaceID exige o site HTTPS. Abra https://jgouveaf.github.io/FECART/.");
    }
    setStatus("CARREGANDO FACEID", true);
    faceHint.textContent = 'Preparando o reconhecimento local. Na primeira abertura, aguarde o download dos modelos.';
    control?.patch("vision", { active: false, status: "LOADING", tracking: "SEARCHING" }, { source: "face-model" });
    control?.log("INFO", "VISÃO", `Carregando FaceID local: ${engine}`);
    currentFaces = []; registerButton.disabled = true;
    resetRecognition();
    publishPersonTracking([], true);
    faceInference.close(); modelsReady = false;
    modelsPromiseEngine = engine;
    modelsPromise = (async () => {
      const HumanLibrary = await loadHumanLibrary();
      const candidate = new HumanLibrary.Human(humanConfig);
      await faceInference.load({...humanConfig, identityEngine: engine});
      human = candidate;
      activeEngine = engine;
      modelsReady = true;
      control?.log("INFO", "VISÃO", `FaceID local pronto: ${engine}`);
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
      modelsPromiseEngine = null;
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
        resetRecognition();
        qualityStabilizer.reset();
        drawFaces([]);
        updatePanel([]);
        publishPersonTracking([]);
      }
      return;
    }
    lastFaceVideoTime = video.currentTime;
    let capturedAt = performance.now();
    const generation = detectionGeneration;
    const expectedEngine = desiredEngine();
    detectionBusy = true;
    try {
      if (!modelsReady || !faceInference.ready || activeEngine !== expectedEngine) {
        qualityStabilizer.reset();
        await loadModels(expectedEngine);
      }
      if (generation !== detectionGeneration || !cameraActive || expectedEngine !== desiredEngine() || activeEngine !== expectedEngine) return;
      capturedAt = performance.now();
      disposeResult(lastResult);
      lastResult = null;
      const processing = window.QuantumFaceProcessing.plan({ width: video.videoWidth, height: video.videoHeight,
        modeTwo: Number(control?.state.mode.id) === 2 && control?.state.mode.phase === 'ACTIVE',
        enrolling: registering || Boolean(personName.value.trim()) });
      const result = await faceInference.detect(video, processing.config);
      if (generation !== detectionGeneration || !cameraActive || activeView !== "face" || expectedEngine !== desiredEngine()) {
        disposeResult(result);
        return;
      }
      lastResult = result;
      lastResult.processing = processing;
      consecutiveInferenceErrors = 0;
      nextDetectionDelayMs = DETECTION_DELAY_MS;
      if (retryDetectionButton) retryDetectionButton.hidden = true;
      const detectedAt = performance.now();
      window.quantumFacePerformance = { processingMs: Math.round(detectedAt - capturedAt),
        backend: result.backend || 'local', engine: activeEngine, profile: processing.tracking ? 'tracking' : 'enrollment',
        stages: result.performance || null };
      if (result.face.length !== 1) qualityStabilizer.reset();
      const trackIdentity = processing.tracking && Boolean(selectedTargetId) && result.face.length === 1;
      if (!trackIdentity) resetRecognition();
      const faces = result.face.map((rawFace) => {
        const face = window.QuantumFaceProcessing.restore(rawFace, processing.scaleX, processing.scaleY);
        const identity = identifyFace(face, capturedAt, trackIdentity);
        return {
          face,
          identity,
          quality: assessFace(face, result, identity.id, capturedAt, processing.tracking),
          detectedAt,
          capturedAt,
        };
      });
      // Export only decision metrics, never names, IDs, photos or descriptors.
      window.quantumFaceRecognition = { faceCount: faces.length, capturedAt,
        decision: faces.length === 1 ? window.quantumFaceDiagnostics.decision : faces.length ? 'MULTIPLE_FACES' : 'NO_FACE',
        similarity: faces.length === 1 ? window.quantumFaceDiagnostics.bestSimilarity : null,
        margin: faces.length === 1 ? window.quantumFaceDiagnostics.margin ?? null : null,
        threshold: profiles.profile(activeEngine).threshold };
      // Keep the most recent measured mesh between its slower visual updates.
      // Clear it on a changed/lost face, a large jump, or visual expiry.
      const previousFace = currentFaces.length === 1 ? currentFaces[0] : null;
      const keepMesh = processing.config.identityFirst && activeEngine === profiles.ONNX && faces.length === 1
        && previousFace?.identity.id === faces[0].identity.id && performance.now() - lastMeshDrawnAt <= 600
        && window.QuantumFaceONNXMath.overlap(previousFace.face.box, faces[0].face.box) >= .5;
      if (!keepMesh) drawFaces(faces);
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
      resetRecognition();
      currentFaces = [];
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
    resetRecognition();
    const generation = ++detectionGeneration;
    cameraActive = true;
    lastFaceVideoTime = -1;
    qualityStabilizer.reset();
    updatePanel([]);
    resetInferenceCircuit();
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 540;
    if (activeView !== "face") return;
    try {
      await loadIdentities();
      await loadModels();
      if (generation !== detectionGeneration || !cameraActive || activeView !== "face") return;
      setStatus("RECONHECIMENTO LOCAL PRONTO", true);
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
    resetRecognition();
    ++detectionGeneration;
    ++enrollmentGeneration;
    cameraActive = false;
    registering = false;
    clearTimeout(detectionTimer);
    disposeResult(lastResult);
    lastResult = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    currentFaces = [];
    temporaryTracks = [];
    window.quantumFacePerformance = null;
    qualityStabilizer.reset();
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

  personName.addEventListener("input", () => {
    if (registering) { ++enrollmentGeneration; registering = false; setSampleProgress(0); }
    if (activeEngine !== desiredEngine()) {
      currentFaces = []; qualityStabilizer.reset(); publishPersonTracking([], true);
    }
    updatePanel(currentFaces);
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
    const enrollmentEngine = activeEngine;
    const enrollmentProfile = profiles.profile(enrollmentEngine);
    const token = ++enrollmentGeneration;
    publishPersonTracking(currentFaces, true);
    registerButton.disabled = true;
    const embeddings = [];
    const photo = captureFace(item.face);
    try {
      for (let index = 0; index < REQUIRED_SAMPLES; index += 1) {
        if (index > 0) item = await waitForFreshFace(item.capturedAt, existing?.id || null, token);
        if (token !== enrollmentGeneration) throw new Error("Cadastro cancelado.");
        if (activeEngine !== enrollmentEngine || !profiles.valid(item.quality.embedding, enrollmentEngine)) throw new Error('Reconhecimento mudou; reinicie o cadastro.');
        if (embeddings.length && similarity(item.quality.embedding, embeddings[0], enrollmentEngine) < enrollmentProfile.threshold) {
          throw new Error("O rosto mudou durante a captura. Cadastre uma pessoa por vez.");
        }
        embeddings.push(Array.from(item.quality.embedding));
        setSampleProgress(index + 1);
        registerButton.textContent = `Capturando ${index + 1}/${REQUIRED_SAMPLES}`;
        faceHint.textContent = index + 1 < REQUIRED_SAMPLES ? "Continue olhando de frente para a câmera." : "Salvando cadastro local…";
      }
      const identity = {
        id: existing?.id || nextPermanentId(),
        name,
        engine: enrollmentEngine,
        embeddings: existing?.embeddings || [],
        sfaceEmbeddings: existing?.sfaceEmbeddings || [],
        [enrollmentProfile.field]: mergeEmbeddings(profiles.samples(existing,enrollmentEngine), embeddings, enrollmentEngine),
        descriptors: [],
        photo,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        enrollment: {
          samples: mergeEmbeddings(profiles.samples(existing,enrollmentEngine), embeddings, enrollmentEngine).length,
          confidence: item.quality.confidence,
          presenceMethod: 'NOT_REQUIRED',
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
        ? `${identity.name} atualizado(a). O cadastro agora possui ${identity[enrollmentProfile.field].length} amostras.`
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
    const backup = { format: "quantum-tracker-face-identities", version: 4, engine: 'multi-engine', exportedAt: new Date().toISOString(), identities };
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
          const sfaceEmbeddings = mergeEmbeddings(sameName.sfaceEmbeddings, candidate.sfaceEmbeddings, profiles.ONNX);
          const merged = {
            ...sameName,
            engine: sfaceEmbeddings.length ? profiles.engineFor({embeddings:mergedEmbeddings,sfaceEmbeddings}) : mergedEmbeddings.length ? HUMAN_ENGINE : sameName.engine,
            embeddings: mergedEmbeddings,
            sfaceEmbeddings,
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
    resetRecognition();
    const generation = ++detectionGeneration;
    activeView = event.detail?.view === "hand" ? "hand" : "face";
    clearTimeout(detectionTimer);
    if (activeView !== "face") {
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
