"""Executa a geometria de gestos e a histerese facial reais em JavaScript."""

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
    if executable:
        return Path(executable)
    runtime_root = Path.home() / ".cache" / "codex-runtimes"
    candidates = sorted(runtime_root.glob("*/dependencies/node/bin/node.exe")) if runtime_root.is_dir() else []
    return candidates[0] if candidates else None


HARNESS = r"""
global.window = globalThis;
require(process.env.QT_GESTURE_MATH);
require(process.env.QT_FACE_QUALITY);

function point(x = 0, y = 0, z = 0) { return { x, y, z }; }

function hand(count, mirrored = false) {
  const p = Array.from({ length: 21 }, () => point());
  p[0] = point(0, -0.09);
  const xs = [-0.03, 0, 0.03, 0.055];
  const chains = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  chains.forEach((chain, index) => {
    const x = xs[index];
    p[chain[0]] = point(x, 0);
    if (index < Math.min(count, 4)) {
      p[chain[1]] = point(x, 0.04);
      p[chain[2]] = point(x, 0.075);
      p[chain[3]] = point(x, 0.11);
    } else {
      p[chain[1]] = point(x, 0.035);
      p[chain[2]] = point(x, 0.018);
      p[chain[3]] = point(x, 0.002);
    }
  });
  p[1] = point(-0.035, -0.02);
  if (count === 5) {
    p[2] = point(-0.06, 0);
    p[3] = point(-0.085, 0.025);
    p[4] = point(-0.115, 0.05);
  } else {
    p[2] = point(-0.045, 0);
    p[3] = point(-0.025, 0.025);
    p[4] = point(0.005, 0.025);
  }
  return mirrored ? p.map((item) => point(-item.x, item.y, -item.z)) : p;
}

const counts = {};
for (let count = 1; count <= 5; count += 1) {
  counts[count] = {
    palm: window.QuantumGestureMath.classifyFingerCount(hand(count, false), hand(count, false)),
    back: window.QuantumGestureMath.classifyFingerCount(hand(count, true), hand(count, true)),
  };
}

const fingerStabilizer = new window.QuantumGestureMath.FingerStateStabilizer();
const fourFingerFrame = { probabilities: [0.20, 0.90, 0.90, 0.90, 0.90], fingerDetails: [] };
const fiveFingerNoise = { probabilities: [0.95, 0.90, 0.90, 0.90, 0.90], fingerDetails: [] };
const stableFour = fingerStabilizer.update(fourFingerFrame).count;
const afterOneNoisyFrame = fingerStabilizer.update(fiveFingerNoise).count;
let afterSustainedFive;
for (let frame = 0; frame < 3; frame += 1) afterSustainedFive = fingerStabilizer.update(fiveFingerNoise).count;
let afterSustainedFour;
for (let frame = 0; frame < 3; frame += 1) afterSustainedFour = fingerStabilizer.update(fourFingerFrame).count;

const stabilizer = new window.QuantumFaceQuality.FaceQualityStabilizer();
const high = { acceptable: true, combined: 0.90 };
const briefLow = { acceptable: false, combined: 0.70 };
let result;
for (let frame = 0; frame < 5; frame += 1) result = stabilizer.update("QT-01", high, frame * 70);
const afterRise = { acceptable: result.acceptable, label: result.label };
const alternating = [];
for (let frame = 0; frame < 8; frame += 1) {
  result = stabilizer.update("QT-01", frame % 2 ? high : briefLow, 400 + frame * 70);
  alternating.push(result.label);
}
for (let frame = 0; frame < 4; frame += 1) result = stabilizer.update("QT-01", briefLow, 1000 + frame * 70);
const afterSustainedLow = { acceptable: result.acceptable, label: result.label };

process.stdout.write(JSON.stringify({ counts, stableFour, afterOneNoisyFrame, afterSustainedFive, afterSustainedFour, afterRise, alternating, afterSustainedLow }));
"""


class TestWebQualityAlgorithms(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        node = find_node()
        if node is None:
            raise unittest.SkipTest("Node.js não está disponível")
        environment = os.environ.copy()
        environment["QT_GESTURE_MATH"] = str(ROOT / "web" / "gesture-math.js")
        environment["QT_FACE_QUALITY"] = str(ROOT / "web" / "face-quality.js")
        completed = subprocess.run(
            [str(node), "-"],
            cwd=ROOT,
            env=environment,
            input=HARNESS,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=15,
            check=False,
        )
        if completed.returncode != 0:
            raise AssertionError(f"Teste JavaScript falhou:\n{completed.stdout}\n{completed.stderr}")
        cls.result = json.loads(completed.stdout)

    def test_finger_count_is_equal_for_palm_and_back_of_hand(self) -> None:
        for count in range(1, 6):
            with self.subTest(count=count):
                self.assertEqual(self.result["counts"][str(count)]["palm"], count)
                self.assertEqual(self.result["counts"][str(count)]["back"], count)

    def test_face_quality_uses_rise_fall_hysteresis(self) -> None:
        self.assertEqual(self.result["afterRise"], {"acceptable": True, "label": "ALTA"})
        self.assertEqual(set(self.result["alternating"]), {"ALTA"})
        self.assertEqual(self.result["afterSustainedLow"], {"acceptable": False, "label": "BAIXA"})

    def test_finger_hysteresis_ignores_one_noisy_frame_but_accepts_sustained_change(self) -> None:
        self.assertEqual(self.result["stableFour"], 4)
        self.assertEqual(self.result["afterOneNoisyFrame"], 4)
        self.assertEqual(self.result["afterSustainedFive"], 5)
        self.assertEqual(self.result["afterSustainedFour"], 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
