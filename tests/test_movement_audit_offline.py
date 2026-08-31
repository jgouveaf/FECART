"""Etapa 5: auditoria extensa do movimento, somente em software."""

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
from robot.motion_planner import MotionPlanner
from robot.robot_controller import RobotController
from robot.robot_models import RobotCommand, RobotState


def target(center_x: float = 640.0, height: float = 150.0) -> TrackedTarget:
    return TrackedTarget(
        track_id=7,
        bbox=BoundingBox(center_x - 35, 300 - height / 2, center_x + 35, 300 + height / 2),
        confidence=0.95,
        state=TargetState.VISIBLE,
        name="Pessoa teste",
    )


class TestMovementAuditOffline(unittest.TestCase):
    def test_all_logical_commands_have_consistent_state(self) -> None:
        controller = RobotController(allow_hardware=False)
        cases = {
            RobotCommand.FORWARD: RobotState.FOLLOWING,
            RobotCommand.REVERSE: RobotState.REVERSE,
            RobotCommand.LEFT: RobotState.TURN_LEFT,
            RobotCommand.RIGHT: RobotState.TURN_RIGHT,
            RobotCommand.STOP: RobotState.STOPPED,
        }
        for command, expected_state in cases.items():
            with self.subTest(command=command):
                telemetry = controller.manual_command(command)
                self.assertEqual(telemetry.command, command)
                self.assertEqual(telemetry.state, expected_state)
                self.assertFalse(controller.arduino.connected)

    def test_invalid_frame_or_detection_always_stops(self) -> None:
        planner = MotionPlanner()
        self.assertEqual(planner.decide(target(), (0, 720)).command, RobotCommand.STOP)
        self.assertEqual(planner.decide(target(), (1280, -1)).command, RobotCommand.STOP)
        broken = target()
        broken.bbox = BoundingBox(math.nan, 10, 20, 100)
        self.assertEqual(planner.decide(broken, (1280, 720)).command, RobotCommand.STOP)

    def test_invalid_virtual_sensor_reading_is_fail_safe(self) -> None:
        for invalid in (math.nan, math.inf, -1.0, 0.0, "erro"):
            with self.subTest(invalid=invalid):
                controller = RobotController(allow_hardware=False)
                telemetry = controller.update([target()], (1280, 720), obstacle_distance_cm=invalid)
                self.assertEqual(telemetry.command, RobotCommand.STOP)
                self.assertEqual(telemetry.state, RobotState.STOPPED)
                self.assertTrue(telemetry.safety_active)

    def test_hysteresis_does_not_oscillate_near_threshold(self) -> None:
        controller = RobotController(allow_hardware=False)
        commands = []
        for distance in (19.8, 20.1, 19.9, 21, 25, 27.9, 28.0, 29):
            commands.append(
                controller.update([target()], (1280, 720), obstacle_distance_cm=distance).command
            )
        self.assertTrue(all(command in {RobotCommand.LEFT, RobotCommand.RIGHT} for command in commands[:6]))
        self.assertEqual(commands[6], RobotCommand.FORWARD)
        self.assertEqual(commands[7], RobotCommand.FORWARD)

    def test_seeded_stress_50000_frames_respects_invariants(self) -> None:
        rng = random.Random(20260814)
        controller = RobotController(allow_hardware=False)
        for _ in range(50_000):
            has_person = rng.random() > 0.22
            targets = [target(rng.uniform(120, 1160), rng.uniform(80, 430))] if has_person else []
            distance = rng.uniform(8, 150)
            telemetry = controller.update(targets, (1280, 720), obstacle_distance_cm=distance)

            self.assertTrue(math.isfinite(telemetry.pose.x))
            self.assertTrue(math.isfinite(telemetry.pose.y))
            self.assertTrue(math.isfinite(telemetry.pose.heading_degrees))
            self.assertFalse(controller.arduino.connected)
            if not has_person:
                self.assertEqual(telemetry.command, RobotCommand.STOP)
            elif distance <= 20:
                self.assertTrue(telemetry.safety_active)
                self.assertNotEqual(telemetry.command, RobotCommand.FORWARD)


if __name__ == "__main__":
    unittest.main(verbosity=2)
