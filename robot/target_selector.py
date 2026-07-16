from __future__ import annotations

from typing import Iterable, Optional

from core.models import TargetState, TrackedTarget
from robot.robot_models import TargetLock


class TargetSelector:
    """Keeps a stable lock on one selected tracked target."""

    def __init__(self) -> None:
        self.lock: Optional[TargetLock] = None

    def select(self, target: TrackedTarget) -> TargetLock:
        self.lock = TargetLock(target.track_id, target.name, target.person_id)
        return self.lock

    def select_by_id(self, track_id: int, targets: Iterable[TrackedTarget]) -> Optional[TargetLock]:
        target = self.find_target(track_id, targets)
        if target is None:
            return None
        return self.select(target)

    def clear(self) -> None:
        self.lock = None

    def current_target(self, targets: Iterable[TrackedTarget]) -> Optional[TrackedTarget]:
        if self.lock is None:
            return None
        exact = self.find_target(self.lock.track_id, targets)
        if exact is not None:
            return exact

        if self.lock.person_id is not None:
            for target in targets:
                if target.person_id == self.lock.person_id and target.state != TargetState.REMOVED:
                    self.lock = TargetLock(target.track_id, target.name, target.person_id)
                    return target
        return None

    def find_target(self, track_id: int, targets: Iterable[TrackedTarget]) -> Optional[TrackedTarget]:
        for target in targets:
            if target.track_id == track_id and target.state != TargetState.REMOVED:
                return target
        return None
