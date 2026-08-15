"""Fonte de quadros OpenCV compartilhada por camera e testes offline."""

from __future__ import annotations

from pathlib import Path
from typing import Union

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None


VideoSource = Union[int, str, Path]


class FrameSourceError(RuntimeError):
    """Falha explicita ao abrir ou ler uma fonte de video."""


class OpenCVFrameSource:
    """Encapsula ``VideoCapture`` para camera, arquivo ou video gravado.

    Arquivos permitem exercitar a captura nas Etapas 2 a 9 sem acessar a
    webcam real. A origem numerica fica reservada para a validacao fisica.
    """

    def __init__(
        self,
        source: VideoSource,
        width: int = 0,
        height: int = 0,
        allow_live_camera: bool = False,
    ) -> None:
        self.source = str(source) if isinstance(source, Path) else source
        self.width = max(0, int(width))
        self.height = max(0, int(height))
        self.allow_live_camera = bool(allow_live_camera)
        self.capture = None
        self.frames_read = 0

    @property
    def is_open(self) -> bool:
        return bool(self.capture is not None and self.capture.isOpened())

    def open(self) -> "OpenCVFrameSource":
        if cv2 is None:
            raise FrameSourceError("OpenCV nao esta instalado")
        if isinstance(self.source, int) and not self.allow_live_camera:
            raise FrameSourceError("Camera ao vivo bloqueada neste modo de teste offline")
        self.close()
        self.capture = cv2.VideoCapture(self.source)
        if not self.capture.isOpened():
            self.close()
            raise FrameSourceError(f"Nao foi possivel abrir a fonte: {self.source}")

        # Tamanho e uma solicitacao para cameras. Em arquivos, preservar o
        # quadro original evita resultados diferentes entre codecs/backends.
        if isinstance(self.source, int):
            if self.width:
                self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            if self.height:
                self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self.frames_read = 0
        return self

    def read(self) -> np.ndarray:
        if not self.is_open:
            raise FrameSourceError("Fonte de video nao esta aberta")
        ok, frame = self.capture.read()
        if not ok or frame is None or frame.size == 0:
            raise EOFError("Fim ou falha na leitura da fonte de video")
        self.frames_read += 1
        return frame

    @property
    def fps(self) -> float:
        if not self.is_open:
            return 0.0
        value = float(self.capture.get(cv2.CAP_PROP_FPS))
        return value if np.isfinite(value) and value > 0 else 0.0

    @property
    def frame_count(self) -> int:
        if not self.is_open:
            return 0
        value = float(self.capture.get(cv2.CAP_PROP_FRAME_COUNT))
        return max(0, int(value)) if np.isfinite(value) else 0

    def rewind(self) -> bool:
        if not self.is_open or isinstance(self.source, int):
            return False
        ok = bool(self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0))
        if ok:
            self.frames_read = 0
        return ok

    def close(self) -> None:
        if self.capture is not None:
            self.capture.release()
            self.capture = None

    def __enter__(self) -> "OpenCVFrameSource":
        return self.open()

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()
