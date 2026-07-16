"""Advanced 2D Visual Simulator for Quantum Tracker.

Features:
- 2D Arena Grid Map (800x600 canvas)
- Simulated Robot (Rectangle / Icon with heading direction arrow)
- Movable Robot state driven by commands (FORWARD, REVERSE, LEFT, RIGHT, STOP)
- Targets (People) with colored bounding boxes
- Ghost Mode: when target disappears, renders a dashed box with predicted motion trajectory (Kalman Filter)
- Real-time display of Heading/Direction, Speed, and Estimated Distance
- Native integration with TrackerWrapper and QuantumApp loop
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from core.models import BoundingBox, Detection, TrackedTarget, TargetState
from robot.robot_models import RobotCommand, RobotPose


@dataclass
class SimTarget:
    """Represents a simulated target in 2D space."""
    track_id: int
    name: str
    x: float
    y: float
    vx: float
    vy: float
    width: int = 70
    height: int = 160
    color: Tuple[int, int, int] = (255, 200, 0)
    hidden_until: float = 0.0
    is_occluded: bool = False
    last_known_x: float = field(init=False, default=0.0)
    last_known_y: float = field(init=False, default=0.0)
    last_known_vx: float = field(init=False, default=0.0)
    last_known_vy: float = field(init=False, default=0.0)
    ghost_start_time: float = field(init=False, default=0.0)

    def __post_init__(self) -> None:
        self.last_known_x = self.x
        self.last_known_y = self.y
        self.last_known_vx = self.vx
        self.last_known_vy = self.vy


class VisualSimulator:
    """Advanced 2D visual arena simulator engine."""

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width = width
        self.height = height

        # Robot State in 2D Arena
        self.robot_x: float = width / 2.0
        self.robot_y: float = height - 120.0
        self.robot_heading: float = 0.0  # degrees: 0 = straight up (0, -1)
        self.robot_linear_speed: float = 0.0  # px/frame
        self.robot_angular_speed: float = 0.0  # deg/frame
        self.robot_width: int = 60
        self.robot_height: int = 80
        self.current_command: RobotCommand = RobotCommand.STOP

        # Targets list
        self.targets: List[SimTarget] = []
        self.reset()

    def reset(self) -> None:
        """Reset simulator environment state."""
        self.robot_x = self.width / 2.0
        self.robot_y = self.height - 120.0
        self.robot_heading = 0.0
        self.robot_linear_speed = 0.0
        self.robot_angular_speed = 0.0
        self.current_command = RobotCommand.STOP

        self.targets = [
            SimTarget(1, "Joao", 320, 240, 2.5, 1.2, 70, 160, (0, 229, 255)),
            SimTarget(2, "Gustavo", 850, 320, -2.0, 1.5, 68, 155, (255, 152, 0)),
            SimTarget(3, "Renato", 580, 180, 1.6, -1.8, 72, 165, (76, 175, 80)),
        ]

    def send_robot_command(self, command: RobotCommand) -> None:
        """Apply a movement command to the simulated robot."""
        self.current_command = command
        max_speed = 4.5
        turn_speed = 4.0

        if command == RobotCommand.FORWARD:
            self.robot_linear_speed = max_speed
            self.robot_angular_speed = 0.0
        elif command == RobotCommand.REVERSE:
            self.robot_linear_speed = -max_speed * 0.7
            self.robot_angular_speed = 0.0
        elif command == RobotCommand.LEFT:
            self.robot_linear_speed = max_speed * 0.4
            self.robot_angular_speed = -turn_speed
        elif command == RobotCommand.RIGHT:
            self.robot_linear_speed = max_speed * 0.4
            self.robot_angular_speed = turn_speed
        elif command == RobotCommand.STOP:
            self.robot_linear_speed = 0.0
            self.robot_angular_speed = 0.0

    def force_occlusion(self, target_id: Optional[int] = None, duration: float = 4.0) -> None:
        """Trigger occlusion on a specific target or random target to test Ghost Mode."""
        now = time.time()
        for target in self.targets:
            if target_id is None or target.track_id == target_id:
                target.is_occluded = True
                target.hidden_until = now + duration
                target.ghost_start_time = now
                target.last_known_x = target.x
                target.last_known_y = target.y
                target.last_known_vx = target.vx
                target.last_known_vy = target.vy
                if target_id is not None:
                    break

    def step(self) -> Tuple[np.ndarray, List[Detection], Dict[int, Tuple[float, float, float, float]]]:
        """Advance simulator by 1 frame.

        Returns:
            - frame: Drawn BGR image representing visual frame or arena
            - detections: List of visible target detections
            - ghost_predictions: Dict of target_id -> (pred_x, pred_y, pred_vx, pred_vy)
        """
        now = time.time()

        # Update Robot position
        self.robot_heading = (self.robot_heading + self.robot_angular_speed) % 360.0
        rad = math.radians(self.robot_heading - 90.0)  # 0 deg = straight up
        self.robot_x += self.robot_linear_speed * math.cos(rad)
        self.robot_y += self.robot_linear_speed * math.sin(rad)

        # Keep robot inside boundaries
        self.robot_x = max(60, min(self.width - 60, self.robot_x))
        self.robot_y = max(60, min(self.height - 60, self.robot_y))

        detections: List[Detection] = []
        ghost_predictions: Dict[int, Tuple[float, float, float, float]] = {}

        # Render Canvas
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        self._draw_arena_background(frame)

        for target in self.targets:
            # Move target in 2D space
            target.x += target.vx
            target.y += target.vy

            # Bounce off arena boundaries
            if target.x < 50 or target.x + target.width > self.width - 50:
                target.vx *= -1
            if target.y < 50 or target.y + target.height > self.height - 50:
                target.vy *= -1

            # Check if occlusion expired
            if target.is_occluded and now >= target.hidden_until:
                target.is_occluded = False

            if not target.is_occluded:
                # Target is VISIBLE -> emit detection
                target.last_known_x = target.x
                target.last_known_y = target.y
                target.last_known_vx = target.vx
                target.last_known_vy = target.vy

                bbox = BoundingBox(target.x, target.y, target.x + target.width, target.y + target.height)
                detections.append(
                    Detection(
                        bbox=bbox,
                        confidence=0.95,
                        track_id=target.track_id,
                        identity_hint=target.name,
                    )
                )

                self._draw_visible_target(frame, target)
            else:
                # Target is OCCLUDED -> Ghost mode motion prediction (Kalman trajectory)
                dt = now - target.ghost_start_time
                pred_x = target.last_known_x + target.last_known_vx * (dt * 30.0)
                pred_y = target.last_known_y + target.last_known_vy * (dt * 30.0)
                ghost_predictions[target.track_id] = (pred_x, pred_y, target.last_known_vx, target.last_known_vy)

                self._draw_ghost_target(frame, target, pred_x, pred_y)

        # Draw Simulated Robot
        self._draw_robot(frame)

        # Draw Global HUD / Telemetry Overlay on Canvas
        self._draw_hud_overlay(frame)

        return frame, detections, ghost_predictions

    def _draw_arena_background(self, frame: np.ndarray) -> None:
        """Draw a tactical cyberpunk grid background."""
        frame[:] = (6, 12, 20)  # Dark navy blue
        if cv2 is None:
            return

        # Grid lines
        grid_size = 50
        grid_color = (18, 38, 55)
        for x in range(0, self.width, grid_size):
            cv2.line(frame, (x, 0), (x, self.height), grid_color, 1)
        for y in range(0, self.height, grid_size):
            cv2.line(frame, (0, y), (self.width, y), grid_color, 1)

        # Radar Rings around arena center
        cx, cy = self.width // 2, self.height // 2
        cv2.circle(frame, (cx, cy), 150, (15, 45, 65), 1)
        cv2.circle(frame, (cx, cy), 300, (15, 45, 65), 1)
        cv2.circle(frame, (cx, cy), 450, (15, 45, 65), 1)

    def _draw_robot(self, frame: np.ndarray) -> None:
        """Draw the 2D Robot entity with orientation vector, compass ring, and status glow."""
        rx, ry = int(self.robot_x), int(self.robot_y)
        w, h = self.robot_width, self.robot_height

        if cv2 is None:
            return

        # Outer Radar Ring around Robot
        cv2.circle(frame, (rx, ry), 50, (0, 120, 160), 1, cv2.LINE_AA)
        cv2.circle(frame, (rx, ry), 52, (0, 229, 255), 1, cv2.LINE_AA)

        # Create rotated rect for robot chassi
        angle_rad = math.radians(self.robot_heading)
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)

        corners = [
            (-w / 2, -h / 2),
            (w / 2, -h / 2),
            (w / 2, h / 2),
            (-w / 2, h / 2),
        ]

        rotated_pts = []
        for cx, cy in corners:
            nx = rx + (cx * cos_a - cy * sin_a)
            ny = ry + (cx * sin_a + cy * cos_a)
            rotated_pts.append((int(nx), int(ny)))

        pts_array = np.array(rotated_pts, np.int32).reshape((-1, 1, 2))

        # Fill Robot Body
        cv2.fillPoly(frame, [pts_array], (0, 140, 200))
        cv2.polylines(frame, [pts_array], True, (0, 229, 255), 2, cv2.LINE_AA)

        # Direction Heading Arrow
        arrow_len = 65
        heading_rad = math.radians(self.robot_heading - 90)
        ax = int(rx + arrow_len * math.cos(heading_rad))
        ay = int(ry + arrow_len * math.sin(heading_rad))
        cv2.arrowedLine(frame, (rx, ry), (ax, ay), (0, 255, 255), 3, tipLength=0.28)

        # Robot Tag
        cmd_str = self.current_command.value if isinstance(self.current_command, RobotCommand) else str(self.current_command)
        cv2.putText(frame, "ROBO [ESP32]", (rx - 45, ry + h // 2 + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 229, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, f"CMD: {cmd_str}", (rx - 45, ry + h // 2 + 35), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (180, 220, 255), 1, cv2.LINE_AA)


    def _draw_visible_target(self, frame: np.ndarray, target: SimTarget) -> None:
        """Draw visible target bounding box, heading vector, and specs."""
        if cv2 is None:
            return

        x, y = int(target.x), int(target.y)
        w, h = target.width, target.height

        # Solid Bounding Box
        cv2.rectangle(frame, (x, y), (x + w, y + h), target.color, 2)
        cv2.circle(frame, (x + w // 2, y + 25), 16, target.color, -1)

        # Distance & Velocity vectors
        speed = math.hypot(target.vx, target.vy) * 10.0  # px/s equivalent
        dx = (target.x + w / 2) - self.robot_x
        dy = (target.y + h / 2) - self.robot_y
        dist_px = math.hypot(dx, dy)
        dist_m = dist_px / 100.0  # scale: 100 px = 1 meter

        # Velocity Arrow
        vx_end = int(target.x + w / 2 + target.vx * 15.0)
        vy_end = int(target.y + h / 2 + target.vy * 15.0)
        cv2.arrowedLine(frame, (int(target.x + w / 2), int(target.y + h / 2)), (vx_end, vy_end), (255, 255, 255), 2)

        # Direct line from robot to target
        cv2.line(frame, (int(self.robot_x), int(self.robot_y)), (int(target.x + w / 2), int(target.y + h / 2)), (0, 180, 255), 1, cv2.LINE_AA)

        # Label Header
        label_text = f"ID {target.track_id}: {target.name}"
        cv2.putText(frame, label_text, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1)

        # Spec sub-text
        cv2.putText(frame, f"Dist: {dist_m:.2f}m", (x, y + h + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 200), 1)
        cv2.putText(frame, f"Vel: {speed:.1f}px/s", (x, y + h + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 220, 255), 1)

    def _draw_ghost_target(self, frame: np.ndarray, target: SimTarget, pred_x: float, pred_y: float) -> None:
        """Draw dashed bounding box and prediction trajectory arrow for ghost mode."""
        if cv2 is None:
            return

        x, y = int(pred_x), int(pred_y)
        w, h = target.width, target.height
        ghost_color = (0, 165, 255)  # Orange Neon for Ghost

        # Draw Dashed Rectangle
        self._draw_dashed_rect(frame, (x, y), (x + w, y + h), ghost_color, thickness=2, dash_len=8)

        # Target Icon Outline inside ghost box
        cv2.circle(frame, (x + w // 2, y + 25), 14, ghost_color, 1)

        # Predicted Direction Arrow
        px_end = int(x + w / 2 + target.last_known_vx * 25.0)
        py_end = int(y + h / 2 + target.last_known_vy * 25.0)
        cv2.arrowedLine(frame, (int(x + w / 2), int(y + h / 2)), (px_end, py_end), ghost_color, 2, tipLength=0.3)

        # Dashed line connecting last known position to ghost prediction
        self._draw_dashed_line(
            frame,
            (int(target.last_known_x + w / 2), int(target.last_known_y + h / 2)),
            (int(x + w / 2), int(y + h / 2)),
            (0, 140, 255),
            1,
            6,
        )

        # Text Overlay
        cv2.putText(frame, f"GHOST PREDICTOR (ID {target.track_id})", (x - 10, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.48, ghost_color, 1)
        cv2.putText(frame, "STATUS: PREDIÇÃO MOVIMENTO", (x - 10, y + h + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (0, 200, 255), 1)

    def _draw_dashed_rect(self, img: np.ndarray, pt1: Tuple[int, int], pt2: Tuple[int, int], color: Tuple[int, int, int], thickness: int = 1, dash_len: int = 10) -> None:
        """Helper to draw a dashed rectangle."""
        x1, y1 = pt1
        x2, y2 = pt2

        self._draw_dashed_line(img, (x1, y1), (x2, y1), color, thickness, dash_len)
        self._draw_dashed_line(img, (x2, y1), (x2, y2), color, thickness, dash_len)
        self._draw_dashed_line(img, (x2, y2), (x1, y2), color, thickness, dash_len)
        self._draw_dashed_line(img, (x1, y2), (x1, y1), color, thickness, dash_len)

    def _draw_dashed_line(self, img: np.ndarray, pt1: Tuple[int, int], pt2: Tuple[int, int], color: Tuple[int, int, int], thickness: int = 1, dash_len: int = 10) -> None:
        """Helper to draw a dashed line."""
        dist = math.hypot(pt2[0] - pt1[0], pt2[1] - pt1[1])
        if dist == 0:
            return

        dashes = int(dist / dash_len)
        for i in range(0, dashes, 2):
            start = (
                int(pt1[0] + (pt2[0] - pt1[0]) * (i / dashes)),
                int(pt1[1] + (pt2[1] - pt1[1]) * (i / dashes)),
            )
            end = (
                int(pt1[0] + (pt2[0] - pt1[0]) * ((i + 1) / dashes)),
                int(pt1[1] + (pt2[1] - pt1[1]) * ((i + 1) / dashes)),
            )
            cv2.line(img, start, end, color, thickness)

    def _draw_hud_overlay(self, frame: np.ndarray) -> None:
        """Draw overlay title and system legend."""
        if cv2 is None:
            return

        cv2.putText(frame, "SIMULADOR VISUAL 2D - QUANTUM TRACKER", (24, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.70, (0, 229, 255), 2)
        cv2.putText(frame, f"DIR ROBÔ: {self.robot_heading:.1f}° | VEL: {self.robot_linear_speed:.1f}px/f", (24, 62), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (160, 210, 240), 1)

        legend_y = self.height - 30
        cv2.putText(frame, "[VALORES ALVO] SOLIDO: VISIVEL | TRACEJADO (ORANGE): GHOST MODE", (24, legend_y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (180, 200, 220), 1)
