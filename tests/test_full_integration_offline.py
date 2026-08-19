"""Etapa 9: integracao geral em software, sem dispositivos fisicos."""

from __future__ import annotations

import math
import random
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.models import BoundingBox, TargetState, TrackedTarget
from localization.rssi_localizer import Anchor, RssiLocalizer, RssiObservation, simulate_rssi
from robot.robot_models import RobotCommand, RobotState
from services.integration_controller import IntegrationInput, SoftwareIntegrationController


ANCHORS = (Anchor("A", 0, 0), Anchor("B", 10, 0), Anchor("C", 0, 8), Anchor("D", 10, 8))


def person(track_id: int = 9, center_x: float = 640, state: TargetState = TargetState.VISIBLE) -> TrackedTarget:
    return TrackedTarget(
        track_id,
        BoundingBox(center_x - 35, 225, center_x + 35, 375),
        0.94,
        state=state,
        name="Pessoa cadastrada",
        person_id=3,
    )


def rssi_at(x: float, y: float) -> tuple[RssiObservation, ...]:
    return tuple(RssiObservation(anchor.anchor_id, simulate_rssi(anchor, x, y)) for anchor in ANCHORS)


class TestFullIntegrationOffline(unittest.TestCase):
    def setUp(self) -> None:
        self.system = SoftwareIntegrationController(RssiLocalizer(ANCHORS))

    def test_no_person_means_no_movement_but_location_can_exist(self) -> None:
        output = self.system.process(IntegrationInput((), (1280, 720), rssi_observations=rssi_at(4, 3)))
        self.assertEqual(output.robot.command, RobotCommand.STOP)
        self.assertIsNotNone(output.location)
        self.assertFalse(output.hardware_enabled)

    def test_identity_flows_to_robot_telemetry(self) -> None:
        output = self.system.process(IntegrationInput((person(),), (1280, 720), obstacle_distance_cm=100))
        self.assertEqual(output.robot.target_id, 9)
        self.assertEqual(output.robot.target_name, "Pessoa cadastrada")
        self.assertEqual(output.robot.command, RobotCommand.FORWARD)

    def test_gesture_priority_and_obstacle_safety(self) -> None:
        gesture = self.system.process(
            IntegrationInput((person(center_x=100),), (1280, 720), "VIRAR_DIREITA", 100)
        )
        self.assertEqual(gesture.robot.command, RobotCommand.RIGHT)
        blocked = self.system.process(
            IntegrationInput((person(center_x=640),), (1280, 720), "SEGUIR", 10)
        )
        self.assertEqual(blocked.robot.state, RobotState.AVOIDING_OBSTACLE)
        self.assertNotEqual(blocked.robot.command, RobotCommand.FORWARD)
        self.assertIn("seguranca_obstaculo_ativa", blocked.warnings)

    def test_bad_location_data_does_not_crash_other_modules(self) -> None:
        output = self.system.process(
            IntegrationInput(
                (person(),),
                (1280, 720),
                obstacle_distance_cm=100,
                rssi_observations=(RssiObservation("A", -60),),
            )
        )
        self.assertEqual(output.robot.command, RobotCommand.FORWARD)
        self.assertIsNone(output.location)
        self.assertTrue(any(item.startswith("localizacao_indisponivel") for item in output.warnings))

    def test_polling_reports_last_atomic_state(self) -> None:
        self.assertEqual(self.system.poll_status()["sequence"], 0)
        output = self.system.process(IntegrationInput((person(),), (1280, 720), obstacle_distance_cm=100))
        status = self.system.poll_status()
        self.assertEqual(status["sequence"], output.sequence)
        self.assertEqual(status["target_id"], 9)
        self.assertFalse(status["hardware_enabled"])

    def test_stress_30000_integrated_frames_preserves_priority_and_safety(self) -> None:
        rng = random.Random(92026)
        gestures = (None, None, None, "SEGUIR", "VIRAR_DIREITA", "VIRAR_ESQUERDA", "PARAR")
        for index in range(30_000):
            has_person = rng.random() > 0.2
            targets = (person(center_x=rng.uniform(80, 1200)),) if has_person else ()
            obstacle = 10.0 if rng.random() < 0.06 else 100.0
            location = rssi_at(rng.uniform(1, 9), rng.uniform(1, 7)) if index % 100 == 0 else ()
            output = self.system.process(
                IntegrationInput(targets, (1280, 720), rng.choice(gestures), obstacle, location)
            )
            self.assertFalse(self.system.robot.esp32.connected)
            self.assertTrue(math.isfinite(output.robot.pose.x))
            self.assertTrue(math.isfinite(output.robot.pose.y))
            if output.robot.safety_active:
                self.assertNotEqual(output.robot.command, RobotCommand.FORWARD)
        self.assertEqual(self.system.sequence, 30_000)

    def test_public_site_has_no_secret_and_requires_explicit_usb_connection(self) -> None:
        files = [
            ROOT / "index.html",
            ROOT / "web" / "app.js",
            ROOT / "web" / "robot-control.js",
            ROOT / "web" / "styles.css",
        ]
        public = "\n".join(path.read_text(encoding="utf-8") for path in files)
        self.assertNotIn("sk-proj-", public)
        self.assertIn("Conectar Arduino USB", public)
        self.assertIn("requestPort()", public)
        self.assertIn("PARADA DE EMERGÊNCIA", public)
        self.assertIn("HC-SR04", public)


if __name__ == "__main__":
    unittest.main(verbosity=2)
