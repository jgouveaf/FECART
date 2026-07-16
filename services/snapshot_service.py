from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from core.models import TargetState, TrackedTarget


@dataclass(frozen=True)
class DashboardMetrics:
    total: int
    identified: int
    unknown: int
    visible: int
    occluded: int
    ghost: int
    lost: int


class SnapshotService:
    """Builds dashboard metrics from active targets."""

    def build_metrics(self, targets: Sequence[TrackedTarget]) -> DashboardMetrics:
        identified = sum(1 for target in targets if target.person_id is not None or target.name)
        total = len(targets)
        return DashboardMetrics(
            total=total,
            identified=identified,
            unknown=max(0, total - identified),
            visible=sum(1 for target in targets if target.state == TargetState.VISIBLE),
            occluded=sum(1 for target in targets if target.state == TargetState.OCCLUDED),
            ghost=sum(1 for target in targets if target.state == TargetState.GHOST),
            lost=sum(1 for target in targets if target.state == TargetState.LOST),
        )
