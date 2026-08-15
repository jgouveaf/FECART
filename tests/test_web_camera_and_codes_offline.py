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
        cls.code_bundle_js = (ROOT / "web" / "arduino-codes.js").read_text(encoding="utf-8")
        object_source = cls.code_bundle_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0]
        cls.code_bundle = json.loads(object_source)

    def test_camera_and_code_tabs_exist(self) -> None:
        for required in (
            'id="camera-gestos"',
            'id="cameraVideo"',
            'id="gestureCommand"',
            'id="codigos"',
            'id="arduinoCode"',
            'web/arduino-codes.js?v=3',
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

    def test_web_test_never_opens_serial_or_contains_secret(self) -> None:
        public = "\n".join((self.html, self.app_js, self.camera_js, self.code_bundle_js))
        self.assertNotIn("navigator.serial", public)
        self.assertNotIn("sk-proj-", public)
        self.assertIn("não movimenta o Arduino", self.html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
