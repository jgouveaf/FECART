"""Valida o gravador local de landmarks sem acessar câmera ou salvar imagens."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def find_node() -> Path | None:
    executable = shutil.which("node")
    return Path(executable) if executable else None


HARNESS = r"""
global.window = globalThis;
require(process.env.QT_GESTURE_CALIBRATION);
const Recorder = window.QuantumGestureCalibration.GestureCalibrationRecorder;
const recorder = new Recorder({ targetSamples: 5 });
const points = Array.from({ length: 21 }, (_, index) => ({ x: index / 21, y: 0.5, z: -0.01 }));
recorder.start({ expectedCount: 4, view: "BACK" });
for (let index = 0; index < 5; index += 1) {
  recorder.ingest({ imageLandmarks: points, worldLandmarks: points, frameTimeMs: index * 83, handedness: { label: "Right", score: 0.9 } });
}
const data = recorder.toJSON();
process.stdout.write(JSON.stringify({ snapshot: recorder.snapshot(), data, hasImage: JSON.stringify(data).includes("data:image") }));
"""


class TestWebGestureCalibration(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        node = find_node()
        if node is None:
            raise unittest.SkipTest("Node.js não está disponível")
        environment = os.environ.copy()
        environment["QT_GESTURE_CALIBRATION"] = str(ROOT / "web" / "gesture-calibration.js")
        completed = subprocess.run(
            [str(node), "-"], cwd=ROOT, env=environment, input=HARNESS,
            capture_output=True, text=True, encoding="utf-8", timeout=15, check=False,
        )
        if completed.returncode != 0:
            raise AssertionError(f"Teste JavaScript falhou:\n{completed.stdout}\n{completed.stderr}")
        cls.result = json.loads(completed.stdout)

    def test_capture_stops_exactly_at_target(self) -> None:
        self.assertEqual(self.result["snapshot"], {"active": False, "captured": 0, "target": 5, "total": 5, "expectedCount": None, "view": None})

    def test_export_preserves_human_label_and_landmarks(self) -> None:
        data = self.result["data"]
        self.assertEqual(data["schema"], "quantum-tracker/gesture-calibration-v1")
        self.assertEqual(data["samples"][0]["expectedCount"], 4)
        self.assertEqual(data["samples"][0]["view"], "BACK")
        self.assertEqual(len(data["samples"][0]["imageLandmarks"]), 21)

    def test_capture_contains_no_image_payload(self) -> None:
        self.assertFalse(self.result["hasImage"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
