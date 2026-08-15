"""Integracao offline do detector real, sem webcam e sem robo fisico."""

from __future__ import annotations

import sys
import time
import unittest
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tracker.yolo_tracker import YoloPersonTracker
from utils.config import AppConfig


class TesteYoloRealOffline(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import ultralytics

        cls.asset = Path(ultralytics.__file__).resolve().parent / "assets" / "bus.jpg"
        cls.frame = cv2.imread(str(cls.asset))
        if cls.frame is None:
            raise unittest.SkipTest(f"Imagem offline nao encontrada: {cls.asset}")

        cls.config = replace(
            AppConfig(),
            yolo_model=str(ROOT / "yolov8n.pt"),
            yolo_infer_size=416,
            detection_confidence=AppConfig().detection_confidence,
            yolo_half_precision=False,
        )

    def test_detector_real_condicoes_visuais_e_ids_persistentes(self) -> None:
        detector = YoloPersonTracker(self.config)
        h, w = self.frame.shape[:2]

        variacoes = {
            "normal": self.frame,
            "escuro": cv2.convertScaleAbs(self.frame, alpha=0.42, beta=0),
            "claro": cv2.convertScaleAbs(self.frame, alpha=1.20, beta=32),
            "desfocado": cv2.GaussianBlur(self.frame, (13, 13), 0),
            "baixa_resolucao": cv2.resize(
                cv2.resize(self.frame, (w // 4, h // 4), interpolation=cv2.INTER_AREA),
                (w, h),
                interpolation=cv2.INTER_LINEAR,
            ),
            "distante_65pct": self._redimensionar_no_canvas(self.frame, 0.65),
            "proximo_125pct": self._redimensionar_no_canvas(self.frame, 1.25),
        }

        contagens = {}
        for nome, frame in variacoes.items():
            detections = detector.predict_sync(frame)
            contagens[nome] = len(detections)
            for detection in detections:
                self.assertGreaterEqual(detection.bbox.x1, 0)
                self.assertGreaterEqual(detection.bbox.y1, 0)
                self.assertLessEqual(detection.bbox.x2, w + 2)
                self.assertLessEqual(detection.bbox.y2, h + 2)
                self.assertGreaterEqual(detection.confidence, self.config.detection_confidence)

        self.assertGreaterEqual(contagens["normal"], 2, contagens)
        self.assertGreaterEqual(
            sum(contagem > 0 for contagem in contagens.values()),
            6,
            contagens,
        )

        # Nova instancia para que a sequencia comece com o estado do ByteTrack limpo.
        tracker = YoloPersonTracker(self.config)
        ids_por_frame = []
        tempos_ms = []
        for deslocamento in range(0, 49, 4):
            matriz = np.float32([[1, 0, deslocamento], [0, 1, 0]])
            frame = cv2.warpAffine(
                self.frame,
                matriz,
                (w, h),
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=(114, 114, 114),
            )
            inicio = time.perf_counter()
            detections = tracker.detect_sync(frame)
            tempos_ms.append((time.perf_counter() - inicio) * 1000)
            ids_por_frame.append({d.track_id for d in detections if d.track_id is not None})

        self.assertTrue(all(ids_ for ids_ in ids_por_frame), ids_por_frame)
        frequencia = {
            track_id: sum(track_id in ids_ for ids_ in ids_por_frame)
            for track_id in set().union(*ids_por_frame)
        }
        melhor_persistencia = max(frequencia.values(), default=0)
        self.assertGreaterEqual(melhor_persistencia, 10, frequencia)

        print(
            "\nBENCHMARK_YOLO_OFFLINE",
            {
                "deteccoes_por_condicao": contagens,
                "quadros_sequencia": len(ids_por_frame),
                "melhor_persistencia": melhor_persistencia,
                "inferencia_media_ms": round(sum(tempos_ms) / len(tempos_ms), 1),
            },
        )

    @staticmethod
    def _redimensionar_no_canvas(frame: np.ndarray, escala: float) -> np.ndarray:
        h, w = frame.shape[:2]
        resized = cv2.resize(frame, None, fx=escala, fy=escala, interpolation=cv2.INTER_LINEAR)
        rh, rw = resized.shape[:2]
        if escala <= 1.0:
            canvas = np.full_like(frame, 114)
            x = (w - rw) // 2
            y = (h - rh) // 2
            canvas[y : y + rh, x : x + rw] = resized
            return canvas
        x = (rw - w) // 2
        y = (rh - h) // 2
        return resized[y : y + h, x : x + w]


if __name__ == "__main__":
    unittest.main(verbosity=2)
