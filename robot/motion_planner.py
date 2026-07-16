from __future__ import annotations

from core.models import TargetState, TrackedTarget
from robot.robot_models import FrameSize, MotionDecision, RobotCommand


class MotionPlanner:
    """Converts target geometry into conservative robot movement commands."""

    def __init__(
        self,
        center_deadzone: float = 0.14,
        close_height_ratio: float = 0.54,
        ideal_height_ratio: float = 0.38,
        far_height_ratio: float = 0.25,
    ) -> None:
        self.center_deadzone = center_deadzone
        self.close_height_ratio = close_height_ratio
        self.ideal_height_ratio = ideal_height_ratio
        self.far_height_ratio = far_height_ratio

    def decide(self, target: TrackedTarget | None, frame_size: FrameSize) -> MotionDecision:
        if target is None:
            return MotionDecision(RobotCommand.STOP, "nenhum alvo selecionado", 0.0, 0.0, 0.0, 0.0, TargetState.LOST)

        width, height = frame_size
        width = max(width, 1)
        height = max(height, 1)
        center_x = target.bbox.center[0]
        horizontal_error = (center_x - (width / 2.0)) / (width / 2.0)
        height_ratio = target.bbox.height / height
        distance_estimate = self._distance_from_height_ratio(height_ratio)

        if target.state == TargetState.LOST:
            return MotionDecision(RobotCommand.STOP, "alvo perdido", 0.0, 0.0, horizontal_error, distance_estimate, target.state)
        if target.state == TargetState.GHOST:
            return self._ghost_decision(target, horizontal_error, distance_estimate)
        if target.state == TargetState.OCCLUDED:
            return MotionDecision(RobotCommand.STOP, "oclusao curta: aguardando reacquisicao", 0.0, 0.0, horizontal_error, distance_estimate, target.state)

        if height_ratio >= self.close_height_ratio:
            return MotionDecision(RobotCommand.STOP, "alvo muito proximo", 0.0, 0.0, horizontal_error, distance_estimate, target.state)
        if horizontal_error < -self.center_deadzone:
            return MotionDecision(RobotCommand.LEFT, "alvo a esquerda", 0.0, -0.45, horizontal_error, distance_estimate, target.state)
        if horizontal_error > self.center_deadzone:
            return MotionDecision(RobotCommand.RIGHT, "alvo a direita", 0.0, 0.45, horizontal_error, distance_estimate, target.state)
        if height_ratio < self.ideal_height_ratio:
            speed = 0.55 if height_ratio < self.far_height_ratio else 0.35
            return MotionDecision(RobotCommand.FORWARD, "alvo alinhado e distante", speed, 0.0, horizontal_error, distance_estimate, target.state)
        return MotionDecision(RobotCommand.STOP, "distancia segura atingida", 0.0, 0.0, horizontal_error, distance_estimate, target.state)

    def _ghost_decision(self, target: TrackedTarget, horizontal_error: float, distance_estimate: float) -> MotionDecision:
        if target.direction_degrees > 200 and target.direction_degrees < 340:
            return MotionDecision(RobotCommand.LEFT, "ghost: direcao prevista para esquerda", 0.0, -0.25, horizontal_error, distance_estimate, target.state)
        if target.direction_degrees < 160 and target.direction_degrees > 20:
            return MotionDecision(RobotCommand.RIGHT, "ghost: direcao prevista para direita", 0.0, 0.25, horizontal_error, distance_estimate, target.state)
        return MotionDecision(RobotCommand.STOP, "ghost: previsao incerta, parada segura", 0.0, 0.0, horizontal_error, distance_estimate, target.state)

    def _distance_from_height_ratio(self, height_ratio: float) -> float:
        if height_ratio <= 0:
            return 0.0
        return round(0.42 / height_ratio, 2)
