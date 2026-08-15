"""Controle deterministico de video para a Etapa 6, sem abrir webcam."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

import cv2
import numpy as np

from vision.frame_source import FrameSourceError, OpenCVFrameSource, VideoSource


class CameraState(str, Enum):
    STOPPED = "STOPPED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    EOF = "EOF"
    ERROR = "ERROR"


@dataclass(frozen=True)
class FrameQualityReport:
    width: int
    height: int
    brightness: float
    sharpness: float
    warnings: tuple[str, ...]

    @property
    def acceptable(self) -> bool:
        return not self.warnings


@dataclass(frozen=True)
class CameraFrame:
    image: np.ndarray
    index: int
    timestamp_seconds: float
    quality: FrameQualityReport


class FrameQualityAnalyzer:
    def __init__(
        self,
        min_width: int = 640,
        min_height: int = 360,
        dark_threshold: float = 38.0,
        bright_threshold: float = 220.0,
        blur_threshold: float = 55.0,
    ) -> None:
        self.min_width = int(min_width)
        self.min_height = int(min_height)
        self.dark_threshold = float(dark_threshold)
        self.bright_threshold = float(bright_threshold)
        self.blur_threshold = float(blur_threshold)

    def analyze(self, frame: np.ndarray) -> FrameQualityReport:
        if frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
            raise ValueError("Quadro vazio ou invalido")
        if frame.ndim not in (2, 3):
            raise ValueError("Formato de quadro nao suportado")
        gray = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        height, width = gray.shape[:2]
        brightness = float(np.mean(gray))
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        warnings: list[str] = []
        if width < self.min_width or height < self.min_height:
            warnings.append("resolucao_baixa")
        if brightness < self.dark_threshold:
            warnings.append("imagem_escura")
        elif brightness > self.bright_threshold:
            warnings.append("imagem_clara_demais")
        if sharpness < self.blur_threshold:
            warnings.append("imagem_desfocada")
        return FrameQualityReport(
            width=width,
            height=height,
            brightness=round(brightness, 2),
            sharpness=round(sharpness, 2),
            warnings=tuple(warnings),
        )


class OfflineCameraController:
    """Controla arquivos de video sem enumerar ou abrir camera fisica."""

    def __init__(self, loop: bool = False, quality: Optional[FrameQualityAnalyzer] = None) -> None:
        self.loop = bool(loop)
        self.quality = quality or FrameQualityAnalyzer()
        self.source: Optional[OpenCVFrameSource] = None
        self.state = CameraState.STOPPED
        self.last_error = ""
        self.delivered_frames = 0

    def start(self, source: VideoSource) -> bool:
        self.stop()
        self.last_error = ""
        try:
            self.source = OpenCVFrameSource(source, allow_live_camera=False).open()
        except (FrameSourceError, OSError, ValueError) as exc:
            self.source = None
            self.state = CameraState.ERROR
            self.last_error = str(exc)
            return False
        self.delivered_frames = 0
        self.state = CameraState.RUNNING
        return True

    def pause(self) -> bool:
        if self.state != CameraState.RUNNING:
            return False
        self.state = CameraState.PAUSED
        return True

    def resume(self) -> bool:
        if self.state != CameraState.PAUSED:
            return False
        self.state = CameraState.RUNNING
        return True

    def stop(self) -> None:
        if self.source is not None:
            self.source.close()
        self.source = None
        self.state = CameraState.STOPPED

    def next_frame(self) -> Optional[CameraFrame]:
        if self.state == CameraState.PAUSED:
            return None
        if self.state != CameraState.RUNNING or self.source is None:
            return None
        try:
            image = self.source.read()
        except EOFError:
            if self.loop and self.source.rewind():
                try:
                    image = self.source.read()
                except EOFError:
                    self.state = CameraState.EOF
                    return None
            else:
                self.state = CameraState.EOF
                return None
        except Exception as exc:
            self.state = CameraState.ERROR
            self.last_error = str(exc)
            return None

        self.delivered_frames += 1
        fps = self.source.fps
        timestamp = (self.delivered_frames - 1) / fps if fps > 0 else 0.0
        return CameraFrame(
            image=image,
            index=self.delivered_frames - 1,
            timestamp_seconds=timestamp,
            quality=self.quality.analyze(image),
        )

    @property
    def metadata(self) -> dict[str, object]:
        return {
            "state": self.state.value,
            "source": str(self.source.source) if self.source else None,
            "fps": self.source.fps if self.source else 0.0,
            "frame_count": self.source.frame_count if self.source else 0,
            "delivered_frames": self.delivered_frames,
            "offline_only": True,
            "last_error": self.last_error,
        }

    def __enter__(self) -> "OfflineCameraController":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.stop()
