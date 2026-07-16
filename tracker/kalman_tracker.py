from __future__ import annotations

import math
from typing import Tuple

import numpy as np


class KalmanTracker:
    """Constant velocity Kalman filter for one target center."""

    def __init__(self, initial_center: Tuple[float, float]) -> None:
        x, y = initial_center
        self.state = np.array([[x], [y], [0.0], [0.0]], dtype=float)
        self.P = np.eye(4) * 100.0
        self.F = np.array(
            [[1.0, 0.0, 1.0, 0.0], [0.0, 1.0, 0.0, 1.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]],
            dtype=float,
        )
        self.H = np.array([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]], dtype=float)
        self.R = np.eye(2) * 18.0
        self.Q = np.eye(4) * 0.05

    def predict(self) -> Tuple[Tuple[float, float], float, Tuple[float, float], float, float]:
        self.state = self.F @ self.state
        self.P = self.F @ self.P @ self.F.T + self.Q
        center = (float(self.state[0, 0]), float(self.state[1, 0]))
        velocity = (float(self.state[2, 0]), float(self.state[3, 0]))
        speed = float(math.hypot(velocity[0], velocity[1]))
        direction = float((math.degrees(math.atan2(velocity[1], velocity[0])) + 360.0) % 360.0) if speed > 0 else 0.0
        uncertainty = float(np.sqrt(max(self.P[0, 0], 1.0)) * 2.0)
        return center, uncertainty, velocity, speed, direction

    def update(self, center: Tuple[float, float]) -> Tuple[Tuple[float, float], float, Tuple[float, float], float, float]:
        z = np.array([[center[0]], [center[1]]], dtype=float)
        y = z - self.H @ self.state
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.state = self.state + K @ y
        self.P = (np.eye(4) - K @ self.H) @ self.P
        return self.predict()
