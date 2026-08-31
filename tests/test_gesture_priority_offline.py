"""Etapa 7: gestos estaveis e prioridade, sem webcam ou robo fisico."""

from __future__ import annotations

import random
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.models import BoundingBox, TargetState, TrackedTarget
from robot.robot_controller import RobotController
from robot.robot_models import RobotCommand, RobotState
from vision.gesture_recognizer import GestureRecognizer, GestureResult, GestureStabilizer
from vision.gesture_trainer import GestureTrainer


@dataclass
class Landmark:
    x: float = 0.5
    y: float = 0.8
    z: float = 0.0


def hand_with_finger_count(count: int) -> list[Landmark]:
    landmarks = [Landmark() for _ in range(21)]
    for pip in (6, 10, 14, 18):
        landmarks[pip].y = 0.5
    for tip in (8, 12, 16, 20)[: min(count, 4)]:
        landmarks[tip].y = 0.2
    landmarks[3].x = 0.5
    landmarks[4].x = 0.35 if count == 5 else 0.65
    return landmarks


def visible_target(center_x: float = 180.0) -> TrackedTarget:
    return TrackedTarget(
        1,
        BoundingBox(center_x - 35, 220, center_x + 35, 400),
        0.95,
        state=TargetState.VISIBLE,
    )


class TestGesturePriorityOffline(unittest.TestCase):
    def test_finger_count_mapping_one_to_five(self) -> None:
        expected = {
            1: "SEGUIR",
            2: "VIRAR_DIREITA",
            3: "VIRAR_ESQUERDA",
            4: "PARAR",
            5: "GIRAR",
        }
        for count, command in expected.items():
            with self.subTest(count=count):
                result = GestureRecognizer._classify_finger_count(hand_with_finger_count(count), "Right")
                self.assertIsNotNone(result)
                self.assertEqual(result.command, command)

    def test_noise_does_not_change_command_until_three_equal_frames(self) -> None:
        stabilizer = GestureStabilizer(stable_frames=3, release_frames=3)
        right = GestureResult("VIRAR_DIREITA", 0.9)
        left = GestureResult("VIRAR_ESQUERDA", 0.9)
        self.assertIsNone(stabilizer.update(right))
        self.assertIsNone(stabilizer.update(left))
        self.assertIsNone(stabilizer.update(right))
        self.assertIsNone(stabilizer.update(right))
        self.assertEqual(stabilizer.update(right).command, "VIRAR_DIREITA")
        self.assertEqual(stabilizer.update(None).command, "VIRAR_DIREITA")
        self.assertEqual(stabilizer.update(None).command, "VIRAR_DIREITA")
        self.assertIsNone(stabilizer.update(None))

    def test_stop_is_immediate_for_safety(self) -> None:
        stabilizer = GestureStabilizer(stable_frames=5)
        result = stabilizer.update(GestureResult("PARAR", 0.7))
        self.assertEqual(result.command, "PARAR")

    def test_gesture_overrides_target_planner_and_manual_command(self) -> None:
        controller = RobotController(allow_hardware=False)
        controller.manual_command(RobotCommand.LEFT)
        telemetry = controller.update(
            [visible_target(center_x=100)],
            (1280, 720),
            gesture_command="VIRAR_DIREITA",
            obstacle_distance_cm=100,
        )
        self.assertEqual(telemetry.command, RobotCommand.RIGHT)
        self.assertEqual(telemetry.state, RobotState.TURN_RIGHT)
        self.assertEqual(telemetry.gesture_override, "VIRAR_DIREITA")

    def test_obstacle_safety_is_only_priority_above_gesture(self) -> None:
        controller = RobotController(allow_hardware=False)
        telemetry = controller.update(
            [visible_target(center_x=640)],
            (1280, 720),
            gesture_command="SEGUIR",
            obstacle_distance_cm=10,
        )
        self.assertEqual(telemetry.state, RobotState.AVOIDING_OBSTACLE)
        self.assertTrue(telemetry.safety_active)
        self.assertNotEqual(telemetry.command, RobotCommand.FORWARD)

    def test_stress_20000_gesture_frames_never_opens_hardware(self) -> None:
        rng = random.Random(7102026)
        controller = RobotController(allow_hardware=False)
        gestures = ["SEGUIR", "VIRAR_DIREITA", "VIRAR_ESQUERDA", "PARAR", "GIRAR", None]
        for _ in range(20_000):
            gesture = rng.choice(gestures)
            distance = 10.0 if rng.random() < 0.08 else 100.0
            telemetry = controller.update(
                [visible_target(center_x=rng.uniform(80, 1200))],
                (1280, 720),
                gesture_command=gesture,
                obstacle_distance_cm=distance,
            )
            self.assertFalse(controller.arduino.connected)
            if distance <= 20 and controller.state_machine.enabled:
                self.assertNotEqual(telemetry.command, RobotCommand.FORWARD)

    def test_trained_gesture_model_persists_and_reloads(self) -> None:
        try:
            import sklearn  # noqa: F401
        except ImportError:
            self.skipTest("scikit-learn não está instalado neste ambiente")
        with tempfile.TemporaryDirectory(prefix="quantum_gestures_") as temp:
            assets = Path(temp)
            with patch.object(GestureTrainer, "_init_mediapipe", lambda instance: setattr(instance, "_hands", None)):
                trainer = GestureTrainer(assets)
                rng = np.random.default_rng(7)
                trainer.samples = {
                    "PARAR": [rng.normal(-2.0, 0.03, 63).astype(np.float32) for _ in range(20)],
                    "SEGUIR": [rng.normal(2.0, 0.03, 63).astype(np.float32) for _ in range(20)],
                }
                ok, message = trainer.train()
                self.assertTrue(ok, message)
                self.assertTrue(trainer.model_path.exists())

                restored = GestureTrainer(assets)
                self.assertTrue(restored.load_if_exists())
                self.assertEqual(restored.label_map, ["PARAR", "SEGUIR"])
                prediction = int(restored.model.predict([np.full(63, 2.0, dtype=np.float32)])[0])
                self.assertEqual(restored.label_map[prediction], "SEGUIR")


if __name__ == "__main__":
    unittest.main(verbosity=2)
