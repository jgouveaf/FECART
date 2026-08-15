"""Captura e HUD validados sem abrir webcam."""

from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.models import BoundingBox, EventRecord, SystemSnapshot, TargetState, TrackedTarget
from hud.tactical_hud import TacticalHUD
from vision.frame_source import FrameSourceError, OpenCVFrameSource


class TesteCapturaOffline(unittest.TestCase):
    def test_video_gravado_entrega_todos_os_quadros_em_ordem(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            video_path = Path(temp_dir) / "captura_offline.avi"
            writer = cv2.VideoWriter(
                str(video_path),
                cv2.VideoWriter_fourcc(*"MJPG"),
                15.0,
                (160, 120),
            )
            self.assertTrue(writer.isOpened())
            for indice in range(24):
                frame = np.full((120, 160, 3), indice * 8, dtype=np.uint8)
                cv2.putText(frame, str(indice), (45, 75), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 0, 0), 2)
                writer.write(frame)
            writer.release()

            medias = []
            with OpenCVFrameSource(video_path) as source:
                while True:
                    try:
                        medias.append(float(source.read().mean()))
                    except EOFError:
                        break
                self.assertEqual(source.frames_read, 24)

            self.assertEqual(len(medias), 24)
            self.assertGreater(medias[-1], medias[0] + 150)

    def test_fonte_inexistente_falha_com_mensagem_clara(self) -> None:
        source = OpenCVFrameSource(ROOT / "arquivo_que_nao_existe.mp4")
        with self.assertRaises(FrameSourceError):
            source.open()


class TesteHUDOffline(unittest.TestCase):
    def test_hud_exibe_alvo_id_estado_e_confianca_sem_mudar_dimensoes(self) -> None:
        frame = np.full((720, 1280, 3), 80, dtype=np.uint8)
        alvo = TrackedTarget(
            track_id=7,
            bbox=BoundingBox(430, 180, 650, 620),
            confidence=0.91,
            state=TargetState.VISIBLE,
            name="ALVO TESTE",
            distance_estimate=1.8,
            speed=3.2,
        )
        snapshot = SystemSnapshot(
            fps=18.4,
            targets=[alvo],
            recent_logs=[EventRecord(datetime.now().isoformat(), 7, None, 0.91, "TARGET_CREATED", "VISIBLE")],
            system_status="OFFLINE",
        )

        saida = TacticalHUD().draw(frame, snapshot)

        self.assertEqual(saida.shape, frame.shape)
        self.assertFalse(np.array_equal(saida, frame))
        # O canto superior esquerdo da caixa deve receber o bracket do HUD.
        regiao = saida[178:205, 428:458]
        self.assertGreater(int(regiao.max()), 150)

    def test_todos_os_estados_de_tracking_sao_renderizaveis(self) -> None:
        for estado in (TargetState.VISIBLE, TargetState.OCCLUDED, TargetState.GHOST, TargetState.LOST):
            with self.subTest(estado=estado):
                frame = np.zeros((480, 800, 3), dtype=np.uint8)
                alvo = TrackedTarget(1, BoundingBox(250, 120, 420, 420), 0.8, state=estado)
                snapshot = SystemSnapshot(10.0, [alvo], [], "OFFLINE")
                saida = TacticalHUD().draw(frame, snapshot)
                self.assertEqual(saida.shape, frame.shape)


if __name__ == "__main__":
    unittest.main(verbosity=2)
