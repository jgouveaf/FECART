from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np


@dataclass(frozen=True)
class GestureResult:
    command: str
    confidence: float


class GestureStabilizer:
    """Remove oscilacoes entre gestos sem atrasar o comando de parada."""

    def __init__(self, stable_frames: int = 3, release_frames: int = 4) -> None:
        if stable_frames < 1 or release_frames < 1:
            raise ValueError("Os limites temporais devem ser positivos")
        self.stable_frames = int(stable_frames)
        self.release_frames = int(release_frames)
        self.pending_command: Optional[str] = None
        self.pending_count = 0
        self.missing_count = 0
        self.active: Optional[GestureResult] = None

    def reset(self) -> None:
        self.pending_command = None
        self.pending_count = 0
        self.missing_count = 0
        self.active = None

    def update(self, result: Optional[GestureResult]) -> Optional[GestureResult]:
        if result is None:
            self.missing_count += 1
            self.pending_command = None
            self.pending_count = 0
            if self.missing_count >= self.release_frames:
                self.active = None
            return self.active

        self.missing_count = 0
        if result.command == "PARAR":
            self.active = result
            self.pending_command = None
            self.pending_count = 0
            return self.active

        if result.command == self.pending_command:
            self.pending_count += 1
        else:
            self.pending_command = result.command
            self.pending_count = 1
        if self.pending_count >= self.stable_frames:
            self.active = result
        return self.active


class GestureRecognizer:
    """MediaPipe Hands gesture recognizer.

    If a trained model exists (gesture_model.pkl), uses it.
    Otherwise falls back to the rule-based classifier.
    """

    def __init__(
        self,
        assets_dir: Optional[Path] = None,
        stable_frames: int = 3,
        release_frames: int = 4,
    ) -> None:
        self.available = False
        self.mp_hands = None
        self.hands = None
        self._trainer_model = None
        self._label_map: list[str] = []
        self._use_trained = False
        self.stabilizer = GestureStabilizer(stable_frames, release_frames)

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
        handedness = None
        if result.multi_handedness:
            handedness = result.multi_handedness[0].classification[0].label

        # Number gestures are reserved for robot control.  They take priority
        # over a custom trained gesture so the commands remain predictable.
        number_gesture = self._classify_finger_count(hand, handedness)
        if number_gesture is not None:
            return self.stabilizer.update(number_gesture)

        if self._use_trained and self._trainer_model is not None:
            return self.stabilizer.update(self._predict_trained(hand))
        return self.stabilizer.update(self._classify_rules(hand))

    @staticmethod
    def _classify_finger_count(lm, handedness: Optional[str]) -> Optional[GestureResult]:
        """Map one to five raised fingers to the robot's manual commands."""
        fingers_up = [
            lm[8].y < lm[6].y,
            lm[12].y < lm[10].y,
            lm[16].y < lm[14].y,
            lm[20].y < lm[18].y,
        ]

        # The thumb points in the opposite horizontal direction for each hand.
        # If MediaPipe cannot identify the hand, omit it rather than guessing.
        thumb_up = False
        if handedness == "Right":
            thumb_up = lm[4].x < lm[3].x
        elif handedness == "Left":
            thumb_up = lm[4].x > lm[3].x

        finger_count = sum(fingers_up) + int(thumb_up)
        command_map = {
            1: ("SEGUIR", "um dedo: frente"),
            2: ("VIRAR_DIREITA", "dois dedos: direita"),
            3: ("VIRAR_ESQUERDA", "tres dedos: esquerda"),
            4: ("PARAR", "quatro dedos: parar"),
            5: ("GIRAR", "cinco dedos: girar"),
        }
        command = command_map.get(finger_count)
        if command is None:
            return None
        return GestureResult(command[0], 0.92)

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
