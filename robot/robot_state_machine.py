from __future__ import annotations

from typing import Optional

from core.models import TargetState
from robot.robot_models import MotionDecision, RobotCommand, RobotState


class RobotStateMachine:
    """High-level robot state transitions with gesture override priority."""

    def __init__(self) -> None:
        self.state = RobotState.IDLE
        self.enabled = False

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled
        self.state = RobotState.FOLLOWING if enabled else RobotState.IDLE

    def apply(self, decision: MotionDecision, gesture_command: Optional[str] = None) -> tuple[RobotState, RobotCommand, str]:
        if gesture_command:
            return self._apply_gesture(gesture_command)

        if not self.enabled:
            self.state = RobotState.IDLE
            return self.state, RobotCommand.STOP, "sistema em IDLE"

        if decision.target_state == TargetState.GHOST:
            self.state = RobotState.GHOST
            return self.state, decision.command, decision.reason
        if decision.target_state == TargetState.LOST:
            self.state = RobotState.LOST
            return self.state, RobotCommand.STOP, decision.reason

        if decision.command == RobotCommand.FORWARD:
            self.state = RobotState.FOLLOWING
        elif decision.command == RobotCommand.STOP:
            self.state = RobotState.STOPPED
        elif decision.command == RobotCommand.REVERSE:
            self.state = RobotState.REVERSE
        elif decision.command == RobotCommand.LEFT:
            self.state = RobotState.TURN_LEFT
        elif decision.command == RobotCommand.RIGHT:
            self.state = RobotState.TURN_RIGHT
        return self.state, decision.command, decision.reason

    def _apply_gesture(self, gesture_command: str) -> tuple[RobotState, RobotCommand, str]:
        normalized = gesture_command.upper()
        if normalized == "PARAR":
            self.enabled = False
            self.state = RobotState.STOPPED
            return self.state, RobotCommand.STOP, "override por gesto: palma aberta"
        if normalized == "SEGUIR":
            self.enabled = True
            self.state = RobotState.FOLLOWING
            return self.state, RobotCommand.FORWARD, "override por gesto: seguir"
        if normalized in {"RE", "RÉ"}:
            self.enabled = True
            self.state = RobotState.REVERSE
            return self.state, RobotCommand.REVERSE, "override por gesto: re"
        if normalized in {"VIRAR_ESQUERDA", "ESQUERDA"}:
            self.enabled = True
            self.state = RobotState.TURN_LEFT
            return self.state, RobotCommand.LEFT, "override por gesto: esquerda"
        if normalized in {"VIRAR_DIREITA", "DIREITA"}:
            self.enabled = True
            self.state = RobotState.TURN_RIGHT
            return self.state, RobotCommand.RIGHT, "override por gesto: direita"
        return self.state, RobotCommand.STOP, "gesto desconhecido"
