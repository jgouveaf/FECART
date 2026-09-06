"""Valida o controlador virtual de comandos sem câmera ou robô físico."""

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
require(process.env.QT_SIMULATOR_CONTROLLER);
const Controller = window.QuantumSimulatorController.SimulatorCommandController;
const controller = new Controller(900);
const result = { default: controller.snapshot(0), commands: {} };
result.gestureMode = controller.setMode("GESTOS", 100);
for (const [index, command] of ["FRENTE", "TRAS", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"].entries()) {
  const now = 200 + index * 50;
  result.commands[command] = {
    accepted: controller.setCommand(command, "TESTE", now),
    current: controller.current(now + 10),
  };
}
result.invalid = controller.setCommand("VOAR", "TESTE", 600);
controller.setCommand("FRENTE", "GESTO", 1000);
result.beforeTimeout = controller.snapshot(1899);
result.afterTimeout = controller.snapshot(1901);
process.stdout.write(JSON.stringify(result));
"""


class TestWebSimulatorCommands(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        node = find_node()
        if node is None:
            raise unittest.SkipTest("Node.js não está disponível")
        environment = os.environ.copy()
        environment["QT_SIMULATOR_CONTROLLER"] = str(ROOT / "web" / "simulator-controller.js")
        completed = subprocess.run(
            [str(node), "-"], cwd=ROOT, env=environment, input=HARNESS,
            capture_output=True, text=True, encoding="utf-8", timeout=15, check=False,
        )
        if completed.returncode != 0:
            raise AssertionError(f"Controlador virtual falhou:\n{completed.stdout}\n{completed.stderr}")
        cls.result = json.loads(completed.stdout)

    def test_autonomous_mode_starts_forward(self) -> None:
        self.assertEqual(self.result["default"]["mode"], "AUTONOMO")
        self.assertEqual(self.result["default"]["command"], "FRENTE")

    def test_gesture_mode_starts_stopped(self) -> None:
        self.assertEqual(self.result["gestureMode"]["mode"], "GESTOS")
        self.assertEqual(self.result["gestureMode"]["command"], "PARAR")

    def test_all_six_commands_are_accepted(self) -> None:
        for command in ("FRENTE", "TRAS", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"):
            with self.subTest(command=command):
                self.assertTrue(self.result["commands"][command]["accepted"])
                self.assertEqual(self.result["commands"][command]["current"], command)

    def test_invalid_command_is_rejected(self) -> None:
        self.assertFalse(self.result["invalid"])

    def test_gesture_timeout_stops_simulator(self) -> None:
        self.assertEqual(self.result["beforeTimeout"]["command"], "FRENTE")
        self.assertEqual(self.result["afterTimeout"]["command"], "PARAR")
        self.assertEqual(self.result["afterTimeout"]["source"], "GESTO")

    def test_page_connects_gestures_to_visible_simulator(self) -> None:
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
        for marker in ("simGestureMode", "data-simulator-command", "simulatorSourceValue"):
            self.assertIn(marker, html)
        self.assertIn('window.addEventListener("quantum:gesture-command"', app)
        self.assertIn("window.QuantumSimulator", app)

    def test_same_test_panel_can_target_the_real_arduino(self) -> None:
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
        for marker in (
            'id="testTargetSimulator"',
            'id="testTargetArduino"',
            'id="testConnectArduino"',
            'id="testTargetStatus" role="status"',
            'id="testEnvironmentValue"',
        ):
            self.assertIn(marker, html)
        self.assertIn('robot.requestMode(ROBOT_MODE_BY_SIMULATOR_MODE[mode], "test-panel")', app)
        self.assertIn("robot.send(command)", app)
        self.assertIn('source === "GESTO"', app)
        self.assertIn("setTarget: setTestTarget", app)
        self.assertIn("target: testTarget", app)


if __name__ == "__main__":
    unittest.main(verbosity=2)
