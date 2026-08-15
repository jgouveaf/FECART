from __future__ import annotations

import sys
import time
import unittest
import random
from dataclasses import replace
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.models import BoundingBox, Detection, EventType, IdentityMatch, TargetState
from recognition.identity_resolver import IdentityResolver
from tracker.track_manager import TrackManager
from tracker.tracker_wrapper import TrackerWrapper
from tracker.yolo_tracker import YoloPersonTracker
from utils.config import AppConfig


def caixa(cx: float, cy: float, largura: float = 40, altura: float = 120) -> BoundingBox:
    return BoundingBox(
        cx - largura / 2,
        cy - altura / 2,
        cx + largura / 2,
        cy + altura / 2,
    )


class TesteTrackManagerOffline(unittest.TestCase):
    def setUp(self) -> None:
        self.config = replace(
            AppConfig(),
            occluded_after_frames=2,
            ghost_after_frames=4,
            lost_after_frames=7,
            remove_after_frames=10,
            max_match_distance=80.0,
        )
        self.manager = TrackManager(self.config)

    def test_id_permanece_em_movimento_continuo_sem_id_do_detector(self) -> None:
        ids = []
        for frame in range(40):
            targets, _ = self.manager.update(
                [Detection(caixa(100 + frame * 3, 150), 0.9)]
            )
            ids.append(targets[0].track_id)
        self.assertEqual(len(set(ids)), 1)

    def test_duas_pessoas_nao_recebem_mesmo_id(self) -> None:
        for frame in range(30):
            targets, _ = self.manager.update(
                [
                    Detection(caixa(80 + frame * 2, 140), 0.9),
                    Detection(caixa(420 - frame * 2, 160), 0.88),
                ]
            )
            self.assertEqual(len({alvo.track_id for alvo in targets}), 2)

    def test_id_fornecido_pelo_bytetrack_e_preservado(self) -> None:
        for frame in range(20):
            targets, _ = self.manager.update(
                [Detection(caixa(100 + frame, 150), 0.9, track_id=42)]
            )
            self.assertEqual(targets[0].track_id, 42)

    def test_id_duplicado_do_detector_nao_funde_duas_pessoas(self) -> None:
        self.manager.update(
            [
                Detection(caixa(100, 150), 0.9, track_id=5),
                Detection(caixa(400, 150), 0.9, track_id=6),
            ]
        )
        targets, _ = self.manager.update(
            [
                Detection(caixa(105, 150), 0.9, track_id=5),
                Detection(caixa(395, 150), 0.9, track_id=5),
            ]
        )
        self.assertEqual({target.track_id for target in targets}, {5, 6})

    def test_ids_bytetrack_nao_trocam_quando_trajetorias_cruzam(self) -> None:
        for frame in range(21):
            x_a = 100 + frame * 10
            x_b = 300 - frame * 10
            targets, _ = self.manager.update(
                [
                    Detection(caixa(x_a, 140), 0.9, track_id=101),
                    Detection(caixa(x_b, 170), 0.9, track_id=202),
                ]
            )
            by_id = {target.track_id: target for target in targets}
            self.assertAlmostEqual(by_id[101].bbox.center[0], x_a)
            self.assertAlmostEqual(by_id[202].bbox.center[0], x_b)

    def test_stress_5000_quadros_seis_pessoas_e_oclusoes(self) -> None:
        rng = random.Random(20260812)
        ids_esperados = {11, 22, 33, 44, 55, 66}
        vistos = set()
        for frame in range(5000):
            detections = []
            for indice, track_id in enumerate(sorted(ids_esperados)):
                # Oclusoes curtas deterministicas e independentes.
                if (frame + indice * 7) % 137 in (0, 1, 2):
                    continue
                x = 80 + indice * 115 + 25 * np.sin((frame + indice * 9) / 31.0)
                y = 180 + indice * 6 + rng.uniform(-0.8, 0.8)
                detections.append(Detection(caixa(x, y), 0.85, track_id=track_id))

            targets, _ = self.manager.update(detections)
            ids_ativos = {target.track_id for target in targets}
            self.assertEqual(len(ids_ativos), len(targets))
            self.assertTrue(ids_ativos.issubset(ids_esperados))
            vistos.update(ids_ativos)

        self.assertEqual(vistos, ids_esperados)

    def test_transicoes_de_oclusao_ghost_lost_removed(self) -> None:
        self.manager.update([Detection(caixa(100, 150), 0.9, track_id=3)])
        estados = []
        eventos = []
        for _ in range(10):
            targets, novos_eventos = self.manager.update([])
            estados.append(targets[0].state if targets else TargetState.REMOVED)
            eventos.extend(evento.event_type for evento in novos_eventos)

        self.assertIn(TargetState.OCCLUDED, estados)
        self.assertIn(TargetState.GHOST, estados)
        self.assertIn(TargetState.LOST, estados)
        self.assertEqual(estados[-1], TargetState.REMOVED)
        self.assertEqual(eventos.count(EventType.GHOST_ACTIVATED), 1)
        self.assertEqual(eventos.count(EventType.TARGET_LOST), 1)
        self.assertEqual(eventos.count(EventType.TARGET_REMOVED), 1)

    def test_recuperacao_preserva_id(self) -> None:
        self.manager.update([Detection(caixa(100, 150), 0.9, track_id=7)])
        for _ in range(5):
            self.manager.update([])
        targets, eventos = self.manager.update(
            [Detection(caixa(110, 150), 0.92, track_id=7)]
        )
        self.assertEqual(targets[0].track_id, 7)
        self.assertEqual(targets[0].state, TargetState.VISIBLE)
        self.assertIn(EventType.TRACKING_RECOVERED, [evento.event_type for evento in eventos])

    def test_reset_reinicia_ids_locais(self) -> None:
        targets, _ = self.manager.update([Detection(caixa(100, 150), 0.9)])
        self.assertEqual(targets[0].track_id, 1)
        self.manager.reset()
        targets, _ = self.manager.update([Detection(caixa(300, 150), 0.9)])
        self.assertEqual(targets[0].track_id, 1)


