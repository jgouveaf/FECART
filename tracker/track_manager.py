from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

from core.models import BoundingBox, Detection, EventType, SystemEvent, TargetState, TrackedTarget
from tracker.kalman_tracker import KalmanTracker
from utils.config import AppConfig


class TrackManager:
    """Maintains persistent target IDs and Ghost predictions."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.targets: Dict[int, TrackedTarget] = {}
        self.filters: Dict[int, KalmanTracker] = {}
        self.next_id = 1

    def reset(self) -> None:
        self.targets.clear()
        self.filters.clear()
        self.next_id = 1

    def update(self, detections: List[Detection]) -> Tuple[List[TrackedTarget], List[SystemEvent]]:
        events: List[SystemEvent] = []
        seen: set[int] = set()

        for detection in detections:
            track_id = self._resolve_track_id(detection, seen)
            seen.add(track_id)
            previous = self.targets.get(track_id)
            if previous is None:
                target = TrackedTarget(track_id=track_id, bbox=detection.bbox, confidence=detection.confidence)
                target.distance_estimate = self._estimate_distance(detection.bbox)
                if detection.identity_hint:
                    target.name = detection.identity_hint
                    target.identity_confidence = detection.confidence
                self.targets[track_id] = target
                self.filters[track_id] = KalmanTracker(detection.bbox.center)
                events.append(SystemEvent(EventType.TARGET_CREATED, track_id, target.name, detection.confidence, TargetState.VISIBLE.value))
                if detection.identity_hint:
                    events.append(SystemEvent(EventType.TARGET_IDENTIFIED, track_id, target.name, detection.confidence, TargetState.VISIBLE.value))
                continue

            old_state = previous.state
            previous_name = previous.name
            previous.bbox = detection.bbox
            previous.confidence = detection.confidence
            previous.frames_missing = 0
            previous.state = TargetState.VISIBLE
            previous.uncertainty = 14.0
            if detection.identity_hint:
                previous.name = detection.identity_hint
                previous.identity_confidence = detection.confidence
            center, uncertainty, velocity, speed, direction = self.filters[track_id].update(detection.bbox.center)
            previous.uncertainty = uncertainty
            previous.velocity_x, previous.velocity_y = velocity
            previous.speed = speed
            previous.direction_degrees = direction
            previous.distance_estimate = self._estimate_distance(detection.bbox)
            if old_state in {TargetState.OCCLUDED, TargetState.GHOST, TargetState.LOST}:
                events.append(SystemEvent(EventType.TRACKING_RECOVERED, track_id, previous.name, detection.confidence, previous.state.value))
            if detection.identity_hint and detection.identity_hint != previous_name:
                events.append(SystemEvent(EventType.TARGET_IDENTIFIED, track_id, previous.name, detection.confidence, previous.state.value))

        for track_id, target in list(self.targets.items()):
            if track_id in seen:
                continue
            target.frames_missing += 1
            predicted_center, uncertainty, velocity, speed, direction = self.filters[track_id].predict()
            target.bbox = target.bbox.moved_to(predicted_center)
            target.uncertainty = uncertainty
            target.velocity_x, target.velocity_y = velocity
            target.speed = speed
            target.direction_degrees = direction

            old_state = target.state
            if target.frames_missing >= self.config.remove_after_frames:
                target.state = TargetState.REMOVED
                events.append(SystemEvent(EventType.TARGET_REMOVED, track_id, target.name, target.confidence, target.state.value))
                self.targets.pop(track_id, None)
                self.filters.pop(track_id, None)
                continue
            if target.frames_missing >= self.config.lost_after_frames:
                target.state = TargetState.LOST
                if old_state != TargetState.LOST:
                    events.append(SystemEvent(EventType.TARGET_LOST, track_id, target.name, target.confidence, target.state.value))
            elif target.frames_missing >= self.config.ghost_after_frames:
                target.state = TargetState.GHOST
                if old_state != TargetState.GHOST:
                    events.append(SystemEvent(EventType.GHOST_ACTIVATED, track_id, target.name, target.confidence, target.state.value))
            else:
                target.state = TargetState.OCCLUDED
                if old_state != TargetState.OCCLUDED:
                    events.append(SystemEvent(EventType.TARGET_LOST, track_id, target.name, target.confidence, target.state.value))

        active = [target for target in self.targets.values() if target.state != TargetState.REMOVED]
        return active, events

    def _resolve_track_id(self, detection: Detection, seen: set[int]) -> int:
        if detection.track_id is not None:
            track_id = int(detection.track_id)
            self.next_id = max(self.next_id, track_id + 1)
            return track_id

        best_id: Optional[int] = None
        best_distance = self.config.max_match_distance
        cx, cy = detection.bbox.center
        for track_id, target in self.targets.items():
            if track_id in seen:
                continue
            tx, ty = target.bbox.center
            distance = math.hypot(cx - tx, cy - ty)
            if distance < best_distance:
                best_distance = distance
                best_id = track_id
        if best_id is not None:
            return best_id

        track_id = self.next_id
        self.next_id += 1
        return track_id

    def _estimate_distance(self, bbox: BoundingBox) -> float:
        if bbox.height <= 0:
            return 0.0
        return round(220.0 / bbox.height, 2)
