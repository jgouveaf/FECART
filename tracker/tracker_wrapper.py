from __future__ import annotations

import logging
import time
from typing import Dict, List, Optional, Tuple

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from core.models import BoundingBox, Detection, SystemEvent, TargetState, TrackedTarget
from tracker.track_manager import TrackManager
from tracker.yolo_tracker import YoloPersonTracker
from utils.config import AppConfig

logger = logging.getLogger("tracker_wrapper")


class TrackerWrapper:
    """Wraps the detector and track manager, providing visual Re-ID (Stable IDs).

    Uses color histograms (HSV) to re-associate tracks that were lost,
    acting as a fast bridge to InsightFace.
    """

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.detector = YoloPersonTracker(config)
        self.track_manager = TrackManager(config)

        # track_id -> normalized HSV histogram
        self.active_histograms: Dict[int, np.ndarray] = {}

        # lost_track_id -> { 'hist': np.ndarray, 'name': Optional[str], 'last_seen': float }
        self.lost_tracks: Dict[int, dict] = {}

        self.reid_threshold = 0.65
        self.max_lost_age_seconds = 180.0  # 3 minutes lifetime for lost targets

    def reset(self) -> None:
        """Resets the state of tracking and visual profiles."""
        self.track_manager.reset()
        self.active_histograms.clear()
        self.lost_tracks.clear()
        logger.info("TrackerWrapper resetado.")

    def get_stable_targets(self) -> List[TrackedTarget]:
        """Retorna os alvos ativos (estaveis) que nao estao removidos."""
        return [target for target in self.track_manager.targets.values() if target.state != TargetState.REMOVED]

    def update(self, frame: np.ndarray, detections: List[Detection]) -> Tuple[List[TrackedTarget], List[SystemEvent]]:
        """Updates tracks with new frame and detections.

        Applies visual Re-ID to stable-ize track IDs across occlusions.
        """
        # 1. Apply Re-ID to re-associate new detections to lost track IDs
        if frame is not None and cv2 is not None:
            try:
                self._apply_reid(frame, detections)
            except Exception as e:
                logger.error(f"Erro no Re-ID: {e}")

        # 2. Update track manager to perform Kalman filtering and state updates
        targets, events = self.track_manager.update(detections)

        # 3. Update active histograms and move lost tracks to repository
        if frame is not None and cv2 is not None:
            try:
                self._update_profiles(frame, targets)
            except Exception as e:
                logger.error(f"Erro na atualizacao de perfis visuais: {e}")

        return targets, events

    def _apply_reid(self, frame: np.ndarray, detections: List[Detection]) -> None:
        """Compares new detections with lost track visual profiles to restore IDs."""
        self._clean_expired_lost_tracks()

        if not self.lost_tracks:
            return

        for detection in detections:
            # Re-ID candidates are:
            # - Detections with a track_id not currently active in TrackManager (assigned by YOLO after loss)
            # - Detections without track_id (fallback mode or newly spawned)
            is_new_track = (
                detection.track_id is not None
                and int(detection.track_id) not in self.track_manager.targets
            )
            is_untracked = detection.track_id is None

            if not (is_new_track or is_untracked):
                continue

            hist = self._compute_histogram(frame, detection.bbox)
            if hist is None:
                continue

            best_lost_id = None
            best_score = -1.0

            for lost_id, info in self.lost_tracks.items():
                score = self._compare_histograms(hist, info["hist"])
                if score > best_score:
                    best_score = score
                    best_lost_id = lost_id

            if best_lost_id is not None and best_score >= self.reid_threshold:
                # Retrieve name if they were identified before
                matched_info = self.lost_tracks.pop(best_lost_id)
                old_track_id = best_lost_id
                original_track_id = detection.track_id

                # Assign the stable ID
                detection.track_id = old_track_id
                if matched_info["name"]:
                    detection.identity_hint = matched_info["name"]
                
                if is_untracked:
                    logger.info(f"Re-ID bem sucedido: Detecao sem ID -> Track {old_track_id} (Score: {best_score:.2f})")
                else:
                    logger.info(f"Re-ID bem sucedido: Track {original_track_id} -> {old_track_id} (Score: {best_score:.2f})")

    def _update_profiles(self, frame: np.ndarray, targets: List[TrackedTarget]) -> None:
        """Updates active visual profiles and archives targets that went missing."""
        current_active_ids = set()

        for target in targets:
            if target.state == TargetState.VISIBLE:
                current_active_ids.add(target.track_id)
                hist = self._compute_histogram(frame, target.bbox)
                if hist is not None:
                    self.active_histograms[target.track_id] = hist
                    # If it was in lost tracks, remove it as it is now active
                    self.lost_tracks.pop(target.track_id, None)

        # Move targets that are lost/ghost/removed to lost tracks repository
        for track_id, hist in list(self.active_histograms.items()):
            if track_id not in current_active_ids:
                # Find target in track manager to extract its name/identity
                target = self.track_manager.targets.get(track_id)
                name = target.name if target else None

                self.lost_tracks[track_id] = {
                    "hist": hist,
                    "name": name,
                    "last_seen": time.time(),
                }
                self.active_histograms.pop(track_id, None)

    def _compute_histogram(self, frame: np.ndarray, bbox: BoundingBox) -> Optional[np.ndarray]:
        """Extracts and normalizes a 2D Hue-Saturation color histogram of the bounding box."""
        if cv2 is None or frame is None:
            return None

        h, w = frame.shape[:2]
        x1, y1 = max(0, int(bbox.x1)), max(0, int(bbox.y1))
        x2, y2 = min(w, int(bbox.x2)), min(h, int(bbox.y2))

        if x2 <= x1 or y2 <= y1:
            return None

        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return None

        try:
            hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
            # Use 8 bins for Hue and 8 bins for Saturation
            hist = cv2.calcHist([hsv], [0, 1], None, [8, 8], [0, 180, 0, 256])
            cv2.normalize(hist, hist)
            return hist.flatten()
        except Exception as e:
            logger.debug(f"Falha ao computar histograma: {e}")
            return None

    def _compare_histograms(self, hist1: np.ndarray, hist2: np.ndarray) -> float:
        """Compares two normalized histograms using correlation."""
        if cv2 is None:
            return 0.0
        try:
            h1 = hist1.reshape(8, 8)
            h2 = hist2.reshape(8, 8)
            return float(cv2.compareHist(h1, h2, cv2.HISTCMP_CORREL))
        except Exception as e:
            logger.debug(f"Falha ao comparar histogramas: {e}")
            return 0.0

    def _clean_expired_lost_tracks(self) -> None:
        """Removes visual profiles of targets lost for too long."""
        now = time.time()
        for lost_id, info in list(self.lost_tracks.items()):
            if now - info["last_seen"] > self.max_lost_age_seconds:
                self.lost_tracks.pop(lost_id, None)
