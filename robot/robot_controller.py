from __future__ import annotations

from typing import Iterable, Optional

from core.models import TrackedTarget
from robot.esp32_adapter import ESP32Adapter
from robot.motion_planner import MotionPlanner
from robot.robot_models import FrameSize, RobotCommand, RobotTelemetry
from robot.robot_simulator import RobotSimulator
from robot.robot_state_machine import RobotStateMachine
from robot.target_selector import TargetSelector


class RobotController:
    """Coordinates target selection, gestures, state machine and command output."""

    def __init__(self) -> None:
        self.selector = TargetSelector()
        self.planner = MotionPlanner()
        self.state_machine = RobotStateMachine()
        self.simulator = RobotSimulator()
        self.esp32 = ESP32Adapter()
        self.last_telemetry: Optional[RobotTelemetry] = None

    def select_target(self, target: TrackedTarget) -> None:
        self.selector.select(target)

    def select_target_by_id(self, track_id: int, targets: Iterable[TrackedTarget]) -> bool:
        return self.selector.select_by_id(track_id, targets) is not None

    def clear_target(self) -> None:
        self.selector.clear()
        self.state_machine.set_enabled(False)

    def follow(self) -> None:
        self.state_machine.set_enabled(True)

    def stop(self) -> None:
        self.state_machine.set_enabled(False)

    def manual_command(self, command: RobotCommand) -> RobotTelemetry:
        gesture_map = {
            RobotCommand.STOP: "PARAR",
            RobotCommand.FORWARD: "SEGUIR",
            RobotCommand.REVERSE: "RE",
            RobotCommand.LEFT: "VIRAR_ESQUERDA",
            RobotCommand.RIGHT: "VIRAR_DIREITA",
        }
        return self.update([], (640, 480), gesture_map[command])

    def update(self, targets: Iterable[TrackedTarget], frame_size: FrameSize, gesture_command: Optional[str] = None) -> RobotTelemetry:
        targets = list(targets)
        target = self.selector.current_target(targets)
        decision = self.planner.decide(target, frame_size)
        state, command, reason = self.state_machine.apply(decision, gesture_command)
        linear_speed, angular_speed = self._command_speeds(command, decision.linear_speed, decision.angular_speed, gesture_command is not None)
        target_id = target.track_id if target else self.selector.lock.track_id if self.selector.lock else None
        pose = self.simulator.update(command, linear_speed, angular_speed)
        payload = self.esp32.build_payload(command, state, target_id, linear_speed, angular_speed)
        self.esp32.send(payload)
        telemetry = RobotTelemetry(
            state=state,
            command=command,
            target_id=target_id,
            target_name=target.name if target else self.selector.lock.name if self.selector.lock else None,
            target_state=target.state.value if target else None,
            distance_estimate=decision.distance_estimate,
            horizontal_error=decision.horizontal_error,
            speed=target.speed if target else 0.0,
            direction_degrees=target.direction_degrees if target else 0.0,
            ghost_active=target is not None and target.state.value == "GHOST",
            gesture_override=gesture_command,
            reason=reason,
            pose=pose,
            esp32_payload=payload,
        )
        self.last_telemetry = telemetry
        return telemetry

    def _command_speeds(
        self,
        command: RobotCommand,
        linear_speed: float,
        angular_speed: float,
        is_override: bool,
    ) -> tuple[float, float]:
        if not is_override:
            return linear_speed, angular_speed
        if command == RobotCommand.FORWARD:
            return 0.45, 0.0
        if command == RobotCommand.REVERSE:
            return 0.35, 0.0
        if command == RobotCommand.LEFT:
            return 0.0, -0.45
        if command == RobotCommand.RIGHT:
            return 0.0, 0.45
        return 0.0, 0.0
