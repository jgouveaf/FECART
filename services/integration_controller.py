"""Orquestracao das Etapas 1 a 9 sem acesso a hardware fisico."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from core.models import TrackedTarget
from localization.rssi_localizer import LocationEstimate, RssiLocalizer, RssiObservation
from robot.robot_controller import RobotController
from robot.robot_models import FrameSize, RobotTelemetry


@dataclass(frozen=True)
class IntegrationInput:
    targets: tuple[TrackedTarget, ...]
    frame_size: FrameSize
    gesture_command: Optional[str] = None
    obstacle_distance_cm: Optional[float] = None
    rssi_observations: tuple[RssiObservation, ...] = ()


@dataclass(frozen=True)
class IntegrationOutput:
    sequence: int
    robot: RobotTelemetry
    location: Optional[LocationEstimate]
    warnings: tuple[str, ...]
    mode: str = "SOFTWARE_ONLY"
    hardware_enabled: bool = False


class SoftwareIntegrationController:
    """Une percepção, gestos, segurança, localização e telemetria.

    A classe não aceita a ativação de hardware. A ponte física será uma camada
    diferente e somente poderá ser criada na Etapa 10.
    """

    def __init__(self, localizer: Optional[RssiLocalizer] = None) -> None:
        self.robot = RobotController(allow_hardware=False)
        self.localizer = localizer
        self.sequence = 0
        self.last_output: Optional[IntegrationOutput] = None

    def process(self, frame: IntegrationInput) -> IntegrationOutput:
        self.sequence += 1
        warnings: list[str] = []
        telemetry = self.robot.update(
            frame.targets,
            frame.frame_size,
            gesture_command=frame.gesture_command,
            obstacle_distance_cm=frame.obstacle_distance_cm,
        )

        location = None
        if frame.rssi_observations:
            if self.localizer is None:
                warnings.append("localizador_nao_configurado")
            else:
                try:
                    location = self.localizer.estimate(frame.rssi_observations)
                except ValueError as exc:
                    warnings.append(f"localizacao_indisponivel:{exc}")

        if telemetry.safety_active:
            warnings.append("seguranca_obstaculo_ativa")
        if telemetry.ghost_active:
            warnings.append("alvo_em_previsao_ghost")
        if self.robot.esp32.connected:
            raise RuntimeError("Violacao: transporte fisico ativo antes da Etapa 10")

        output = IntegrationOutput(
            sequence=self.sequence,
            robot=telemetry,
            location=location,
            warnings=tuple(warnings),
        )
        self.last_output = output
        return output

    def poll_status(self) -> dict[str, object]:
        if self.last_output is None:
            return {
                "sequence": 0,
                "mode": "SOFTWARE_ONLY",
                "hardware_enabled": False,
                "state": "AGUARDANDO",
            }
        return {
            "sequence": self.last_output.sequence,
            "mode": self.last_output.mode,
            "hardware_enabled": self.last_output.hardware_enabled,
            "state": self.last_output.robot.state.value,
            "command": self.last_output.robot.command.value,
            "target_id": self.last_output.robot.target_id,
            "location_available": self.last_output.location is not None,
            "warnings": self.last_output.warnings,
        }
