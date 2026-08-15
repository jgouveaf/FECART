"""Etapa 6: controle e qualidade de camera usando apenas video gravado."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vision.camera_controller import CameraState, FrameQualityAnalyzer, OfflineCameraController
from vision.frame_source import FrameSourceError, OpenCVFrameSource


def create_recorded_video(path: Path, frames: int = 12, fps: float = 12.0) -> None:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (640, 360))
    if not writer.isOpened():
        raise RuntimeError("Codec MJPG indisponivel para o teste")
    for index in range(frames):
        image = np.full((360, 640, 3), 70, dtype=np.uint8)
        cv2.rectangle(image, (20 + index * 18, 90), (150 + index * 18, 300), (240, 240, 240), -1)
        cv2.putText(image, str(index), (280, 200), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 255, 255), 4)
        writer.write(image)
    writer.release()


class TestOfflineCameraControl(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="quantum_camera_")
        self.video = Path(self.temp_dir.name) / "gravado.avi"
        create_recorded_video(self.video)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_start_pause_resume_eof_stop(self) -> None:
        controller = OfflineCameraController()
        self.assertTrue(controller.start(self.video))
        self.assertEqual(controller.state, CameraState.RUNNING)
        first = controller.next_frame()
        self.assertIsNotNone(first)
        self.assertEqual(first.index, 0)
        self.assertTrue(controller.pause())
        self.assertIsNone(controller.next_frame())
        self.assertTrue(controller.resume())
        frames = [first]
        while controller.state == CameraState.RUNNING:
            frame = controller.next_frame()
            if frame is not None:
                frames.append(frame)
        self.assertEqual(len(frames), 12)
        self.assertEqual(controller.state, CameraState.EOF)
        controller.stop()
        self.assertEqual(controller.state, CameraState.STOPPED)

    def test_loop_reproduces_video_sem_reabrir_hardware(self) -> None:
        controller = OfflineCameraController(loop=True)
        self.assertTrue(controller.start(self.video))
        delivered = [controller.next_frame() for _ in range(1000)]
        self.assertTrue(all(frame is not None for frame in delivered))
        self.assertEqual(controller.state, CameraState.RUNNING)
        self.assertEqual(controller.delivered_frames, 1000)

    def test_numeric_source_is_blocked_before_videocapture(self) -> None:
        with patch("vision.frame_source.cv2.VideoCapture") as capture:
            with self.assertRaises(FrameSourceError):
                OpenCVFrameSource(0).open()
            capture.assert_not_called()
        controller = OfflineCameraController()
        self.assertFalse(controller.start(0))
        self.assertEqual(controller.state, CameraState.ERROR)
        self.assertIn("offline", controller.last_error)

    def test_missing_or_corrupt_file_reports_error(self) -> None:
        controller = OfflineCameraController()
        self.assertFalse(controller.start(Path(self.temp_dir.name) / "ausente.mp4"))
        self.assertEqual(controller.state, CameraState.ERROR)
        corrupt = Path(self.temp_dir.name) / "corrupto.mp4"
        corrupt.write_bytes(b"nao e video")
        self.assertFalse(controller.start(corrupt))
        self.assertEqual(controller.state, CameraState.ERROR)

    def test_quality_detects_dark_bright_blur_and_low_resolution(self) -> None:
        analyzer = FrameQualityAnalyzer()
        dark = np.zeros((360, 640, 3), dtype=np.uint8)
        bright = np.full((360, 640, 3), 255, dtype=np.uint8)
        low_res = np.full((120, 160, 3), 100, dtype=np.uint8)
        self.assertIn("imagem_escura", analyzer.analyze(dark).warnings)
        self.assertIn("imagem_clara_demais", analyzer.analyze(bright).warnings)
        self.assertIn("imagem_desfocada", analyzer.analyze(bright).warnings)
        self.assertIn("resolucao_baixa", analyzer.analyze(low_res).warnings)

    def test_metadata_does_not_claim_live_camera(self) -> None:
        controller = OfflineCameraController()
        self.assertTrue(controller.start(self.video))
        metadata = controller.metadata
        self.assertTrue(metadata["offline_only"])
        self.assertEqual(metadata["frame_count"], 12)
        self.assertGreater(metadata["fps"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
