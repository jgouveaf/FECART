from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Optional

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from core.models import SystemSnapshot, TargetState, TrackedTarget


# Gesture → portuguese label map for HUD display
_GESTURE_LABELS: dict[str, tuple[str, str]] = {
    "VIRAR_DIREITA": ("→ DIREITA", "right"),
    "VIRAR_ESQUERDA": ("← ESQUERDA", "left"),
    "PARAR": ("■ PARAR", "stop"),
    "SEGUIR": ("▲ SEGUIR", "up"),
    "RE": ("▼ RÉ", "down"),
}


class TacticalHUD:
    """OpenCV futuristic HUD renderer."""

    def __init__(self) -> None:
        self._gesture_anim = 0.0  # animation phase 0..1
        self._gesture_ts = 0.0

    def draw(self, frame: np.ndarray, snapshot: SystemSnapshot) -> np.ndarray:
        if cv2 is None:
            return frame
        canvas = frame.copy()
        h, w = canvas.shape[:2]

        # Scanline vignette overlay for cinematic feel
        self._vignette(canvas)

        self._panel(canvas, 14, 14, 310, 130)
        self._panel(canvas, w - 340, 14, 326, 180)
        self._crosshair(canvas, w // 2, h // 2)

        # ── Left panel ──────────────────────────────────────────────
        self._text(canvas, f"FPS  {snapshot.fps:05.1f}", (28, 50), 0.60, (0, 240, 255), bold=True)
        self._text(canvas, f"ALVOS  {len(snapshot.targets):02d}", (28, 80), 0.58, (180, 255, 240))
        self._text(canvas, snapshot.system_status, (28, 110), 0.55, (80, 255, 140))
        ts = datetime.now().strftime("%H:%M:%S")
        self._text(canvas, ts, (28, 138), 0.50, (100, 200, 255))

        # ── Right panel ──────────────────────────────────────────────
        self._text(canvas, "EVENTOS RECENTES", (w - 325, 50), 0.46, (0, 240, 255), bold=True)
        for idx, log in enumerate(snapshot.recent_logs[:5]):
            text = f"{log.event[:18]}  ID:{log.track_id or '-'}"
            self._text(canvas, text, (w - 325, 78 + idx * 22), 0.40, (160, 220, 230))

        # ── Target boxes ─────────────────────────────────────────────
        for target in snapshot.targets:
            self._target(canvas, target)

        # ── Gesture indicator ─────────────────────────────────────────
        if snapshot.active_gesture:
            now = time.time()
            if snapshot.active_gesture != getattr(self, "_last_gesture", None):
                self._last_gesture = snapshot.active_gesture
                self._gesture_ts = now
            elapsed = now - self._gesture_ts
            if elapsed < 2.5:
                self._draw_gesture_indicator(canvas, snapshot.active_gesture, elapsed, w, h)

        return canvas

    # ──────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────

    def _draw_gesture_indicator(
        self, canvas: np.ndarray, command: str, elapsed: float, w: int, h: int
    ) -> None:
        """Draw an animated arrow + label for the detected gesture."""
        label, direction = _GESTURE_LABELS.get(command, (command, "stop"))

        # Fade alpha 0→1→0 over 2.5 s
        alpha = min(1.0, elapsed / 0.3) * max(0.0, 1.0 - (elapsed - 1.8) / 0.7)
        color_base = (0, 220, 255)
        color = tuple(int(c * alpha) for c in color_base)
        text_color = tuple(int(c * alpha) for c in (255, 255, 255))

        cx = w // 2
        cy = h - 130

        # Background pill
        overlay = canvas.copy()
        cv2.rectangle(overlay, (cx - 200, cy - 55), (cx + 200, cy + 65), (5, 20, 35), -1)
        cv2.addWeighted(overlay, 0.70 * alpha, canvas, 1.0 - 0.70 * alpha, 0, canvas)
        cv2.rectangle(canvas, (cx - 200, cy - 55), (cx + 200, cy + 65), color, 2)

        # Arrow / icon drawn with OpenCV lines + circles
        scale = 1.0 + 0.08 * math.sin(elapsed * 8)  # subtle pulse
        r = int(28 * scale)

        if direction == "right":
            self._draw_arrow(canvas, cx, cy - 12, "right", r, color)
        elif direction == "left":
            self._draw_arrow(canvas, cx, cy - 12, "left", r, color)
        elif direction == "up":
            self._draw_arrow(canvas, cx, cy - 12, "up", r, color)
        elif direction == "down":
            self._draw_arrow(canvas, cx, cy - 12, "down", r, color)
        else:
            # STOP: glowing square
            cv2.rectangle(canvas, (cx - r, cy - 12 - r), (cx + r, cy - 12 + r), color, 3)

        # Label text
        font = cv2.FONT_HERSHEY_SIMPLEX
        ts, _ = cv2.getTextSize(label, font, 0.72, 2)
        tx = cx - ts[0] // 2
        cv2.putText(canvas, label, (tx, cy + 48), font, 0.72, text_color, 2, cv2.LINE_AA)

    def _draw_arrow(
        self, canvas: np.ndarray, cx: int, cy: int, direction: str, r: int, color: tuple
    ) -> None:
        """Draw a clean directional arrow."""
        thick = 3
        if direction == "right":
            pts = np.array([[cx - r, cy], [cx + r, cy]], np.int32)
            cv2.polylines(canvas, [pts], False, color, thick, cv2.LINE_AA)
            head = np.array([[cx + r, cy], [cx + r - 14, cy - 10], [cx + r - 14, cy + 10]], np.int32)
            cv2.fillPoly(canvas, [head], color)
        elif direction == "left":
            pts = np.array([[cx + r, cy], [cx - r, cy]], np.int32)
            cv2.polylines(canvas, [pts], False, color, thick, cv2.LINE_AA)
            head = np.array([[cx - r, cy], [cx - r + 14, cy - 10], [cx - r + 14, cy + 10]], np.int32)
            cv2.fillPoly(canvas, [head], color)
        elif direction == "up":
            pts = np.array([[cx, cy + r], [cx, cy - r]], np.int32)
            cv2.polylines(canvas, [pts], False, color, thick, cv2.LINE_AA)
            head = np.array([[cx, cy - r], [cx - 10, cy - r + 14], [cx + 10, cy - r + 14]], np.int32)
            cv2.fillPoly(canvas, [head], color)
        elif direction == "down":
            pts = np.array([[cx, cy - r], [cx, cy + r]], np.int32)
            cv2.polylines(canvas, [pts], False, color, thick, cv2.LINE_AA)
            head = np.array([[cx, cy + r], [cx - 10, cy + r - 14], [cx + 10, cy + r - 14]], np.int32)
            cv2.fillPoly(canvas, [head], color)

    def _target(self, canvas: np.ndarray, target: TrackedTarget) -> None:
        x1, y1, x2, y2 = map(int, (target.bbox.x1, target.bbox.y1, target.bbox.x2, target.bbox.y2))
        color = self._state_color(target.state)
        thickness = 1 if target.state == TargetState.GHOST else 2

        # Corner brackets instead of full box (modern look)
        seg = 20
        for (px, py), (dx, dy) in [
            ((x1, y1), (1, 1)),
            ((x2, y1), (-1, 1)),
            ((x1, y2), (1, -1)),
            ((x2, y2), (-1, -1)),
        ]:
            cv2.line(canvas, (px, py), (px + dx * seg, py), color, thickness)
            cv2.line(canvas, (px, py), (px, py + dy * seg), color, thickness)

        cx, cy = map(int, target.bbox.center)
        cv2.circle(canvas, (cx, cy), 3, color, -1)
        if target.state == TargetState.GHOST:
            cv2.circle(canvas, (cx, cy), int(max(18, target.uncertainty)), color, 1)

        name = target.name or "UNKNOWN"
        label = f"ID {target.track_id}  {name}  {target.state.value}"
        cv2.putText(canvas, label, (x1, max(22, y1 - 14)), cv2.FONT_HERSHEY_SIMPLEX, 0.46, color, 1, cv2.LINE_AA)
        cv2.putText(
            canvas,
            f"CONF {target.confidence:.2f}  DIST {target.distance_estimate:.2f}",
            (x1, y2 + 18),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.40,
            color,
            1,
            cv2.LINE_AA,
        )

    def _panel(self, canvas: np.ndarray, x: int, y: int, w: int, h: int) -> None:
        overlay = canvas.copy()
        cv2.rectangle(overlay, (x, y), (x + w, y + h), (4, 14, 26), -1)
        cv2.addWeighted(overlay, 0.65, canvas, 0.35, 0, canvas)
        cv2.rectangle(canvas, (x, y), (x + w, y + h), (0, 200, 255), 1)
        # top accent line
        cv2.line(canvas, (x + 8, y), (x + 60, y), (0, 220, 255), 2)

    def _crosshair(self, canvas: np.ndarray, cx: int, cy: int) -> None:
        color = (0, 200, 255)
        cv2.line(canvas, (cx - 30, cy), (cx - 8, cy), color, 1)
        cv2.line(canvas, (cx + 8, cy), (cx + 30, cy), color, 1)
        cv2.line(canvas, (cx, cy - 30), (cx, cy - 8), color, 1)
        cv2.line(canvas, (cx, cy + 8), (cx, cy + 30), color, 1)
        cv2.circle(canvas, (cx, cy), 36, color, 1)
        cv2.circle(canvas, (cx, cy), 3, color, -1)

    def _vignette(self, canvas: np.ndarray) -> None:
        """Subtle dark corners vignette for cinematic feel."""
        h, w = canvas.shape[:2]
        overlay = np.zeros_like(canvas)
        for i in range(60):
            alpha = int(80 * (1 - i / 60))
            cv2.rectangle(overlay, (i, i), (w - i, h - i), (0, 0, 0), 1)
        cv2.addWeighted(overlay, 0.5, canvas, 1.0, 0, canvas)

    def _text(
        self,
        canvas: np.ndarray,
        text: str,
        pos: tuple,
        scale: float,
        color: tuple,
        bold: bool = False,
    ) -> None:
        thick = 2 if bold else 1
        cv2.putText(canvas, text, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick, cv2.LINE_AA)

    def _state_color(self, state: TargetState) -> tuple[int, int, int]:
        if state == TargetState.VISIBLE:
            return (60, 255, 120)
        if state == TargetState.LOST:
            return (0, 200, 255)
        if state == TargetState.GHOST:
            return (0, 140, 255)
        return (160, 160, 160)
