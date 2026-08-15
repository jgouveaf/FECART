"""Camada de seguranca de obstaculos, independente do comportamento normal."""

from __future__ import annotations

from dataclasses import dataclass
import math

from robot.robot_models import RobotCommand, RobotState


@dataclass(frozen=True)
class SafetyDecision:
    state: RobotState
    command: RobotCommand
    reason: str
    active: bool


class ObstacleSafetySupervisor:
    """Transforma distancia virtual em uma decisao de maior prioridade.

    Na Etapa 4 a distancia vem exclusivamente do simulador. A integracao com o
    HC-SR04 fisico fica reservada para a Etapa 10.
    """

    def __init__(self, stop_distance_cm: float = 20.0, clear_distance_cm: float = 28.0) -> None:
        if clear_distance_cm <= stop_distance_cm:
            raise ValueError("A distancia de liberacao deve ser maior que a de parada.")
        self.stop_distance_cm = float(stop_distance_cm)
        self.clear_distance_cm = float(clear_distance_cm)
        self.avoiding = False
        self.turn_right = True

    def reset(self) -> None:
        self.avoiding = False
        self.turn_right = True

    def apply(
        self,
        state: RobotState,
        command: RobotCommand,
        reason: str,
        distance_cm: float | None,
    ) -> SafetyDecision:
        # None significa que nenhum sensor (nem mesmo virtual) foi fornecido.
        # Nao invente obstaculo nem distancia. Se uma leitura foi fornecida,
        # porem e invalida, a unica resposta segura e parar.
        if distance_cm is None:
            return SafetyDecision(state, command, reason, False)

        try:
            distance_cm = float(distance_cm)
        except (TypeError, ValueError):
            return self._invalid_reading_stop()
        if not math.isfinite(distance_cm) or distance_cm <= 0:
            return self._invalid_reading_stop()

        if distance_cm <= self.stop_distance_cm:
            if not self.avoiding:
                self.turn_right = not self.turn_right
            self.avoiding = True
        elif self.avoiding and distance_cm >= self.clear_distance_cm:
            self.avoiding = False

        if not self.avoiding:
            return SafetyDecision(state, command, reason, False)

        turn = RobotCommand.RIGHT if self.turn_right else RobotCommand.LEFT
        return SafetyDecision(
            RobotState.AVOIDING_OBSTACLE,
            turn,
            f"seguranca: obstaculo virtual a {distance_cm:.1f} cm",
            True,
        )

    @staticmethod
    def _invalid_reading_stop() -> SafetyDecision:
        return SafetyDecision(
            RobotState.STOPPED,
            RobotCommand.STOP,
            "seguranca: leitura virtual invalida, parada preventiva",
            True,
        )
