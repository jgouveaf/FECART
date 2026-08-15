"""Localizacao aproximada por RSSI, sem acesso a radio Bluetooth real."""

from __future__ import annotations

import math
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Iterable

import numpy as np


@dataclass(frozen=True)
class Anchor:
    anchor_id: str
    x: float
    y: float
    tx_power_at_1m: float = -59.0
    path_loss_exponent: float = 2.2


@dataclass(frozen=True)
class RssiObservation:
    anchor_id: str
    rssi_dbm: float


@dataclass(frozen=True)
class LocationEstimate:
    x: float
    y: float
    error_radius_m: float
    residual_rmse_m: float
    confidence: str
    anchors_used: int
    method: str = "RSSI_APROXIMADO"


class RssiSmoother:
    """Filtro de mediana por ancora para reduzir picos de RSSI."""

    def __init__(self, window_size: int = 7) -> None:
        if window_size < 1:
            raise ValueError("A janela deve ser positiva")
        self.window_size = int(window_size)
        self._samples: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=self.window_size)
        )

    def add(self, observation: RssiObservation) -> RssiObservation:
        if not observation.anchor_id:
            raise ValueError("anchor_id vazio")
        value = float(observation.rssi_dbm)
        if not math.isfinite(value) or value > 20 or value < -128:
            raise ValueError("RSSI fora da faixa valida")
        samples = self._samples[observation.anchor_id]
        samples.append(value)
        return RssiObservation(observation.anchor_id, float(np.median(samples)))


class RssiLocalizer:
    """Converte RSSI em distancia aproximada e estima uma posicao 2D.

    Tres ou mais receptores em posicoes conhecidas sao obrigatorios. Um unico
    receptor permite apenas uma faixa de proximidade, nunca coordenadas.
    """

    def __init__(self, anchors: Iterable[Anchor]) -> None:
        anchor_list = list(anchors)
        self.anchors = {anchor.anchor_id: anchor for anchor in anchor_list}
        if len(self.anchors) != len(anchor_list):
            raise ValueError("IDs de ancoras duplicados")

    @staticmethod
    def distance_from_rssi(rssi_dbm: float, anchor: Anchor) -> float:
        rssi = float(rssi_dbm)
        if not math.isfinite(rssi) or rssi > 20 or rssi < -128:
            raise ValueError("RSSI fora da faixa valida")
        if anchor.path_loss_exponent <= 0:
            raise ValueError("Expoente de perda invalido")
        distance = 10 ** ((anchor.tx_power_at_1m - rssi) / (10 * anchor.path_loss_exponent))
        return float(np.clip(distance, 0.05, 1000.0))

    @staticmethod
    def proximity_bucket(rssi_dbm: float) -> str:
        rssi = float(rssi_dbm)
        if not math.isfinite(rssi) or rssi > 20 or rssi < -128:
            raise ValueError("RSSI fora da faixa valida")
        if rssi >= -50:
            return "MUITO_PERTO"
        if rssi >= -70:
            return "PERTO"
        if rssi >= -90:
            return "MEDIO_OU_DISTANTE"
        return "MUITO_FRACO"

    def estimate(self, observations: Iterable[RssiObservation]) -> LocationEstimate:
        latest = {observation.anchor_id: observation for observation in observations}
        usable = [(self.anchors[key], value) for key, value in latest.items() if key in self.anchors]
        if len(usable) < 3:
            raise ValueError("Sao necessarias pelo menos 3 ancoras para estimar coordenadas")

        positions = np.array([[anchor.x, anchor.y] for anchor, _ in usable], dtype=float)
        if not np.isfinite(positions).all() or np.linalg.matrix_rank(positions - positions.mean(axis=0)) < 2:
            raise ValueError("As ancoras precisam formar uma geometria 2D nao colinear")
        distances = np.array(
            [self.distance_from_rssi(observation.rssi_dbm, anchor) for anchor, observation in usable],
            dtype=float,
        )

        weights = 1.0 / np.maximum(distances, 0.25)
        point = np.average(positions, axis=0, weights=weights)
        for _ in range(35):
            vectors = point - positions
            modeled = np.linalg.norm(vectors, axis=1)
            modeled = np.maximum(modeled, 1e-6)
            residual = modeled - distances
            jacobian = vectors / modeled[:, None]
            robust = 1.0 / np.maximum(1.0, np.abs(residual))
            weighted_j = jacobian * robust[:, None]
            weighted_r = residual * robust
            delta, *_ = np.linalg.lstsq(weighted_j, -weighted_r, rcond=None)
            point += delta
            if float(np.linalg.norm(delta)) < 1e-5:
                break

        final_residual = np.linalg.norm(point - positions, axis=1) - distances
        rmse = float(np.sqrt(np.mean(final_residual**2)))
        geometry = float(np.linalg.cond((positions - positions.mean(axis=0)).T @ (positions - positions.mean(axis=0))))
        geometry_penalty = min(3.0, math.sqrt(max(1.0, geometry)) / 2.0)
        error_radius = max(0.75, rmse * 2.0 + geometry_penalty * 0.35)
        if len(usable) >= 4 and error_radius <= 1.5:
            confidence = "MEDIA"
        else:
            confidence = "BAIXA"
        return LocationEstimate(
            x=round(float(point[0]), 3),
            y=round(float(point[1]), 3),
            error_radius_m=round(error_radius, 3),
            residual_rmse_m=round(rmse, 3),
            confidence=confidence,
            anchors_used=len(usable),
        )


def simulate_rssi(
    anchor: Anchor,
    target_x: float,
    target_y: float,
    noise_db: float = 0.0,
    wall_loss_db: float = 0.0,
    rng: np.random.Generator | None = None,
) -> float:
    distance = max(0.05, math.hypot(target_x - anchor.x, target_y - anchor.y))
    noise = float((rng or np.random.default_rng(0)).normal(0.0, noise_db)) if noise_db else 0.0
    return float(
        anchor.tx_power_at_1m
        - 10.0 * anchor.path_loss_exponent * math.log10(distance)
        - max(0.0, wall_loss_db)
        + noise
    )
