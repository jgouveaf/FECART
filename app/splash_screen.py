"""Animated splash screen for Quantum Tracker."""
from __future__ import annotations

import math
import time
from typing import Optional

from PySide6.QtCore import Qt, QTimer, QPointF
from PySide6.QtGui import (
    QColor, QFont, QFontMetrics, QPainter, QPainterPath, QPixmap,
    QRadialGradient, QLinearGradient, QPen, QBrush,
)
from PySide6.QtWidgets import QSplashScreen, QApplication


class QuantumSplash(QSplashScreen):
    """Animated futuristic splash screen with neon grid, particles and rotating ring."""

    _AUTHORS = "Joao  ·  Gustavo  ·  Renato"
    _TITLE = "QUANTUM TRACKER"
    _SUBTITLE = "Sistema de Rastreamento Avancado com IA"
    _W, _H = 640, 400

    def __init__(self) -> None:
        pix = QPixmap(self._W, self._H)
        pix.fill(QColor("#000000"))
        super().__init__(pix, Qt.WindowStaysOnTopHint)
        self.setWindowFlag(Qt.FramelessWindowHint)

        self._t0 = time.time()
        self._progress = 0.0
        self._particles: list[dict] = self._make_particles(40)

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)
        self._timer.start(30)  # ~33 fps

    # ------------------------------------------------------------------
    def set_progress(self, pct: float) -> None:
        """Update loading bar 0.0 → 1.0."""
        self._progress = max(0.0, min(1.0, pct))

    # ------------------------------------------------------------------
    def _tick(self) -> None:
        self.repaint()

    # ------------------------------------------------------------------
    def drawContents(self, painter: QPainter) -> None:  # noqa: N802
        t = time.time() - self._t0
        W, H = self._W, self._H
        painter.setRenderHint(QPainter.Antialiasing)

        # ── Background gradient ──────────────────────────────────────
        bg = QRadialGradient(W / 2, H / 2, H * 0.7)
        bg.setColorAt(0, QColor(8, 15, 28))
        bg.setColorAt(1, QColor(2, 5, 10))
        painter.fillRect(0, 0, W, H, bg)

        # ── Neon grid ────────────────────────────────────────────────
        self._draw_grid(painter, t, W, H)

        # ── Animated particles ───────────────────────────────────────
        self._update_particles(t)
        self._draw_particles(painter)

        # ── Rotating outer ring ──────────────────────────────────────
        self._draw_ring(painter, t, W, H)

        # ── Title ────────────────────────────────────────────────────
        title_font = QFont("Segoe UI", 32, QFont.Weight.Black)
        painter.setFont(title_font)
        glow = QLinearGradient(0, H // 2 - 60, 0, H // 2 - 10)
        glow.setColorAt(0, QColor("#00ffff"))
        glow.setColorAt(1, QColor("#0080ff"))
        painter.setPen(QPen(QBrush(glow), 1))
        self._draw_centered_text(painter, self._TITLE, H // 2 - 38, title_font)

        # ── Subtitle ─────────────────────────────────────────────────
        sub_font = QFont("Segoe UI", 9, QFont.Weight.Normal)
        painter.setFont(sub_font)
        painter.setPen(QColor(80, 180, 220, 200))
        self._draw_centered_text(painter, self._SUBTITLE, H // 2 + 2, sub_font)

        # ── Authors ──────────────────────────────────────────────────
        auth_font = QFont("Consolas", 8)
        painter.setFont(auth_font)
        painter.setPen(QColor(0, 220, 255, 160))
        self._draw_centered_text(painter, f"Feito por: {self._AUTHORS}", H // 2 + 30, auth_font)

        # ── Loading bar ──────────────────────────────────────────────
        self._draw_loading_bar(painter, t, W, H)

    # ------------------------------------------------------------------
    def _draw_grid(self, painter: QPainter, t: float, W: int, H: int) -> None:
        spacing = 48
        shift_x = int(t * 18) % spacing
        shift_y = int(t * 10) % spacing
        pen = QPen(QColor(0, 60, 90, 60))
        pen.setWidth(1)
        painter.setPen(pen)
        for x in range(-spacing + shift_x, W + spacing, spacing):
            painter.drawLine(x, 0, x, H)
        for y in range(-spacing + shift_y, H + spacing, spacing):
            painter.drawLine(0, y, W, y)

    def _draw_ring(self, painter: QPainter, t: float, W: int, H: int) -> None:
        cx, cy = W // 2, H // 2 - 15
        r = 135
        num_arcs = 6
        painter.save()
        painter.translate(cx, cy)
        painter.rotate(t * 35)
        for i in range(num_arcs):
            angle = i * (360 / num_arcs)
            alpha = int(120 + 60 * math.sin(t * 2 + i))
            pen = QPen(QColor(0, 220, 255, alpha))
            pen.setWidth(2)
            painter.setPen(pen)
            painter.drawArc(
                int(-r), int(-r), int(r * 2), int(r * 2),
                int(angle * 16), int(40 * 16),
            )
        painter.restore()

    def _make_particles(self, n: int) -> list[dict]:
        import random
        return [
            {
                "x": random.uniform(0, self._W),
                "y": random.uniform(0, self._H),
                "vx": random.uniform(-0.6, 0.6),
                "vy": random.uniform(-0.6, 0.6),
                "r": random.uniform(1.5, 3.5),
                "alpha": random.randint(60, 180),
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
            color = QColor(0, 220, 255, p["alpha"])
            painter.setBrush(color)
            painter.setPen(Qt.NoPen)
            painter.drawEllipse(QPointF(p["x"], p["y"]), p["r"], p["r"])

    def _draw_loading_bar(self, painter: QPainter, t: float, W: int, H: int) -> None:
        bx, by = 80, H - 55
        bw, bh = W - 160, 6
        # Track
        painter.setBrush(QColor(0, 30, 45))
        painter.setPen(QPen(QColor(0, 80, 110), 1))
        painter.drawRoundedRect(bx, by, bw, bh, 3, 3)
        # Fill
        filled = int(bw * self._progress)
        if filled > 0:
            bar_grad = QLinearGradient(bx, by, bx + bw, by)
            bar_grad.setColorAt(0, QColor("#005577"))
            bar_grad.setColorAt(1, QColor("#00ffff"))
            painter.setBrush(QBrush(bar_grad))
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(bx, by, filled, bh, 3, 3)
        # Pulse dot at head
        if filled > 4:
            pulse_alpha = int(200 + 55 * math.sin(t * 8))
            painter.setBrush(QColor(0, 255, 255, pulse_alpha))
            painter.drawEllipse(bx + filled - 4, by - 3, 10, 12)
        # Percentage text
        pct_font = QFont("Consolas", 8)
        painter.setFont(pct_font)
        painter.setPen(QColor(0, 200, 230, 200))
        painter.drawText(bx, by + bh + 18, f"Carregando...  {int(self._progress * 100)}%")

    def _draw_centered_text(self, painter: QPainter, text: str, y: int, font: QFont) -> None:
        fm = QFontMetrics(font)
        x = (self._W - fm.horizontalAdvance(text)) // 2
        painter.drawText(x, y, text)
