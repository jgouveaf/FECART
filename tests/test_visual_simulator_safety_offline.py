"""Integra o sensor virtual do mapa com o controlador da Etapa 4."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.models import BoundingBox, TargetState, TrackedTarget
from robot.robot_controller import RobotController
from robot.robot_models import RobotCommand, RobotState
from simulator.synthetic_world import SyntheticWorld


class TesteSimuladorVisualSeguranca(unittest.TestCase):
    def test_sensor_virtual_enxerga_obstaculo_e_controlador_desvia(self) -> None:
        world = SyntheticWorld(800, 600)
        world.sim.obstacles = [(370.0, 435.0, 60.0, 45.0)]
        distance = world.obstacle_distance_cm
        self.assertLessEqual(distance, 20.0)

        target = TrackedTarget(
            1,
            BoundingBox(365, 100, 435, 230),
            0.95,
            state=TargetState.VISIBLE,
        )
        controller = RobotController(allow_hardware=False)
        telemetry = controller.update(
            [target],
            (800, 600),
            obstacle_distance_cm=distance,
        )
        world.send_robot_command(telemetry.command)

        self.assertEqual(telemetry.state, RobotState.AVOIDING_OBSTACLE)
        self.assertIn(telemetry.command, (RobotCommand.LEFT, RobotCommand.RIGHT))
        self.assertEqual(world.sim.current_command, telemetry.command)

    def test_cem_quadros_sem_humano_mantem_robo_visual_parado(self) -> None:
        world = SyntheticWorld(800, 600)
        world.sim.targets = []
        controller = RobotController(allow_hardware=False)
        start = (world.sim.robot_x, world.sim.robot_y)
        for _ in range(100):
            frame, _ = world.next_frame()
            telemetry = controller.update(
                [],
                (frame.shape[1], frame.shape[0]),
                obstacle_distance_cm=world.obstacle_distance_cm,
            )
            world.send_robot_command(telemetry.command)
        self.assertEqual(telemetry.command, RobotCommand.STOP)
        self.assertAlmostEqual(world.sim.robot_x, start[0])
        self.assertAlmostEqual(world.sim.robot_y, start[1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
