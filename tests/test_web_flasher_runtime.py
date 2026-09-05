"""Exercita o gravador real com USB/rede simuladas, sem hardware."""

import shutil
import subprocess
import unittest
from pathlib import Path


class WebFlasherRuntime(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js necessário para testar o gravador")
    def test_port_selection_and_safe_firmware_upload(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            ["node", "tests/arduino_flasher_runtime.test.cjs"],
            cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
