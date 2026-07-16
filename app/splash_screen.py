"""Animated splash screen for Quantum Tracker - Premium Monochrome Design."""
from __future__ import annotations

import math
import time

from PySide6.QtCore import Qt, QTimer, QPointF
from PySide6.QtGui import (
    QColor, QFont, QFontMetrics, QPainter, QPixmap,
    QRadialGradient, QLinearGradient, QPen, QBrush,
)
from PySide6.QtWidgets import QSplashScreen


class QuantumSplash(QSplashScreen):
    """Animated premium minimalist black and white splash screen."""

    _AUTHORS = "FEITO POR: JOÃO · GUSTAVO · RENATO"
    _TITLE = "QUANTUM TRACKER"
    _SUBTITLE = "SISTEMA DE RASTREAMENTO E TELEMETRIA DE ALVOS"
    _W, _H = 680, 420

    def __init__(self) -> None:
        pix = QPixmap(self._W, self._H)
        pix.fill(QColor("#000000"))
        super().__init__(pix, Qt.WindowStaysOnTopHint)
        self.setWindowFlag(Qt.FramelessWindowHint)

        self._t0 = time.time()
        self._duration = 3.0  # 3 seconds duration
        self._progress = 0.0
        self._particles: list[dict] = self._make_particles(50)

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)
        self._timer.start(30)  # ~33 fps refresh rate

    def set_progress(self, pct: float) -> None:
        """Update loading bar 0.0 -> 1.0."""
        self._progress = max(0.0, min(1.0, pct))

    def _tick(self) -> None:
        elapsed = time.time() - self._t0
        self._progress = min(1.0, elapsed / self._duration)
        self.repaint()

    def drawContents(self, painter: QPainter) -> None:  # noqa: N802
        t = time.time() - self._t0
        W, H = self._W, self._H
        painter.setRenderHint(QPainter.Antialiasing)

        # ── Background (Pure deep black to dark gray center radial gradient) ──
        bg = QRadialGradient(W / 2, H / 2, H * 0.8)
        bg.setColorAt(0.0, QColor(25, 25, 25))
        bg.setColorAt(0.5, QColor(10, 10, 10))
        bg.setColorAt(1.0, QColor(0, 0, 0))
        painter.fillRect(0, 0, W, H, bg)

        # ── Grid (Minimalist dark gray lines) ──
        self._draw_grid(painter, t, W, H)

        # ── Particles (Fine white dust) ──
        self._update_particles(t)
        self._draw_particles(painter)

        # ── Minimalist Rotating Dial ──
        self._draw_dial(painter, t, W, H)

        # ── Title (Pure White, spaced and bold) ──
        title_font = QFont("Courier New", 32, QFont.Weight.ExtraBold)
        title_font.setLetterSpacing(QFont.AbsoluteSpacing, 4)
        painter.setFont(title_font)
        painter.setPen(QColor("#ffffff"))
        self._draw_centered_text(painter, self._TITLE, H // 2 - 35, title_font)

        # ── Subtitle (Dark gray / minimalist info) ──
        sub_font = QFont("Segoe UI", 9, QFont.Weight.Normal)
        sub_font.setLetterSpacing(QFont.AbsoluteSpacing, 2)
        painter.setFont(sub_font)
        painter.setPen(QColor(150, 150, 150, 220))
        self._draw_centered_text(painter, self._SUBTITLE, H // 2 + 5, sub_font)

        # ── Credits (Minimalist white label) ──
        auth_font = QFont("Segoe UI", 8, QFont.Weight.Bold)
        auth_font.setLetterSpacing(QFont.AbsoluteSpacing, 1)
        painter.setFont(auth_font)
        painter.setPen(QColor(220, 220, 220, 220))
        self._draw_centered_text(painter, self._AUTHORS, H // 2 + 38, auth_font)

        # ── Loading Bar ──
        self._draw_loading_bar(painter, t, W, H)

    def _draw_grid(self, painter: QPainter, t: float, W: int, H: int) -> None:
        spacing = 60
        shift_x = int(t * 10) % spacing
        shift_y = int(t * 5) % spacing
        pen = QPen(QColor(255, 255, 255, 12))
        pen.setWidth(1)
        painter.setPen(pen)
        for x in range(-spacing + shift_x, W + spacing, spacing):
            painter.drawLine(x, 0, x, H)
        for y in range(-spacing + shift_y, H + spacing, spacing):
            painter.drawLine(0, y, W, y)

    def _draw_dial(self, painter: QPainter, t: float, W: int, H: int) -> None:
        cx, cy = W // 2, H // 2 - 15
        r = 145
        painter.save()
        painter.translate(cx, cy)
        painter.rotate(t * 15)  # Slow elegant rotation
        
        # Draw outer thin circle
        pen = QPen(QColor(255, 255, 255, 20))
        pen.setWidth(1)
        painter.setPen(pen)
        painter.drawEllipse(-r, -r, r * 2, r * 2)

        # Draw ticks on the dial
        pen_tick = QPen(QColor(255, 255, 255, 60))
        pen_tick.setWidth(1)
        painter.setPen(pen_tick)
        for i in range(0, 360, 30):
            painter.drawLine(0, -r, 0, -r + 8)
            painter.rotate(30)
            
        painter.restore()

    def _make_particles(self, n: int) -> list[dict]:
        import random
        return [
            {
                "x": random.uniform(0, self._W),
                "y": random.uniform(0, self._H),
                "vx": random.uniform(-0.4, 0.4),
                "vy": random.uniform(-0.4, 0.4),
                "r": random.uniform(1.0, 2.5),
                "alpha": random.randint(30, 140),
            }
            for _ in range(n)
        ]

    def _update_particles(self, t: float) -> None:
        for p in self._particles:
            p["x"] += p["vx"]
            p["y"] += p["vy"]
            if p["x"] < 0 or p["x"] > self._W:
                p["vx"] *= -1
            if p["y"] < 0 or p["y"] > self._H:
                p["vy"] *= -1

    def _draw_particles(self, painter: QPainter) -> None:
        for p in self._particles:
            color = QColor(255, 255, 255, p["alpha"])
            painter.setBrush(color)
            painter.setPen(Qt.NoPen)
            painter.drawEllipse(QPointF(p["x"], p["y"]), p["r"], p["r"])

    def _draw_loading_bar(self, painter: QPainter, t: float, W: int, H: int) -> None:
        bx, by = 100, H - 60
        bw, bh = W - 200, 3
        # Track
        painter.setBrush(QColor(20, 20, 20))
        painter.setPen(QPen(QColor(40, 40, 40), 1))
        painter.drawRoundedRect(bx, by, bw, bh, 1, 1)
        # Fill
        filled = int(bw * self._progress)
        if filled > 0:
            painter.setBrush(QBrush(QColor("#ffffff")))
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(bx, by, filled, bh, 1, 1)
        # Status text
        pct_font = QFont("Courier New", 8)
        painter.setFont(pct_font)
        painter.setPen(QColor(180, 180, 180, 220))
        painter.drawText(bx, by + bh + 16, f"SYSTEM INITIALIZING: {int(self._progress * 100)}%")

    def _draw_centered_text(self, painter: QPainter, text: str, y: int, font: QFont) -> None:
        fm = QFontMetrics(font)
        x = (self._W - fm.horizontalAdvance(text)) // 2
        painter.drawText(x, y, text)
