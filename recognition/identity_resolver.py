from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Optional

from core.models import IdentityMatch


@dataclass
class IdentityAssignment:
    track_id: int
    match: IdentityMatch
    timestamp: float


class IdentityResolver:
    """Prevents the same registered person from being assigned to multiple active tracks."""

    def __init__(self, min_confidence_margin: float = 0.08, ttl_seconds: float = 6.0) -> None:
        self.min_confidence_margin = min_confidence_margin
        self.ttl_seconds = ttl_seconds
        self.assignments_by_person: Dict[int, IdentityAssignment] = {}

    def resolve(self, track_id: int, match: IdentityMatch) -> Optional[IdentityMatch]:
        now = time.time()
        self._expire(now)
        existing = self.assignments_by_person.get(match.person_id)
        if existing is None or existing.track_id == track_id:
            self.assignments_by_person[match.person_id] = IdentityAssignment(track_id, match, now)
            return match
        if match.confidence >= existing.match.confidence + self.min_confidence_margin:
            self.assignments_by_person[match.person_id] = IdentityAssignment(track_id, match, now)
            return match
        return None

    def release_track(self, track_id: int) -> None:
        for person_id, assignment in list(self.assignments_by_person.items()):
            if assignment.track_id == track_id:
                self.assignments_by_person.pop(person_id, None)

    def _expire(self, now: float) -> None:
        for person_id, assignment in list(self.assignments_by_person.items()):
            if now - assignment.timestamp > self.ttl_seconds:
                self.assignments_by_person.pop(person_id, None)
