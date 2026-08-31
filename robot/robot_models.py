from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple

from core.models import TargetState


class RobotCommand(str, Enum):
    FORWARD = "FRENTE"
    STOP = "PARAR"
    REVERSE = "RE"
    LEFT = "ESQUERDA"
    RIGHT = "DIREITA"


class RobotState(str, Enum):
    IDLE = "IDLE"
    FOLLOWING = "FOLLOWING"
    STOPPED = "STOPPED"
    REVERSE = "REVERSE"
    TURN_LEFT = "TURN_LEFT"
    TURN_RIGHT = "TURN_RIGHT"
    GHOST = "GHOST"
    LOST = "LOST"
    AVOIDING_OBSTACLE = "AVOIDING_OBSTACLE"


@dataclass(frozen=True)
class TargetLock:
    track_id: int
    name: Optional[str] = None
    person_id: Optional[int] = None


@dataclass(frozen=True)
class MotionDecision:
    command: RobotCommand
    reason: str
    linear_speed: float
    angular_speed: float
    horizontal_error: float
    distance_estimate: float
    target_state: TargetState


@dataclass
class RobotPose:
    x: float = 0.0
    y: float = 0.0
    heading_degrees: float = 0.0


@dataclass(frozen=True)
class RobotTelemetry:
    state: RobotState
    command: RobotCommand
    target_id: Optional[int]
    target_name: Optional[str]
    target_state: Optional[str]
    distance_estimate: float
    horizontal_error: float
    speed: float
    direction_degrees: float
    ghost_active: bool
    gesture_override: Optional[str]
    reason: str
    pose: RobotPose
    arduino_payload: str
    obstacle_distance_cm: Optional[float] = None
    safety_active: bool = False


FrameSize = Tuple[int, int]
