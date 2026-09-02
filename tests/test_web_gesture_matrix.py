"""Matriz de 500 cenários 3D para a contagem de dedos do site."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CASE_COUNT = 500


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

const point = (x = 0, y = 0, z = 0) => ({ x, y, z });

function baseHand(count) {
  const p = Array.from({ length: 21 }, () => point());
  p[0] = point(0, -0.09, 0.005);
  const xs = [-0.032, 0, 0.031, 0.057];
  const chains = [[5,6,7,8], [9,10,11,12], [13,14,15,16], [17,18,19,20]];
  chains.forEach((chain, finger) => {
    const x = xs[finger];
    p[chain[0]] = point(x, 0, finger * 0.001);
    if (finger < Math.min(count, 4)) {
      p[chain[1]] = point(x + 0.003, 0.040, -0.004);
      p[chain[2]] = point(x + 0.006, 0.074, -0.008);
      p[chain[3]] = point(x + 0.010, 0.106, -0.010);
    } else {
      p[chain[1]] = point(x + 0.004, 0.033, -0.002);
      p[chain[2]] = point(x + 0.016, 0.020, -0.014);
      p[chain[3]] = point(x + 0.012, 0.002, -0.008);
    }
  });
  p[1] = point(-0.035, -0.022, 0.003);
  if (count === 5) {
    p[2] = point(-0.061, -0.002, -0.002);
    p[3] = point(-0.088, 0.022, -0.008);
    p[4] = point(-0.116, 0.047, -0.011);
  } else {
    p[2] = point(-0.046, -0.001, -0.002);
    p[3] = point(-0.026, 0.023, -0.012);
    p[4] = point(0.003, 0.024, -0.006);
  }
  return p;
}

function transform(points, side, rotationIndex, scaleIndex, caseIndex) {
  const rz = (-45 + rotationIndex * 10) * Math.PI / 180;
  const rx = (-22 + (rotationIndex % 5) * 11) * Math.PI / 180;
  const scale = [0.72, 0.86, 1.0, 1.16, 1.32][scaleIndex];
  return points.map((source, landmarkIndex) => {
    let x = source.x;
    let y = source.y;
    let z = source.z;
    const y1 = y * Math.cos(rx) - z * Math.sin(rx);
    const z1 = y * Math.sin(rx) + z * Math.cos(rx);
    y = y1; z = z1;
    const x2 = x * Math.cos(rz) - y * Math.sin(rz);
    const y2 = x * Math.sin(rz) + y * Math.cos(rz);
    x = x2; y = y2;
    if (side === 1) { x = -x; z = -z; }
    // Dorso da mão: o modelo costuma encurtar visualmente as pontas do anelar
    // e mindinho e produzir mais ruído de profundidade.
    if (side === 1 && [15, 16, 19, 20].includes(landmarkIndex)) {
      const compression = landmarkIndex === 16 || landmarkIndex === 20 ? 0.94 : 0.97;
      y *= compression;
      z *= 1.12;
    }
    const dorsalNoise = side === 1 && landmarkIndex >= 13 ? 1.45 : 1;
    const noise = Math.sin((caseIndex + 1) * (landmarkIndex + 3) * 1.618) * 0.0011 * scale * dorsalNoise;
    return point(x * scale + noise, y * scale - noise * 0.7, z * scale + noise * 0.4);
  });
}

const cases = [];
let index = 0;
for (let count = 1; count <= 5; count += 1) {
  for (let side = 0; side < 2; side += 1) {
    for (let rotation = 0; rotation < 10; rotation += 1) {
      for (let scale = 0; scale < 5; scale += 1) {
        const landmarks = transform(baseHand(count), side, rotation, scale, index);
        const actual = window.QuantumGestureMath.classifyFingerCount(landmarks, landmarks);
        cases.push({ index, count, side, rotation, scale, actual, passed: actual === count });
        index += 1;
      }
    }
  }
}
process.stdout.write(JSON.stringify(cases));
"""


class TestWebGestureMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        node = find_node()
        if node is None:
            raise unittest.SkipTest("Node.js não está disponível")
        environment = os.environ.copy()
        environment["QT_GESTURE_MATH"] = str(ROOT / "web" / "gesture-math.js")
        completed = subprocess.run(
            [str(node), "-"], cwd=ROOT, env=environment, input=HARNESS,
            capture_output=True, text=True, encoding="utf-8", timeout=20, check=False,
        )
        if completed.returncode != 0:
            raise AssertionError(f"Matriz JavaScript falhou:\n{completed.stdout}\n{completed.stderr}")
        cls.cases = json.loads(completed.stdout)
        if len(cls.cases) != CASE_COUNT:
            raise AssertionError(f"Esperados {CASE_COUNT} cenários; recebidos {len(cls.cases)}")


def make_case_test(case_index: int):
    def test(self: TestWebGestureMatrix) -> None:
        case = self.cases[case_index]
        self.assertTrue(
            case["passed"],
            f"caso {case_index}: esperado {case['count']}, obtido {case['actual']} "
            f"(lado={case['side']}, rotação={case['rotation']}, escala={case['scale']})",
        )
    return test


for _case_index in range(CASE_COUNT):
    setattr(TestWebGestureMatrix, f"test_gesture_geometry_{_case_index:03d}", make_case_test(_case_index))


if __name__ == "__main__":
    unittest.main(verbosity=2)
