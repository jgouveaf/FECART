from __future__ import annotations

import pickle
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np


class GestureTrainer:
    """
    Teachable-Machine-style gesture trainer.

    Collects hand landmark samples per class, trains an SVM/MLP classifier
    on the 63-feature landmark vectors, and persists the model to disk.
    """

    MODEL_FILE = "gesture_model.pkl"

    def __init__(self, assets_dir: Path) -> None:
        self.assets_dir = assets_dir
        self.model_path = assets_dir / self.MODEL_FILE
        # {class_name: [np.ndarray(63,), ...]}
        self.samples: Dict[str, List[np.ndarray]] = {}
        self.model = None
        self.label_map: List[str] = []
        self._mp_hands = None
        self._hands = None
        self._init_mediapipe()

    # ──────────────────────────────────────────────────────────────────
    # MediaPipe setup
    # ──────────────────────────────────────────────────────────────────

    def _init_mediapipe(self) -> None:
        try:
            import mediapipe as mp
            self._mp_hands = mp.solutions.hands
            self._hands = self._mp_hands.Hands(
                static_image_mode=False,
                max_num_hands=1,
                min_detection_confidence=0.55,
                min_tracking_confidence=0.50,
            )
        except Exception:
            self._hands = None

    # ──────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────

    def classes(self) -> List[str]:
        return list(self.samples.keys())

    def sample_count(self, class_name: str) -> int:
        return len(self.samples.get(class_name, []))

    def total_samples(self) -> int:
        return sum(len(v) for v in self.samples.values())

    def add_class(self, name: str) -> None:
        name = name.strip().upper()
        if name and name not in self.samples:
            self.samples[name] = []

    def remove_class(self, name: str) -> None:
        self.samples.pop(name, None)

    def add_sample_from_frame(self, frame: np.ndarray, class_name: str) -> bool:
        """Extract landmarks from a BGR frame and store them."""
        vec = self._extract(frame)
        if vec is None:
            return False
        self.samples.setdefault(class_name, []).append(vec)
        return True

    def add_samples_from_video(
        self,
        video_path: str,
        class_name: str,
        max_frames: int = 300,
        progress_cb=None,
    ) -> int:
        """Extract landmark samples from a video file."""
        try:
            import cv2
        except ImportError:
            return 0

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return 0

        total = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
        collected = 0
        frame_idx = 0
        skip = max(1, total // max_frames)

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % skip == 0:
                if self.add_sample_from_frame(frame, class_name):
                    collected += 1
                if progress_cb:
                    progress_cb(min(99, int(frame_idx / total * 100)))
                if collected >= max_frames:
                    break
            frame_idx += 1

        cap.release()
        if progress_cb:
            progress_cb(100)
        return collected

    def train(self, progress_cb=None) -> Tuple[bool, str]:
        """Train an SVM classifier on the collected samples."""
        if len(self.samples) < 2:
            return False, "Precisa de pelo menos 2 classes para treinar."
        min_samples = min(self.sample_count(c) for c in self.samples)
        if min_samples < 5:
            return False, f"Cada classe precisa de pelo menos 5 amostras. Mínimo atual: {min_samples}."

        try:
            from sklearn.calibration import CalibratedClassifierCV
            from sklearn.preprocessing import StandardScaler
            from sklearn.svm import SVC
            from sklearn.pipeline import Pipeline
        except ImportError:
            return False, "sklearn não instalado. Execute: pip install scikit-learn"

        if progress_cb:
            progress_cb(10)

        X, y = [], []
        self.label_map = sorted(self.samples.keys())
        for label_idx, cls in enumerate(self.label_map):
            for vec in self.samples[cls]:
                X.append(vec)
                y.append(label_idx)

        X = np.array(X)
        y = np.array(y)

        if progress_cb:
            progress_cb(30)

        pipeline = Pipeline([
            ("scaler", StandardScaler()),
            (
                "clf",
                CalibratedClassifierCV(
                    estimator=SVC(kernel="rbf", C=10.0, gamma="scale"),
                    method="sigmoid",
                    cv=3,
                    ensemble=False,
                ),
            ),
        ])
        pipeline.fit(X, y)

        if progress_cb:
            progress_cb(80)

        self.model = pipeline
        self._save()

        if progress_cb:
            progress_cb(100)

        counts = {c: self.sample_count(c) for c in self.label_map}
        summary = ", ".join(f"{c}:{n}" for c, n in counts.items())
        return True, f"Modelo treinado com {len(X)} amostras. ({summary})"

    def predict(self, frame: np.ndarray) -> Optional[Tuple[str, float]]:
        """Predict the gesture in a frame. Returns (class_name, confidence)."""
        if self.model is None:
            return None
        vec = self._extract(frame)
        if vec is None:
            return None
        try:
            proba = self.model.predict_proba([vec])[0]
            idx = int(np.argmax(proba))
            conf = float(proba[idx])
            if conf < 0.60:
                return None
            return self.label_map[idx], conf
        except Exception:
            return None

    def load_if_exists(self) -> bool:
        if not self.model_path.exists():
            return False
        try:
            with open(self.model_path, "rb") as f:
                data = pickle.load(f)
            self.model = data["model"]
            self.label_map = data["label_map"]
            return True
        except Exception:
            return False

    def reset(self) -> None:
        self.samples = {}
        self.model = None
        self.label_map = []
        if self.model_path.exists():
            self.model_path.unlink()

    # ──────────────────────────────────────────────────────────────────
    # Internal
    # ──────────────────────────────────────────────────────────────────

    def _extract(self, frame: np.ndarray) -> Optional[np.ndarray]:
        if self._hands is None:
            return None
        try:
            import cv2
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = self._hands.process(rgb)
        except Exception:
            return None
        if not result.multi_hand_landmarks:
            return None
        lm = result.multi_hand_landmarks[0].landmark
        # Normalize relative to wrist
        wrist = np.array([lm[0].x, lm[0].y, lm[0].z])
        vec = []
        for pt in lm:
            vec.extend([pt.x - wrist[0], pt.y - wrist[1], pt.z - wrist[2]])
        return np.array(vec, dtype=np.float32)

    def _save(self) -> None:
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        with open(self.model_path, "wb") as f:
            pickle.dump({"model": self.model, "label_map": self.label_map}, f)
