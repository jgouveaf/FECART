"""Isolated autonomous sketch and delivery contracts (no physical USB)."""
import hashlib
import pathlib
import re
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class AutonomousIsolated(unittest.TestCase):
    def test_main_site_reuses_the_isolated_controller(self):
        html = (ROOT / 'index.html').read_text(encoding='utf-8')
        for element in ('autoFlash', 'autoConnect', 'autoStart', 'autoStop', 'autoDisconnect',
                        'autoDistance', 'autoEcho', 'autoPhase', 'autoCommand', 'autoSample',
                        'autoUptime', 'autoSensorStatus', 'autoLog', 'autoProgress', 'autoStatus', 'autoFlashStatus'):
            self.assertEqual(html.count(f'id="{element}"'), 1)
        self.assertIn('web/autonomous-bench.js?v=3', html)
        self.assertIn('<details id="integratedFirmware"', html)
        self.assertNotIn('<iframe', html)
        self.assertIn('firmware/autonomo_isolado/autonomo_isolado.ino', html)

    @unittest.skipUnless(shutil.which('node'), 'Node required')
    def test_sketch_logic(self):
        result = subprocess.run([shutil.which('node'), 'tests/autonomous_isolated_logic.test.cjs'],
                                cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_isolated_delivery_and_hash(self):
        html = (ROOT / 'autonomo.html').read_text(encoding='utf-8')
        js = (ROOT / 'web/autonomous-bench.js').read_text(encoding='utf-8')
        ino = (ROOT / 'firmware/autonomo_isolado/autonomo_isolado.ino').read_text(encoding='utf-8')
        self.assertNotIn('robot-control.js', html)
        self.assertNotIn('camera-gestures.js', html)
        self.assertNotIn('MODE:', ino)
        self.assertIn('AUTO:READY:2', ino)
        self.assertIn('AUTO:READY:2', js)
        self.assertIn('AUTO:READY:2', html)
        self.assertIn('"ECHO_US:"', ino.replace('|ECHO_US:', 'ECHO_US:'))
        self.assertIn('id="autoStart" disabled', html)
        hex_bytes = (ROOT / 'firmware/compiled/autonomo_isolado.ino.hex').read_text().encode()
        expected = re.search(r'const firmwareHash = "([a-f0-9]{64})"', js).group(1)
        self.assertEqual(hashlib.sha256(hex_bytes).hexdigest(), expected)
