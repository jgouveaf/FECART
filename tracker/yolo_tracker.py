from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Deque, List, Optional, Tuple

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from core.models import BoundingBox, Detection
from utils.config import AppConfig

logger = logging.getLogger("yolo_tracker")


class YoloPersonTracker:
    """YOLOv8 person detector optimized for low-end notebooks (no GPU).

    Optimizations applied:
    - Inference on resized frame (imgsz=416) instead of full resolution.
    - FP16 (half precision) when CUDA is available, FP32 otherwise.
    - ONNX export used automatically if the .onnx model exists beside the .pt.
    - Detection interval: YOLO runs every N frames; frames in between reuse
      the last result (smoothed by the Kalman tracker in TrackManager).
    - Background detection thread: YOLO runs in a daemon thread so the UI
      timer is never blocked waiting for inference.
    """

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.available = False
        self.backend_name = "Carregando detector..."
        self.last_error = ""
        self.model = None
        self.hog = None

        # ── Threading state ───────────────────────────────────────────
        self._lock = threading.Lock()
        self._latest_detections: List[Detection] = []
        self._inference_frame: Optional[np.ndarray] = None
        self._busy = False                       # True while a thread is running
        self._thread: Optional[threading.Thread] = None

        # ── Interval / skip ──────────────────────────────────────────
        self._frame_counter = 0
        self._detect_interval = config.yolo_detect_interval  # run every N frames

        # ── HOG fallback ─────────────────────────────────────────────
        if cv2 is not None:
            try:
                self.hog = cv2.HOGDescriptor()
                self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
            except Exception:
                self.hog = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(self, frame: np.ndarray) -> List[Detection]:
        """Non-blocking detect: submits frame to background thread if ready,
        always returns the most recent cached detections immediately."""
        if not self._ensure_yolo_loaded():
            return self._detect_with_hog(frame)

        self._frame_counter += 1

        # Only submit to the inference thread every N frames
        if self._frame_counter % self._detect_interval == 0:
            self._submit_async(frame)

        with self._lock:
            return list(self._latest_detections)

    def shutdown(self) -> None:
        """Wait for any running inference thread to finish."""
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _submit_async(self, frame: np.ndarray) -> None:
        """Submit a frame for background YOLO inference (skip if busy)."""
        with self._lock:
            if self._busy:
                return                           # previous inference still running, skip
            self._busy = True
            self._inference_frame = self._preprocess(frame)

        self._thread = threading.Thread(target=self._infer, daemon=True)
        self._thread.start()

    def _infer(self) -> None:
        """Run YOLO inference in background thread and cache results."""
        try:
            frame = self._inference_frame
            if frame is None:
                return

            results = self.model.track(
                frame,
                classes=[0],                                     # person only
                conf=self.config.detection_confidence,
                persist=True,
                tracker=self.config.yolo_tracker,
                imgsz=self.config.yolo_infer_size,               # reduced resolution
                half=self.config.yolo_half_precision,            # FP16 when CUDA
                verbose=False,
            )

            detections = self._parse_results(results, frame.shape)
            with self._lock:
                self._latest_detections = detections
        except Exception as exc:
            logger.warning(f"YOLO inference error: {exc}")
            self.last_error = str(exc)
        finally:
            with self._lock:
                self._busy = False

    def _preprocess(self, frame: np.ndarray) -> np.ndarray:
        """Resize frame to speed up inference while maintaining aspect ratio."""
        if cv2 is None:
            return frame
        target_w = self.config.yolo_infer_size
        h, w = frame.shape[:2]
        if w <= target_w:
            return frame
        scale = target_w / w
        new_h = int(h * scale)
        return cv2.resize(frame, (target_w, new_h), interpolation=cv2.INTER_LINEAR)

    def _parse_results(self, results, frame_shape: tuple) -> List[Detection]:
        """Parse Ultralytics result boxes back to Detection objects."""
        if not results:
            return []
        boxes = results[0].boxes
        if boxes is None:
            return []

        orig_h, orig_w = frame_shape[:2]
        target_w = self.config.yolo_infer_size
        scale = orig_w / min(orig_w, target_w)   # inverse scale to restore coords

        xyxy  = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        ids   = (
            boxes.id.cpu().numpy().astype(int).tolist()
            if boxes.id is not None
            else [None] * len(xyxy)
        )

        detections: List[Detection] = []
        for coords, conf, track_id in zip(xyxy, confs, ids):
            x1, y1, x2, y2 = (float(v) * scale for v in coords)
            detections.append(Detection(BoundingBox(x1, y1, x2, y2), float(conf), track_id))
        return detections

    def _ensure_yolo_loaded(self) -> bool:
        if self.model is not None and self.available:
            return True
        try:
            from ultralytics import YOLO
            import torch

            # Prefer ONNX model (faster on CPU) if it exists beside the .pt
            pt_path = self.config.yolo_model
            onnx_path = pt_path.replace(".pt", ".onnx")

            import os
            if os.path.exists(onnx_path):
                model_path = onnx_path
                backend = "ONNX CPU"
            else:
                model_path = pt_path
                backend = "PyTorch CPU"

            self.model = YOLO(model_path)
            cuda_ok = torch.cuda.is_available()
            self.config = self.config       # keep ref
            self.available = True
            self.backend_name = f"YOLOv8n + ByteTrack ({backend}{'+ FP16' if cuda_ok and self.config.yolo_half_precision else ''})"
            self.last_error = ""
            logger.info(f"YOLO loaded: {self.backend_name}")
            return True
        except Exception as exc:
            self.available = False
            self.backend_name = "HOG fallback"
            self.last_error = f"YOLO indisponivel: {exc}"
            logger.warning(self.last_error)
            return False

    def _detect_with_hog(self, frame: np.ndarray) -> List[Detection]:
        """Fallback CPU people detector using HOG+SVM (no DNN required)."""
        if self.hog is None or cv2 is None:
            return []
        try:
            # HOG also benefits from a smaller image
            small = cv2.resize(frame, (640, 360)) if frame.shape[1] > 640 else frame
            scale_x = frame.shape[1] / small.shape[1]
            scale_y = frame.shape[0] / small.shape[0]
            raw_boxes, weights = self.hog.detectMultiScale(
                small, winStride=(8, 8), padding=(16, 16), scale=1.05
            )
        except Exception:
            return []
        detections: List[Detection] = []
        for (x, y, w, h), weight in zip(raw_boxes, weights):
            if float(weight) < 0.35:
                continue
            detections.append(Detection(
                BoundingBox(
                    float(x) * scale_x, float(y) * scale_y,
                    float(x + w) * scale_x, float(y + h) * scale_y,
                ),
                min(float(weight), 1.0),
            ))
        return detections
