"""Run the sketch-body logic harness; IO/time are mocked, not physical hardware."""
import pathlib
import shutil
import subprocess
import unittest


class FirmwareStateRuntime(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is required for the logic harness")
    def test_real_sketch_state_functions(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [shutil.which("node"), "tests/firmware_state_runtime.test.cjs"],
            cwd=root, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
