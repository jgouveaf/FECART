from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np


@dataclass(frozen=True)
class GestureResult:
    command: str
    confidence: float


class GestureRecognizer:
    """MediaPipe Hands gesture recognizer.

    If a trained model exists (gesture_model.pkl), uses it.
    Otherwise falls back to the rule-based classifier.
    """

    def __init__(self, assets_dir: Optional[Path] = None) -> None:
        self.available = False
        self.mp_hands = None
        self.hands = None
        self._trainer_model = None
        self._label_map: list[str] = []
        self._use_trained = False

        try:
            import mediapipe as mp

            self.mp_hands = mp.solutions.hands
            self.hands = self.mp_hands.Hands(
                static_image_mode=False,
                max_num_hands=1,
                min_detection_confidence=0.65,
                min_tracking_confidence=0.60,
            )
            self.available = True
        except Exception:
            self.available = False

        # Try to load trained model
        if assets_dir is not None:
            self._try_load_model(assets_dir)

    def reload_model(self, assets_dir: Path) -> bool:
        """Reload the trained model from disk (call after training)."""
        return self._try_load_model(assets_dir)

    def _try_load_model(self, assets_dir: Path) -> bool:
        model_path = assets_dir / "gesture_model.pkl"
        if not model_path.exists():
            self._use_trained = False
            return False
        try:
            import pickle
            with open(model_path, "rb") as f:
                data = pickle.load(f)
            self._trainer_model = data["model"]
            self._label_map = data["label_map"]
            self._use_trained = True
            return True
        except Exception:
            self._use_trained = False
            return False

    def detect(self, frame) -> Optional[GestureResult]:
        if not self.available or self.hands is None:
            return None
        try:
            import cv2
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = self.hands.process(rgb)
        except Exception:
            return None
        if not result.multi_hand_landmarks:
            return None
        hand = result.multi_hand_landmarks[0].landmark

        if self._use_trained and self._trainer_model is not None:
            return self._predict_trained(hand)
        return self._classify_rules(hand)

    def _predict_trained(self, lm) -> Optional[GestureResult]:
        """Use the trained SVM model."""
        import numpy as np
        wrist = np.array([lm[0].x, lm[0].y, lm[0].z])
        vec = []
        for pt in lm:
            vec.extend([pt.x - wrist[0], pt.y - wrist[1], pt.z - wrist[2]])
        vec = np.array(vec, dtype=np.float32).reshape(1, -1)
        try:
            proba = self._trainer_model.predict_proba(vec)[0]
            idx = int(np.argmax(proba))
            conf = float(proba[idx])
            if conf < 0.60:
                return None
            return GestureResult(self._label_map[idx], conf)
        except Exception:
            return None

    def _classify_rules(self, lm) -> Optional[GestureResult]:
        """Original rule-based fallback classifier."""
        fingers = [
            lm[8].y < lm[6].y,
            lm[12].y < lm[10].y,
            lm[16].y < lm[14].y,
            lm[20].y < lm[18].y,
        ]
        open_count = sum(fingers)
        wrist_x = lm[0].x
        middle_x = lm[9].x

        if open_count == 4:
            if middle_x < wrist_x - 0.10:
                return GestureResult("VIRAR_ESQUERDA", 0.86)
            if middle_x > wrist_x + 0.10:
                return GestureResult("VIRAR_DIREITA", 0.86)
            return GestureResult("PARAR", 0.86)
        if open_count == 0:
            return GestureResult("SEGUIR", 0.86)
        if fingers[0] and fingers[1] and not fingers[2] and not fingers[3]:
            return GestureResult("RE", 0.86)
        return None

