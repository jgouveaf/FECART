from __future__ import annotations

from typing import Iterable, Optional

from core.models import TrackedTarget
from robot.esp32_adapter import ESP32Adapter
from robot.motion_planner import MotionPlanner
from robot.robot_models import FrameSize, RobotCommand, RobotTelemetry
from robot.robot_simulator import RobotSimulator
from robot.safety_supervisor import ObstacleSafetySupervisor
from robot.robot_state_machine import RobotStateMachine
from robot.target_selector import TargetSelector


class RobotController:
    """Coordinates target selection, gestures, state machine and command output."""

    def __init__(self, allow_hardware: bool = False) -> None:
        self.selector = TargetSelector()
        self.planner = MotionPlanner()
        self.state_machine = RobotStateMachine()
        self.simulator = RobotSimulator()
        self.esp32 = ESP32Adapter(allow_hardware=allow_hardware)
        self.safety = ObstacleSafetySupervisor()
        self.last_telemetry: Optional[RobotTelemetry] = None
        self.manual_override: Optional[RobotCommand] = None
        self.autonomous_follow_enabled = True

    def select_target(self, target: TrackedTarget) -> None:
        self.manual_override = None
        self.selector.select(target)

    def select_target_by_id(self, track_id: int, targets: Iterable[TrackedTarget]) -> bool:
        return self.selector.select_by_id(track_id, targets) is not None

    def clear_target(self) -> None:
        self.manual_override = None
        self.autonomous_follow_enabled = False
        self.selector.clear()
        self.state_machine.set_enabled(False)

    def follow(self) -> None:
        self.manual_override = None
        self.autonomous_follow_enabled = True
        self.state_machine.set_enabled(True)

    def stop(self) -> None:
        self.manual_override = RobotCommand.STOP
        self.autonomous_follow_enabled = False
        self.state_machine.set_enabled(False)

    def manual_command(self, command: RobotCommand) -> RobotTelemetry:
        self.manual_override = command
        return self.update([], (640, 480))

    def update(
        self,
        targets: Iterable[TrackedTarget],
        frame_size: FrameSize,
        gesture_command: Optional[str] = None,
        obstacle_distance_cm: float | None = None,
    ) -> RobotTelemetry:
        targets = list(targets)
        if self.autonomous_follow_enabled and not self.state_machine.enabled:
            self.state_machine.set_enabled(True)
        if self.autonomous_follow_enabled and self.selector.lock is None:
            candidate = next(
                (target for target in targets if target.state.value == "VISIBLE"),
                None,
            )
            if candidate is not None:
                self.selector.select(candidate)
        target = self.selector.current_target(targets)
        decision = self.planner.decide(target, frame_size)
        if gesture_command is not None:
            self.manual_override = None
        if self.manual_override is not None:
            manual_gesture = {
                RobotCommand.STOP: "PARAR",
                RobotCommand.FORWARD: "SEGUIR",
                RobotCommand.REVERSE: "RE",
                RobotCommand.LEFT: "VIRAR_ESQUERDA",
                RobotCommand.RIGHT: "VIRAR_DIREITA",
            }[self.manual_override]
            gesture_command = manual_gesture
        state, command, reason = self.state_machine.apply(decision, gesture_command)
        safety_distance = (
            obstacle_distance_cm
            if target is not None and self.state_machine.enabled
            else None
        )
        safety = self.safety.apply(state, command, reason, safety_distance)
        state, command, reason = safety.state, safety.command, safety.reason
        linear_speed, angular_speed = self._command_speeds(command, decision.linear_speed, decision.angular_speed, gesture_command is not None)
        if safety.active:
            linear_speed = 0.0
            angular_speed = 0.45 if command == RobotCommand.RIGHT else -0.45
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
            obstacle_distance_cm=obstacle_distance_cm,
            safety_active=safety.active,
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
