"""Etapa 4: humano -> movimento logico -> seguranca, tudo simulado."""

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


def alvo(
    track_id: int = 1,
    centro_x: float = 640,
    altura: float = 150,
    estado: TargetState = TargetState.VISIBLE,
) -> TrackedTarget:
    largura = 70
    centro_y = 300
    return TrackedTarget(
        track_id,
        BoundingBox(
            centro_x - largura / 2,
            centro_y - altura / 2,
            centro_x + largura / 2,
            centro_y + altura / 2,
        ),
        0.92,
        state=estado,
        name=f"Pessoa {track_id}",
    )


class TesteSeguimentoHumanoOffline(unittest.TestCase):
    def setUp(self) -> None:
        self.controller = RobotController(allow_hardware=False)

    def test_sem_humano_fica_parado(self) -> None:
        telemetry = self.controller.update([], (1280, 720), obstacle_distance_cm=10)
        self.assertEqual(telemetry.command, RobotCommand.STOP)
        self.assertFalse(telemetry.safety_active)
        self.assertAlmostEqual(telemetry.pose.x, 0.0)

    def test_primeiro_humano_visivel_e_selecionado_e_seguido(self) -> None:
        telemetry = self.controller.update([alvo()], (1280, 720), obstacle_distance_cm=100)
        self.assertEqual(telemetry.target_id, 1)
        self.assertEqual(telemetry.state, RobotState.FOLLOWING)
        self.assertEqual(telemetry.command, RobotCommand.FORWARD)
        self.assertGreater(telemetry.pose.x, 0.0)

    def test_humano_a_esquerda_e_direita_gera_curva(self) -> None:
        left = self.controller.update([alvo(1, centro_x=250)], (1280, 720), obstacle_distance_cm=100)
        self.assertEqual(left.command, RobotCommand.LEFT)
        self.controller.clear_target()
        self.controller.follow()
        right = self.controller.update([alvo(2, centro_x=1030)], (1280, 720), obstacle_distance_cm=100)
        self.assertEqual(right.command, RobotCommand.RIGHT)

    def test_alvo_oculto_ou_perdido_para(self) -> None:
        self.controller.update([alvo()], (1280, 720), obstacle_distance_cm=100)
        occluded = self.controller.update(
            [alvo(estado=TargetState.OCCLUDED)],
            (1280, 720),
            obstacle_distance_cm=100,
        )
        self.assertEqual(occluded.command, RobotCommand.STOP)
        lost = self.controller.update(
            [alvo(estado=TargetState.LOST)],
            (1280, 720),
            obstacle_distance_cm=100,
        )
        self.assertEqual(lost.command, RobotCommand.STOP)

    def test_obstaculo_interrompe_seguimento_e_so_libera_com_histerese(self) -> None:
        following = self.controller.update([alvo()], (1280, 720), obstacle_distance_cm=100)
        self.assertEqual(following.command, RobotCommand.FORWARD)

        blocked = self.controller.update([alvo()], (1280, 720), obstacle_distance_cm=15)
        self.assertEqual(blocked.state, RobotState.AVOIDING_OBSTACLE)
        self.assertIn(blocked.command, (RobotCommand.LEFT, RobotCommand.RIGHT))
        self.assertTrue(blocked.safety_active)

        still_blocked = self.controller.update([alvo()], (1280, 720), obstacle_distance_cm=24)
        self.assertTrue(still_blocked.safety_active)

        released = self.controller.update([alvo()], (1280, 720), obstacle_distance_cm=30)
        self.assertEqual(released.command, RobotCommand.FORWARD)
        self.assertFalse(released.safety_active)

    def test_seguranca_supera_comando_de_avancar(self) -> None:
        telemetry = self.controller.update(
            [alvo()],
            (1280, 720),
            gesture_command="SEGUIR",
            obstacle_distance_cm=10,
        )
        self.assertEqual(telemetry.state, RobotState.AVOIDING_OBSTACLE)
        self.assertNotEqual(telemetry.command, RobotCommand.FORWARD)

    def test_parada_explicita_nao_e_cancelada_por_nova_deteccao(self) -> None:
        self.controller.stop()
        telemetry = self.controller.update([alvo()], (1280, 720), obstacle_distance_cm=100)
        self.assertEqual(telemetry.command, RobotCommand.STOP)

    def test_transporte_fisico_permanece_bloqueado(self) -> None:
        self.assertEqual(self.controller.arduino.available_ports(), [])
        ok, message = self.controller.arduino.connect("COM5")
        self.assertFalse(ok)
        self.assertIn("Etapa 10", message)
        self.assertFalse(self.controller.arduino.connected)

    def test_stress_10000_quadros_sem_movimento_na_ausencia_de_humano(self) -> None:
        for frame in range(10_000):
            targets = [alvo()] if frame % 200 < 120 else []
            distance = 12 if frame % 97 < 8 else 100
            telemetry = self.controller.update(
                targets,
                (1280, 720),
                obstacle_distance_cm=distance,
            )
            if not targets:
                self.assertEqual(telemetry.command, RobotCommand.STOP)
                self.assertFalse(telemetry.safety_active)
            elif distance <= 20:
                self.assertTrue(telemetry.safety_active)


if __name__ == "__main__":
    unittest.main(verbosity=2)
