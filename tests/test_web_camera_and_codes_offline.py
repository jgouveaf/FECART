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
        cls.face_js = (ROOT / "web" / "face-identities.js").read_text(encoding="utf-8")
        cls.robot_js = (ROOT / "web" / "robot-control.js").read_text(encoding="utf-8")
        cls.code_bundle_js = (ROOT / "web" / "arduino-codes.js").read_text(encoding="utf-8")
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
            'web/arduino-codes.js?v=4',
            'web/robot-control.js?v=1',
        ):
            self.assertIn(required, self.html)

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
        self.assertIn("getUserMedia", self.camera_js)
        self.assertIn("NotAllowedError", self.camera_js)
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
        self.assertIn('web/vendor/human/human.js?v=3.3.6', self.html)
        self.assertIn("new HumanLibrary.Human", self.face_js)

    def test_face_identity_uses_indexeddb_and_migrates_legacy_records(self) -> None:
        self.assertIn('DB_NAME = "quantum_tracker_biometrics"', self.face_js)
        self.assertIn("indexedDB.open", self.face_js)
        self.assertIn("quantum_tracker_indexeddb_migrated_v1", self.face_js)
        self.assertIn("face-api-legacy", self.face_js)
        self.assertIn("LEGADO — RECADASTRE", self.face_js)
        self.assertIn("QT-", self.face_js)
        self.assertIn("quantum:camera-started", self.camera_js)

    def test_face_registration_uses_five_1024_value_embeddings(self) -> None:
        self.assertRegex(self.face_js, r"REQUIRED_SAMPLES\s*=\s*5")
        self.assertRegex(self.face_js, r"EMBEDDING_LENGTH\s*=\s*1024")
        self.assertIn("embeddings.push", self.face_js)
        self.assertIn("human.match.find", self.face_js)
        self.assertIn("MATCH_THRESHOLD", self.face_js)
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

    def test_identity_backup_can_be_exported_and_imported(self) -> None:
        self.assertIn('id="exportIdentities"', self.html)
        self.assertIn('id="importIdentities"', self.html)
        self.assertIn('id="identityBackupFile"', self.html)
        self.assertIn('format: "quantum-tracker-face-identities"', self.face_js)
        self.assertIn("version: 3", self.face_js)
        self.assertIn("URL.createObjectURL", self.face_js)

    def test_web_test_never_opens_serial_or_contains_secret(self) -> None:
        public = "\n".join((self.html, self.app_js, self.camera_js, self.face_js, self.robot_js, self.code_bundle_js))
        self.assertIn("navigator.serial", self.robot_js)
        self.assertNotIn("sk-proj-", public)
        self.assertIn("PARADA DE EMERGÊNCIA", self.html)
        self.assertIn("timeout do Arduino", self.html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
