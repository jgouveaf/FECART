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


# Gesture -> portuguese label map for HUD display (Monochrome)
_GESTURE_LABELS: dict[str, tuple[str, str]] = {
    "VIRAR_DIREITA": ("→ VIRAR DIREITA", "right"),
    "VIRAR_ESQUERDA": ("← VIRAR ESQUERDA", "left"),
    "PARAR": ("■ PARAR MOVIMENTO", "stop"),
    "SEGUIR": ("▲ SEGUIR ALVO", "up"),
    "RE": ("▼ MARCHAR RÉ", "down"),
}


class TacticalHUD:
    """OpenCV premium monochrome/industrial viewfinder style HUD renderer."""

    def __init__(self) -> None:
        self._gesture_anim = 0.0
        self._gesture_ts = 0.0
        self._last_gesture: Optional[str] = None

    def draw(self, frame: np.ndarray, snapshot: SystemSnapshot) -> np.ndarray:
        if cv2 is None or frame is None:
            return frame

        canvas = frame.copy()
        h, w = canvas.shape[:2]

        # Scanline vignette overlay for cinematic depth
        self._vignette(canvas)

        # Draw Corner Tech Borders (Monochrome)
        self._draw_corner_tech_accents(canvas, w, h)

        # Render Left & Right Panels
        self._panel(canvas, 16, 16, 320, 138, title="SISTEMA // MONITORAÇÃO")
        self._panel(canvas, w - 346, 16, 330, 185, title="INTEL // LOGS RECENTES")
        self._crosshair(canvas, w // 2, h // 2)

        # ── Left Panel Info ──
        self._text(canvas, f"FPS:   {snapshot.fps:05.1f}", (32, 54), 0.54, (255, 255, 255), bold=True)
        
        # Target status counter pill
        vis_count = sum(1 for t in snapshot.targets if t.state == TargetState.VISIBLE)
        ghost_count = sum(1 for t in snapshot.targets if t.state in (TargetState.GHOST, TargetState.OCCLUDED))
        self._text(canvas, f"ALVOS: {len(snapshot.targets):02d}  (ATV:{vis_count}  GHOST:{ghost_count})", (32, 80), 0.46, (200, 200, 200))
        
        self._text(canvas, f"MODO:  {snapshot.system_status.replace('YOLOv8', 'YOLO').replace('ByteTrack', 'Byte')}", (32, 106), 0.46, (255, 255, 255), bold=True)
        
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        self._text(canvas, f"HORA:  {ts}", (32, 132), 0.42, (160, 160, 160))

        # ── Right Panel Event Feed ──
        for idx, log in enumerate(snapshot.recent_logs[:5]):
            log_str = str(getattr(log, "event", log))
            evt_text = log_str[:22].upper()
            track_id = str(getattr(log, "track_id", "-"))
            display_line = f"• {evt_text:<22} [ID:{track_id}]"
            self._text(canvas, display_line, (w - 330, 52 + idx * 24), 0.40, (200, 200, 200))

        # ── Target Bounding Boxes ──
        for target in snapshot.targets:
            self._target(canvas, target)

        # ── Gesture Overlay ──
        if snapshot.active_gesture:
            now = time.time()
            if snapshot.active_gesture != self._last_gesture:
                self._last_gesture = snapshot.active_gesture
                self._gesture_ts = now
            elapsed = now - self._gesture_ts
            if elapsed < 2.5:
                self._draw_gesture_indicator(canvas, snapshot.active_gesture, elapsed, w, h)

        return canvas

    def _draw_corner_tech_accents(self, canvas: np.ndarray, w: int, h: int) -> None:
        """Draw sleek minimalist frame accents at screen boundary corners."""
        color = (255, 255, 255)
        length = 30
        thick = 1
        # Top-Left
        cv2.line(canvas, (10, 10), (10 + length, 10), color, thick, cv2.LINE_AA)
        cv2.line(canvas, (10, 10), (10, 10 + length), color, thick, cv2.LINE_AA)
        # Top-Right
        cv2.line(canvas, (w - 10, 10), (w - 10 - length, 10), color, thick, cv2.LINE_AA)
        cv2.line(canvas, (w - 10, 10), (w - 10, 10 + length), color, thick, cv2.LINE_AA)
        # Bottom-Left
        cv2.line(canvas, (10, h - 10), (10 + length, h - 10), color, thick, cv2.LINE_AA)
        cv2.line(canvas, (10, h - 10), (10, h - 10 - length), color, thick, cv2.LINE_AA)
        # Bottom-Right
        cv2.line(canvas, (w - 10, h - 10), (w - 10 - length, h - 10), color, thick, cv2.LINE_AA)
        cv2.line(canvas, (w - 10, h - 10), (w - 10, h - 10 - length), color, thick, cv2.LINE_AA)

    def _draw_gesture_indicator(
        self, canvas: np.ndarray, command: str, elapsed: float, w: int, h: int
    ) -> None:
        """Draw an animated minimalist monochrome gesture action pill."""
        label, direction = _GESTURE_LABELS.get(command, (command, "stop"))

        alpha = min(1.0, elapsed / 0.25) * max(0.0, 1.0 - (elapsed - 1.8) / 0.7)
        color = (int(255 * alpha), int(255 * alpha), int(255 * alpha))
        text_color = tuple(int(c * alpha) for c in (255, 255, 255))

        cx = w // 2
        cy = h - 110

        overlay = canvas.copy()
        cv2.rectangle(overlay, (cx - 210, cy - 45), (cx + 210, cy + 45), (10, 10, 10), -1)
        cv2.addWeighted(overlay, 0.85 * alpha, canvas, 1.0 - 0.85 * alpha, 0, canvas)
        cv2.rectangle(canvas, (cx - 210, cy - 45), (cx + 210, cy + 45), color, 1, cv2.LINE_AA)

        # Header tag line
        cv2.putText(canvas, "GESTO RECONHECIDO // OPERADOR", (cx - 130, cy - 25), cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA)

        scale = 1.0 + 0.05 * math.sin(elapsed * 9)
        r = int(22 * scale)

        if direction == "right":
            self._draw_arrow(canvas, cx - 140, cy + 12, "right", r, color)
        elif direction == "left":
            self._draw_arrow(canvas, cx - 140, cy + 12, "left", r, color)
        elif direction == "up":
            self._draw_arrow(canvas, cx - 140, cy + 12, "up", r, color)
        elif direction == "down":
            self._draw_arrow(canvas, cx - 140, cy + 12, "down", r, color)
        else:
            cv2.rectangle(canvas, (cx - 140 - r, cy + 12 - r), (cx - 140 + r, cy + 12 + r), color, 2, cv2.LINE_AA)

        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(canvas, label, (cx - 100, cy + 18), font, 0.60, text_color, 1, cv2.LINE_AA)

    def _draw_arrow(
        self, canvas: np.ndarray, cx: int, cy: int, direction: str, r: int, color: tuple
    ) -> None:
        thick = 2
        if direction == "right":
            pts = np.array([[cx - r, cy], [cx + r, cy]], np.int32)
            cv2.polylines(canvas, [pts], False, color, thick, cv2.LINE_AA)
            head = np.array([[cx + r, cy], [cx + r - 12, cy - 8], [cx + r - 12, cy + 8]], np.int32)
            cv2.fillPoly(canvas, [head], color)
        elif direction == "left":
            pts = np.array([[cx + r, cy], [cx - r, cy]], np.int32)
            cv2.polylines(canvas, [pts], False, color, thick, cv2.LINE_AA)
            head = np.array([[cx - r, cy], [cx - r + 12, cy - 8], [cx - r + 12, cy + 8]], np.int32)
            cv2.fillPoly(canvas, [head], color)
        elif direction == "up":
            pts = np.array([[cx, cy + r], [cx, cy - r]], np.int32)
            cv2.polylines(canvas, [pts], False, color, thick, cv2.LINE_AA)
            head = np.array([[cx, cy - r], [cx - 8, cy - r + 12], [cx + 8, cy - r + 12]], np.int32)
            cv2.fillPoly(canvas, [head], color)
        elif direction == "down":
            pts = np.array([[cx, cy - r], [cx, cy + r]], np.int32)
            cv2.polylines(canvas, [pts], False, color, thick, cv2.LINE_AA)
            head = np.array([[cx, cy + r], [cx - 8, cy + r - 12], [cx + 8, cy + r - 12]], np.int32)
            cv2.fillPoly(canvas, [head], color)

    def _target(self, canvas: np.ndarray, target: TrackedTarget) -> None:
        x1, y1, x2, y2 = map(int, (target.bbox.x1, target.bbox.y1, target.bbox.x2, target.bbox.y2))
        color = self._state_color(target.state)

        if target.state == TargetState.GHOST:
            # Dashed corner brackets for Ghost
            self._draw_ghost_brackets(canvas, x1, y1, x2, y2, color)
        else:
            # Solid monochrome corner brackets
            seg = 20
            thick = 1
            for (px, py), (dx, dy) in [
                ((x1, y1), (1, 1)),
                ((x2, y1), (-1, 1)),
                ((x1, y2), (1, -1)),
                ((x2, y2), (-1, -1)),
            ]:
                cv2.line(canvas, (px, py), (px + dx * seg, py), color, thick, cv2.LINE_AA)
                cv2.line(canvas, (px, py), (px, py + dy * seg), color, thick, cv2.LINE_AA)

        cx, cy = map(int, target.bbox.center)
        cv2.circle(canvas, (cx, cy), 3, color, -1, cv2.LINE_AA)

        if target.state == TargetState.GHOST:
            cv2.circle(canvas, (cx, cy), int(max(20, target.uncertainty)), color, 1, cv2.LINE_AA)

        name = target.name or "ALVO"
        lbl_state = target.state.value
        head_tag = f"ID:{target.track_id} | {name} [{lbl_state}]"
        
        # Text background badge
        badge_y = max(24, y1 - 12)
        font = cv2.FONT_HERSHEY_SIMPLEX
        ts, _ = cv2.getTextSize(head_tag, font, 0.40, 1)
        
        overlay = canvas.copy()
        cv2.rectangle(overlay, (x1, badge_y - ts[1] - 4), (x1 + ts[0] + 10, badge_y + 4), (10, 10, 10), -1)
        cv2.addWeighted(overlay, 0.85, canvas, 0.15, 0, canvas)
        cv2.rectangle(canvas, (x1, badge_y - ts[1] - 4), (x1 + ts[0] + 10, badge_y + 4), color, 1, cv2.LINE_AA)
        
        cv2.putText(canvas, head_tag, (x1 + 5, badge_y), font, 0.40, color, 1, cv2.LINE_AA)
        
        sub_tag = f"CONF: {target.confidence:.0%}  |  DIST: {target.distance_estimate:.1f}m  |  VEL: {target.speed:.1f}px/f"
        cv2.putText(canvas, sub_tag, (x1, y2 + 18), font, 0.36, (220, 220, 220), 1, cv2.LINE_AA)

    def _draw_ghost_brackets(self, canvas: np.ndarray, x1: int, y1: int, x2: int, y2: int, color: tuple) -> None:
        """Draw dashed corner brackets for lost/ghost target."""
        seg = 18
        dash = 5
        thick = 1

        for (px, py), (dx, dy) in [
            ((x1, y1), (1, 1)),
            ((x2, y1), (-1, 1)),
            ((x1, y2), (1, -1)),
            ((x2, y2), (-1, -1)),
        ]:
            # Horizontal segment
            for s in range(0, seg, dash * 2):
                end_s = min(s + dash, seg)
                cv2.line(canvas, (px + dx * s, py), (px + dx * end_s, py), color, thick, cv2.LINE_AA)
            # Vertical segment
            for s in range(0, seg, dash * 2):
                end_s = min(s + dash, seg)
                cv2.line(canvas, (px, py + dy * s), (px, py + dy * end_s), color, thick, cv2.LINE_AA)

    def _panel(self, canvas: np.ndarray, x: int, y: int, w: int, h: int, title: str = "") -> None:
        overlay = canvas.copy()
        cv2.rectangle(overlay, (x, y), (x + w, y + h), (10, 10, 10), -1)
        cv2.addWeighted(overlay, 0.85, canvas, 0.15, 0, canvas)
        
        cv2.rectangle(canvas, (x, y), (x + w, y + h), (100, 100, 100), 1, cv2.LINE_AA)
        # Top white/gray accent header bar
        cv2.line(canvas, (x, y), (x + w, y), (255, 255, 255), 2, cv2.LINE_AA)
        
        if title:
            font = cv2.FONT_HERSHEY_SIMPLEX
            cv2.putText(canvas, title, (x + 10, y + 18), font, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.line(canvas, (x + 8, y + 24), (x + w - 8, y + 24), (40, 40, 40), 1, cv2.LINE_AA)

    def _crosshair(self, canvas: np.ndarray, cx: int, cy: int) -> None:
        color = (200, 200, 200)
        cv2.line(canvas, (cx - 25, cy), (cx - 6, cy), color, 1, cv2.LINE_AA)
        cv2.line(canvas, (cx + 6, cy), (cx + 25, cy), color, 1, cv2.LINE_AA)
        cv2.line(canvas, (cx, cy - 25), (cx, cy - 6), color, 1, cv2.LINE_AA)
        cv2.line(canvas, (cx, cy + 6), (cx, cy + 25), color, 1, cv2.LINE_AA)
        cv2.circle(canvas, (cx, cy), 32, (80, 80, 80), 1, cv2.LINE_AA)
        cv2.circle(canvas, (cx, cy), 2, color, -1, cv2.LINE_AA)

    def _vignette(self, canvas: np.ndarray) -> None:
        h, w = canvas.shape[:2]
        overlay = np.zeros_like(canvas)
        for i in range(50):
            alpha = int(70 * (1 - i / 50))
            cv2.rectangle(overlay, (i, i), (w - i, h - i), (0, 0, 0), 1)
        cv2.addWeighted(overlay, 0.45, canvas, 1.0, 0, canvas)

    def _text(
        self,
        canvas: np.ndarray,
        text: str,
        pos: tuple,
        scale: float,
        color: tuple,
        bold: bool = False,
    ) -> None:
        thick = 1 if not bold else 2
        cv2.putText(canvas, text, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick, cv2.LINE_AA)

    def _state_color(self, state: TargetState) -> tuple[int, int, int]:
        if state == TargetState.VISIBLE:
            return (255, 255, 255) # Pure White
        if state == TargetState.GHOST:
            return (180, 180, 180) # Light Gray
        if state == TargetState.LOST:
            return (80, 80, 80)    # Dark Gray
        if state == TargetState.OCCLUDED:
            return (140, 140, 140) # Medium Gray
        return (100, 100, 100)