class TesteIdentityResolverOffline(unittest.TestCase):
    def test_mesma_pessoa_nao_ocupa_dois_tracks(self) -> None:
        resolver = IdentityResolver(min_confidence_margin=0.08, ttl_seconds=30)
        match = IdentityMatch(1, "Pessoa 1", 0.80)
        self.assertIsNotNone(resolver.resolve(10, match))
        self.assertIsNone(resolver.resolve(11, IdentityMatch(1, "Pessoa 1", 0.84)))

    def test_match_muito_melhor_transfere_identidade(self) -> None:
        resolver = IdentityResolver(min_confidence_margin=0.08, ttl_seconds=30)
        resolver.resolve(10, IdentityMatch(1, "Pessoa 1", 0.70))
        novo = resolver.resolve(11, IdentityMatch(1, "Pessoa 1", 0.90))
        self.assertIsNotNone(novo)

    def test_liberar_track_permite_nova_atribuicao(self) -> None:
        resolver = IdentityResolver(ttl_seconds=30)
        resolver.resolve(10, IdentityMatch(1, "Pessoa 1", 0.80))
        resolver.release_track(10)
        self.assertIsNotNone(resolver.resolve(11, IdentityMatch(1, "Pessoa 1", 0.80)))


class TesteReidVisualOffline(unittest.TestCase):
    def setUp(self) -> None:
        config = replace(
            AppConfig(),
            occluded_after_frames=2,
            ghost_after_frames=4,
            lost_after_frames=7,
            remove_after_frames=10,
        )
        self.wrapper = TrackerWrapper(config)
        self.bbox = BoundingBox(20, 20, 80, 100)

    @staticmethod
    def _frame_com_pessoa() -> np.ndarray:
        frame = np.zeros((120, 120, 3), dtype=np.uint8)
        frame[20:100, 20:80] = (0, 0, 255)
        return frame

    def test_oclusao_preserva_ultimo_histograma_observado(self) -> None:
        frame = self._frame_com_pessoa()
        self.wrapper.update(frame, [Detection(self.bbox, 0.9, track_id=1)])
        original = self.wrapper.active_histograms[1].copy()

        self.wrapper.update(np.zeros_like(frame), [])

        self.assertIn(1, self.wrapper.lost_tracks)
        np.testing.assert_allclose(self.wrapper.lost_tracks[1]["hist"], original)

    def test_reid_recupera_id_estavel_apos_backend_criar_novo_id(self) -> None:
        frame = self._frame_com_pessoa()
        self.wrapper.update(frame, [Detection(self.bbox, 0.9, track_id=1)])
        self.wrapper.update(np.zeros_like(frame), [])

        detections = [Detection(self.bbox, 0.92, track_id=99)]
        targets, _ = self.wrapper.update(frame, detections)

        self.assertEqual(detections[0].track_id, 1)
        self.assertIn(1, {target.track_id for target in targets})
        self.assertNotIn(99, {target.track_id for target in targets})


class _ModeloYoloVazio:
    def __init__(self) -> None:
        self.chamadas = 0

    def track(self, *args, **kwargs):
        self.chamadas += 1
        return []


class TesteDetectorAssincronoOffline(unittest.TestCase):
    def test_primeiro_quadro_e_enviado_imediatamente(self) -> None:
        detector = YoloPersonTracker(replace(AppConfig(), yolo_detect_interval=3))
        modelo = _ModeloYoloVazio()
        detector.model = modelo
        detector.available = True

        detector.detect(np.zeros((120, 160, 3), dtype=np.uint8))
        limite = time.monotonic() + 2.0
        while detector._busy and time.monotonic() < limite:
            time.sleep(0.01)
        detector.shutdown()

        self.assertEqual(modelo.chamadas, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
