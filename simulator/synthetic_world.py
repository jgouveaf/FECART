from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import List, Tuple

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from core.models import BoundingBox, Detection


@dataclass
class SimTarget:
    track_id: int
    name: str
    x: float
    y: float
    vx: float
    vy: float
    width: int
    height: int
    hidden_until: float = 0.0


class SyntheticWorld:
    """Synthetic test world for the fair demo without a physical cart."""

    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height
        self.targets: List[SimTarget] = []
        self.reset()

    def reset(self) -> None:
        self.targets = [
            SimTarget(1, "Joao", 160, 180, 3.2, 1.4, 72, 168),
            SimTarget(2, "Ana", 680, 300, -2.5, -1.1, 66, 155),
            SimTarget(3, "Rafael", 430, 120, 1.8, 2.8, 70, 162),
        ]

    def force_occlusion(self) -> None:
        if not self.targets:
            return
        target = random.choice(self.targets)
        target.hidden_until = time.time() + 3.2

    def next_frame(self) -> Tuple[np.ndarray, List[Detection]]:
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        self._draw_background(frame)
        detections: List[Detection] = []
        now = time.time()

        for target in self.targets:
            target.x += target.vx
            target.y += target.vy
            if target.x < 40 or target.x + target.width > self.width - 40:
                target.vx *= -1
            if target.y < 40 or target.y + target.height > self.height - 40:
                target.vy *= -1

            if now < target.hidden_until:
                continue

            bbox = BoundingBox(target.x, target.y, target.x + target.width, target.y + target.height)
            detections.append(Detection(bbox=bbox, confidence=0.92, track_id=target.track_id, identity_hint=target.name))
            self._draw_person(frame, target)

        return frame, detections

    def _draw_background(self, frame: np.ndarray) -> None:
        frame[:] = (8, 14, 22)
        if cv2 is None:
            frame[:, ::48] = (20, 45, 55)
            frame[::48, :] = (20, 45, 55)
            return
        for x in range(0, self.width, 48):
            cv2.line(frame, (x, 0), (x, self.height), (20, 45, 55), 1)
        for y in range(0, self.height, 48):
            cv2.line(frame, (0, y), (self.width, y), (20, 45, 55), 1)
        cv2.putText(frame, "SIMULADOR QUANTUM", (28, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (80, 245, 255), 2)

    def _draw_person(self, frame: np.ndarray, target: SimTarget) -> None:
        x, y = int(target.x), int(target.y)
        w, h = target.width, target.height
        color = (40, 220, 255)
        if cv2 is None:
            frame[y : y + h, x : x + 2] = color
            frame[y : y + h, x + w - 2 : x + w] = color
            frame[y : y + 2, x : x + w] = color
            frame[y + h - 2 : y + h, x : x + w] = color
            return
        cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
        cv2.circle(frame, (x + w // 2, y + 26), 18, (80, 180, 255), -1)
        cv2.line(frame, (x + w // 2, y + 45), (x + w // 2, y + h - 35), color, 3)
        cv2.line(frame, (x + w // 2, y + 74), (x + 8, y + 112), color, 2)
        cv2.line(frame, (x + w // 2, y + 74), (x + w - 8, y + 112), color, 2)
        cv2.putText(frame, target.name, (x, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 1)
