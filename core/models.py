from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple


class TargetState(str, Enum):
    VISIBLE = "VISIBLE"
    OCCLUDED = "OCCLUDED"
    GHOST = "GHOST"
    LOST = "LOST"
    REMOVED = "REMOVED"


class EventType(str, Enum):
    TARGET_CREATED = "TARGET_CREATED"
    TARGET_VISIBLE = "TARGET_VISIBLE"
    TARGET_IDENTIFIED = "TARGET_IDENTIFIED"
    TARGET_LOST = "TARGET_LOST"
    GHOST_ACTIVATED = "GHOST_ACTIVATED"
    TRACKING_RECOVERED = "TRACKING_RECOVERED"
    TARGET_REMOVED = "TARGET_REMOVED"
    TRACK_OBSERVATION = "TRACK_OBSERVATION"
    IDENTITY_CONFLICT = "IDENTITY_CONFLICT"
    GESTURE_DETECTED = "GESTURE_DETECTED"
    VOICE_COMMAND = "VOICE_COMMAND"
    SYSTEM_ERROR = "SYSTEM_ERROR"


@dataclass(frozen=True)
class BoundingBox:
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def width(self) -> float:
        return max(0.0, self.x2 - self.x1)

    @property
    def height(self) -> float:
        return max(0.0, self.y2 - self.y1)

    @property
    def center(self) -> Tuple[float, float]:
        return (self.x1 + self.width / 2.0, self.y1 + self.height / 2.0)

    def moved_to(self, center: Tuple[float, float]) -> "BoundingBox":
        cx, cy = center
        half_w = self.width / 2.0
        half_h = self.height / 2.0
        return BoundingBox(cx - half_w, cy - half_h, cx + half_w, cy + half_h)


@dataclass
class Detection:
    bbox: BoundingBox
    confidence: float
    track_id: Optional[int] = None
    identity_hint: Optional[str] = None


@dataclass
class TrackedTarget:
    track_id: int
    bbox: BoundingBox
    confidence: float
    state: TargetState = TargetState.VISIBLE
    name: Optional[str] = None
    identity_confidence: float = 0.0
    frames_missing: int = 0
    uncertainty: float = 18.0
    distance_estimate: float = 0.0
    velocity_x: float = 0.0
    velocity_y: float = 0.0
    speed: float = 0.0
    direction_degrees: float = 0.0
    person_id: Optional[int] = None
    last_seen_frame: int = 0
    metadata: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SystemEvent:
    event_type: EventType
    track_id: Optional[int] = None
    name: Optional[str] = None
    confidence: float = 0.0
    state: str = ""
    message: str = ""
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass(frozen=True)
class EventRecord:
    timestamp: str
    track_id: Optional[int]
    name: Optional[str]
    confidence: float
    event: str
    state: str


@dataclass(frozen=True)
class PersonRecord:
    person_id: int
    name: str
    photo_path: str
    created_at: str


@dataclass(frozen=True)
class FaceEmbeddingRecord:
    embedding_id: int
    person_id: int
    embedding_path: str
    photo_path: str
    created_at: str


@dataclass(frozen=True)
class IdentityMatch:
    person_id: int
    name: str
    confidence: float
    embedding_id: Optional[int] = None


@dataclass(frozen=True)
class SystemSnapshot:
    fps: float
    targets: List[TrackedTarget]
    recent_logs: List[EventRecord]
    system_status: str
    active_gesture: Optional[str] = None
