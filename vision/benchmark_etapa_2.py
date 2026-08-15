"""Benchmark repetivel da Etapa 2 usando apenas arquivos locais.

Uso:
    python -m vision.benchmark_etapa_2

Nao abre webcam, porta serial ou qualquer hardware.
"""

from __future__ import annotations

import json
import statistics
import time
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np

from tracker.yolo_tracker import YoloPersonTracker
from utils.config import AppConfig


ROOT = Path(__file__).resolve().parents[1]


def _asset_offline() -> Path:
    import ultralytics

    return Path(ultralytics.__file__).resolve().parent / "assets" / "bus.jpg"


def _mover(frame: np.ndarray, dx: int) -> np.ndarray:
    h, w = frame.shape[:2]
    matrix = np.float32([[1, 0, dx], [0, 1, 0]])
    return cv2.warpAffine(
        frame,
        matrix,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(114, 114, 114),
    )


def _aproximar(frame: np.ndarray, escala: float) -> np.ndarray:
    h, w = frame.shape[:2]
    resized = cv2.resize(frame, None, fx=escala, fy=escala, interpolation=cv2.INTER_LINEAR)
    rh, rw = resized.shape[:2]
    canvas = np.full_like(frame, 114)
    if escala <= 1.0:
        x = (w - rw) // 2
        y = (h - rh) // 2
        canvas[y : y + rh, x : x + rw] = resized
        return canvas
    x = (rw - w) // 2
    y = (rh - h) // 2
    return resized[y : y + h, x : x + w]


def _sequencia(frame: np.ndarray) -> list[np.ndarray]:
    frames = [_mover(frame, dx) for dx in range(0, 41, 5)]
    # Oclusao curta parcial no centro, seguida de recuperacao.
    for _ in range(2):
        occluded = frames[-1].copy()
        h, w = occluded.shape[:2]
        cv2.rectangle(occluded, (w // 3, h // 4), (2 * w // 3, 3 * h // 4), (114, 114, 114), -1)
        frames.append(occluded)
    frames.extend(_mover(frame, dx) for dx in range(40, 61, 5))
    return frames


def medir_tracker(nome_tracker: str, frame: np.ndarray) -> dict:
    config = replace(
        AppConfig(),
        yolo_model=str(ROOT / "yolov8n.pt"),
        yolo_tracker=nome_tracker,
        yolo_infer_size=416,
        detection_confidence=AppConfig().detection_confidence,
        yolo_half_precision=False,
    )
    detector = YoloPersonTracker(config)
    ids_por_frame: list[set[int]] = []
    tempos: list[float] = []
    contagens: list[int] = []

    sequencia = _sequencia(frame)
    # Primeira inferencia aquece importacoes/backends e nao entra na metrica.
    detector.detect_sync(sequencia[0])
    for item in sequencia:
        inicio = time.perf_counter()
        detections = detector.detect_sync(item)
        tempos.append((time.perf_counter() - inicio) * 1000)
        ids_por_frame.append({int(d.track_id) for d in detections if d.track_id is not None})
        contagens.append(len(detections))

    all_ids = set().union(*ids_por_frame) if ids_por_frame else set()
    frequencias = {track_id: sum(track_id in ids_ for ids_ in ids_por_frame) for track_id in all_ids}
    return {
        "tracker": nome_tracker,
        "quadros": len(ids_por_frame),
        "quadros_com_pessoa": sum(bool(ids_) for ids_ in ids_por_frame),
        "ids_unicos": len(all_ids),
        "melhor_persistencia_quadros": max(frequencias.values(), default=0),
        "persistencia_por_id": dict(sorted(frequencias.items())),
        "deteccoes_media": round(statistics.mean(contagens), 2),
        "inferencia_media_ms": round(statistics.mean(tempos), 1),
        "inferencia_p95_ms": round(sorted(tempos)[int(0.95 * (len(tempos) - 1))], 1),
    }


def main() -> int:
    asset = _asset_offline()
    frame = cv2.imread(str(asset))
    if frame is None:
        raise FileNotFoundError(f"Imagem offline nao encontrada: {asset}")

    base_config = replace(
        AppConfig(),
        yolo_model=str(ROOT / "yolov8n.pt"),
        detection_confidence=AppConfig().detection_confidence,
    )
    detector = YoloPersonTracker(base_config)
    condicoes = {
        "distante_65pct": _aproximar(frame, 0.65),
        "normal": frame,
        "proximo_125pct": _aproximar(frame, 1.25),
        "escuro": cv2.convertScaleAbs(frame, alpha=0.42, beta=0),
        "claro": cv2.convertScaleAbs(frame, alpha=1.20, beta=32),
        "desfocado": cv2.GaussianBlur(frame, (13, 13), 0),
    }
    contagens = {nome: len(detector.predict_sync(item)) for nome, item in condicoes.items()}
    resultado = {
        "modo": "OFFLINE_SEM_HARDWARE",
        "confidence_threshold": base_config.detection_confidence,
        "imagem": str(asset),
        "deteccoes_por_condicao": contagens,
        "comparacao_trackers": [
            medir_tracker("bytetrack.yaml", frame),
            medir_tracker("botsort.yaml", frame),
        ],
    }
    relatorio = json.dumps(resultado, indent=2, ensure_ascii=False)
    output = ROOT / "docs" / "RESULTADO_BENCHMARK_ETAPA_2.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(relatorio + "\n", encoding="utf-8")
    print(relatorio)
    print(f"Relatorio salvo em: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
