"""Reproduz geometria, confirmacao e falhas de video sem hardware."""
import shutil
import subprocess
import unittest
from pathlib import Path


class GestureRuntimeRegression(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js necessario para o harness")
    def test_geometry_and_command_lifecycle(self):
        result = subprocess.run(
            ["node", "tests/gesture_runtime_regression.test.cjs"],
            cwd=Path(__file__).resolve().parents[1], capture_output=True,
            text=True, encoding="utf-8", timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
