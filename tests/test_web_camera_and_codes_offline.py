"""Valida as novas abas web sem abrir camera, serial ou robo."""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class TestWebCameraAndCodesOffline(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.app_js = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
        cls.camera_js = (ROOT / "web" / "camera-gestures.js").read_text(encoding="utf-8")
        cls.camera_controller_js = (ROOT / "web" / "camera-controller.js").read_text(encoding="utf-8")
        cls.control_state_js = (ROOT / "web" / "control-state.js").read_text(encoding="utf-8")
        cls.face_js = (ROOT / "web" / "face-identities.js").read_text(encoding="utf-8")
        cls.robot_js = (ROOT / "web" / "robot-control.js").read_text(encoding="utf-8")
        cls.code_bundle_js = (ROOT / "web" / "arduino-codes.js").read_text(encoding="utf-8")
        cls.code_editor_utils_js = (ROOT / "web" / "code-editor-utils.js").read_text(encoding="utf-8")
        cls.auth_js = (ROOT / "web" / "auth-gate.js").read_text(encoding="utf-8")
        cls.config_js = (ROOT / "web" / "user-config.js").read_text(encoding="utf-8")
        object_source = cls.code_bundle_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0]
        cls.code_bundle = json.loads(object_source)

    def test_camera_and_code_tabs_exist(self) -> None:
        for required in (
            'id="camera-gestos"',
            'id="cameraVideo"',
            'id="faceCameraTab"',
            'id="handCameraTab"',
            'id="gestureCommand"',
            'id="identityCanvas"',
            'id="registerPerson"',
            'id="registeredPeople"',
            'id="codigos"',
            'id="arduinoCode"',
            'web/arduino-codes.js?v=11',
            'web/user-config.js?v=2',
            'web/control-state.js?v=1',
            'web/camera-controller.js?v=2',
            'web/face-quality.js?v=1',
            'web/gesture-math.js?v=4',
            'id="flashOfficialFirmware"',
            'web/arduino-flasher.js?v=4',
            'web/simulator-controller.js?v=2',
            'web/robot-control.js?v=12',
            'web/code-editor-utils.js?v=1',
            'web/face-identity-math.js?v=2',
            'web/face-identities.js?v=14',
            'id="toggleGestures"',
            'id="cameraDeviceSelect"',
            'id="retryFaceDetection"',
        ):
            self.assertIn(required, self.html)

    def test_arduino_installation_workflow_is_explicit(self) -> None:
        self.assertIn("Gravar pelo site", self.html)
        self.assertIn("Aguardar 100%", self.html)
        self.assertIn("O firmware oficial pode ser instalado diretamente pelo site.", self.html)
        self.assertIn('id="flashOfficialFirmware"', self.html)

    def test_every_code_source_exists_and_is_an_arduino_sketch(self) -> None:
        sources = re.findall(r'data-code-source="([^"]+)"', self.html)
        self.assertEqual(len(sources), 3)
        for relative in sources:
            path = ROOT / relative
            self.assertTrue(path.is_file(), path)
            code = path.read_text(encoding="utf-8")
            self.assertIn("void setup()", code)
            self.assertIn("void loop()", code)
            self.assertEqual(self.code_bundle[relative], code)

    def test_code_tabs_support_keyboard_navigation(self) -> None:
        self.assertIn('id="codeViewer" role="tabpanel"', self.html)
        self.assertIn('tabindex="-1"', self.html)
        self.assertIn('["ArrowLeft", "ArrowRight", "Home", "End"]', self.app_js)
        self.assertIn("item.tabIndex = selected ? 0 : -1", self.app_js)

    def test_code_editor_import_is_validated_and_protects_unsaved_changes(self) -> None:
        for marker in ('id="updateCode"', 'id="codeFileInput"', 'Passo a passo para trocar o código'):
            self.assertIn(marker, self.html)
        self.assertIn("MAX_CODE_FILE_BYTES = 256 * 1024", self.code_editor_utils_js)
        self.assertIn("validateArduinoCode", self.code_editor_utils_js)
        self.assertIn("normalizeImportedCode", self.code_editor_utils_js)
        self.assertIn("await file.text()", self.app_js)
        self.assertIn('window.addEventListener("beforeunload"', self.app_js)
        self.assertIn("codeHasUnsavedChanges()", self.app_js)
        self.assertIn("window.localStorage.getItem(CODE_EDIT_PREFIX + source) === code", self.app_js)

    def test_password_visibility_logout_and_quick_guide_are_available(self) -> None:
        self.assertIn('id="togglePassword"', self.auth_js)
        self.assertIn('passwordInput.type = showing ? "password" : "text"', self.auth_js)
        self.assertIn('aria-pressed', self.auth_js)
        self.assertIn('id="logoutButton"', self.html)
        self.assertIn('id="guia"', self.html)
        self.assertIn("Guia rápido de operação", self.html)

    def test_user_configuration_is_applied_without_reload(self) -> None:
        self.assertIn('new CustomEvent("quantum:user-config-changed"', self.config_js)
        self.assertIn('window.addEventListener("quantum:user-config-changed"', self.camera_js)
        self.assertIn("renderGestureMapLabels()", self.camera_js)
        self.assertIn("window.localStorage.getItem(STORAGE_KEY) === serialized", self.config_js)
        self.assertNotIn("Recarregue a página", self.html)

    def test_main_firmware_pin_map_matches_declared_wiring(self) -> None:
        code = (ROOT / "firmware" / "quantum_tracker_arduino" / "quantum_tracker_arduino.ino").read_text(encoding="utf-8")
        for declaration in (
            "const byte IN1 = 7;",
            "const byte IN2 = 6;",
            "const byte IN3 = 5;",
            "const byte IN4 = 4;",
            "const byte TRIG = 3;",
            "const byte ECHO = 2;",
        ):
            self.assertIn(declaration, code)

    def test_browser_gesture_map_matches_project_rules(self) -> None:
        expected = {1: "FRENTE", 2: "DIREITA", 3: "ESQUERDA", 4: "PARAR", 5: "GIRAR"}
        for fingers, command in expected.items():
            self.assertRegex(self.camera_js, rf'{fingers}:\s*"{command}"')
        self.assertIn("HandLandmarker", self.camera_js)
        self.assertIn("getUserMedia", self.camera_controller_js)
        self.assertIn("NotAllowedError", self.camera_controller_js)
        self.assertIn('quantum:gesture-command', self.camera_js)
        self.assertIn('quantum:camera-view-changed', self.camera_js)

    def test_human_faceid_runtime_and_models_are_available_offline(self) -> None:
        vendor = ROOT / "web" / "vendor" / "human"
        self.assertGreater((vendor / "human.js").stat().st_size, 1_000_000)
        models = vendor / "models"
        for filename in (
            "blazeface.json", "blazeface.bin",
            "facemesh.json", "facemesh.bin",
            "iris.json", "iris.bin",
            "faceres.json", "faceres.bin",
            "antispoof.json", "antispoof.bin",
            "liveness.json", "liveness.bin",
        ):
            self.assertGreater((models / filename).stat().st_size, 100)
        self.assertNotIn('<script src="web/vendor/human/human.js?v=3.3.6"', self.html)
        self.assertIn('web/vendor/human/human.js?v=3.3.6', self.face_js)
        self.assertIn("loadHumanLibrary", self.face_js)
        self.assertIn('script.dataset.quantumHumanRuntime = "true"', self.face_js)
        self.assertIn("new HumanLibrary.Human", self.face_js)

    def test_face_identity_uses_indexeddb_and_migrates_legacy_records(self) -> None:
        self.assertIn('DB_NAME = "quantum_tracker_biometrics"', self.face_js)
        self.assertIn("indexedDB.open", self.face_js)
        self.assertIn("quantum_tracker_indexeddb_migrated_v1", self.face_js)
        self.assertIn("face-api-legacy", self.face_js)
        self.assertIn("LEGADO — RECADASTRE", self.face_js)
        self.assertIn("QT-", self.face_js)
        self.assertIn("quantum:camera-started", self.camera_controller_js)
        self.assertIn('window.addEventListener("quantum:camera-started"', self.face_js)

    def test_face_registration_uses_five_1024_value_embeddings(self) -> None:
        self.assertRegex(self.face_js, r"REQUIRED_SAMPLES\s*=\s*5")
        self.assertRegex(self.face_js, r"EMBEDDING_LENGTH\s*=\s*1024")
        self.assertIn("embeddings.push", self.face_js)
        self.assertIn("human.match.similarity", self.face_js)
        self.assertIn("MATCH_THRESHOLD", self.face_js)
        self.assertIn("QuantumFaceIdentityMath.chooseIdentity", self.face_js)
        self.assertIn('id="faceQuality"', self.html)
        self.assertIn('id="faceSimilarity"', self.html)
        self.assertIn('id="sampleProgress"', self.html)

    def test_face_registration_validates_pose_size_presence_and_liveness(self) -> None:
        for setting in ("MIN_CONFIDENCE", "MIN_FACE_SIZE", "MIN_REAL", "MIN_LIVE"):
            self.assertIn(setting, self.face_js)
        for feature in ("rotation: true", "equalization: true", "antispoof", "liveness", "facing center"):
            self.assertIn(feature, self.face_js)
        for element_id in ("checkSingle", "checkSize", "checkPose", "checkReal", "checkLive", "checkBlink"):
            self.assertIn(f'id="{element_id}"', self.html)

    def test_face_registration_releases_model_tensors_and_keeps_detection_running(self) -> None:
        self.assertIn("human.tf.dispose", self.face_js)
        self.assertIn("DETECTION_DELAY_MS", self.face_js)
        self.assertIn("scheduleDetection", self.face_js)
        self.assertIn("recognitionMemory", self.face_js)
        self.assertIn('quantum:person-tracking', self.face_js)

    def test_face_inference_has_backoff_circuit_breaker_and_manual_retry(self) -> None:
        self.assertIn("MAX_CONSECUTIVE_INFERENCE_ERRORS = 3", self.face_js)
        self.assertIn("MAX_INFERENCE_BACKOFF_MS = 4000", self.face_js)
        self.assertIn("inferenceSuspended = true", self.face_js)
        self.assertIn("retryDetectionButton?.addEventListener", self.face_js)
        self.assertIn('id="retryFaceDetection"', self.html)

    def test_camera_start_feedback_is_visible_on_face_tab(self) -> None:
        self.assertIn('id="cameraPlaceholderTitle"', self.html)
        self.assertIn('id="cameraPlaceholderHint"', self.html)
        self.assertIn('setBusy(true, "Ativando…")', self.camera_controller_js)
        self.assertIn('setPlaceholder("Não foi possível iniciar", message)', self.camera_controller_js)
        self.assertIn('new CustomEvent("quantum:camera-error"', self.camera_controller_js)
        self.assertIn('window.addEventListener("quantum:camera-error"', self.face_js)
        for error_name in ("NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError"):
            self.assertIn(error_name, self.camera_controller_js)

    def test_camera_controller_uses_compatible_classic_bootstrap(self) -> None:
        self.assertIn('id="startCamera">Ativar câmera', self.html)
        self.assertIn('src="web/camera-controller.js?v=2" defer', self.html)
        self.assertIn('src="web/camera-gestures.js?v=15" defer', self.html)
        self.assertNotIn('type="module" src="web/camera-gestures.js', self.html)
        self.assertIn("window.quantumCameraController", self.camera_controller_js)
        self.assertIn('startButton.textContent = "Ativar câmera"', self.camera_controller_js)
        self.assertIn("FALHA AO CARREGAR CONTROLE", self.html)

    def test_file_protocol_redirects_to_https_and_features_fail_closed(self) -> None:
        guard = self.html.index('window.location.protocol === "file:"')
        styles = self.html.index('<link rel="stylesheet"')
        self.assertLess(guard, styles)
        self.assertIn('publicSiteUrl = "https://jgouveaf.github.io/FECART/"', self.html)
        self.assertIn("window.location.replace(destination.href)", self.html)
        self.assertIn('window.location?.protocol === "file:"', self.camera_controller_js)
        self.assertIn('window.location?.protocol === "file:"', self.camera_js)
        self.assertIn('window.location?.protocol === "file:"', self.face_js)
        self.assertIn('window.location?.protocol === "file:"', self.robot_js)
        self.assertIn("Web Serial bloqueado em página aberta diretamente pelo disco", self.robot_js)

    def test_identity_backup_can_be_exported_and_imported(self) -> None:
        self.assertIn('id="exportIdentities"', self.html)
        self.assertIn('id="importIdentities"', self.html)
        self.assertIn('id="identityBackupFile"', self.html)
        self.assertIn('format: "quantum-tracker-face-identities"', self.face_js)
        self.assertIn("version: 3", self.face_js)
        self.assertIn("URL.createObjectURL", self.face_js)

    def test_web_test_never_opens_serial_or_contains_secret(self) -> None:
        public = "\n".join((self.html, self.app_js, self.camera_js, self.camera_controller_js, self.control_state_js, self.face_js, self.robot_js, self.code_bundle_js))
        self.assertIn("navigator.serial", self.robot_js)
        self.assertNotIn("sk-proj-", public)
        self.assertIn("PARADA DE EMERGÊNCIA", self.html)
        self.assertIn("timeout do Arduino", self.html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
