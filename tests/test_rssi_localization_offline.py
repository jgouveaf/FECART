"""Etapa 8: localizacao RSSI totalmente simulada e honesta."""

from __future__ import annotations

import math
import random
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from localization.rssi_localizer import Anchor, RssiLocalizer, RssiObservation, RssiSmoother, simulate_rssi


ANCHORS = [
    Anchor("A", 0, 0),
    Anchor("B", 10, 0),
    Anchor("C", 0, 8),
    Anchor("D", 10, 8),
]


class TestRssiLocalizationOffline(unittest.TestCase):
    def test_single_receiver_only_reports_proximity_not_coordinates(self) -> None:
        localizer = RssiLocalizer(ANCHORS)
        self.assertEqual(localizer.proximity_bucket(-45), "MUITO_PERTO")
        self.assertEqual(localizer.proximity_bucket(-65), "PERTO")
        self.assertEqual(localizer.proximity_bucket(-82), "MEDIO_OU_DISTANTE")
        with self.assertRaisesRegex(ValueError, "3 ancoras"):
            localizer.estimate([RssiObservation("A", -60)])

    def test_four_anchors_estimate_known_position_with_noise(self) -> None:
        rng = np.random.default_rng(8)
        smoother = RssiSmoother(9)
        target = (4.2, 3.1)
        latest = {}
        for _ in range(25):
            for anchor in ANCHORS:
                raw = simulate_rssi(anchor, *target, noise_db=1.1, rng=rng)
                latest[anchor.anchor_id] = smoother.add(RssiObservation(anchor.anchor_id, raw))
        estimate = RssiLocalizer(ANCHORS).estimate(latest.values())
        error = math.hypot(estimate.x - target[0], estimate.y - target[1])
        self.assertLess(error, 1.0, estimate)
        self.assertEqual(estimate.anchors_used, 4)
        self.assertIn(estimate.confidence, {"BAIXA", "MEDIA"})
        self.assertGreaterEqual(estimate.error_radius_m, 0.75)

    def test_wall_loss_degrades_estimate_and_never_claims_high_confidence(self) -> None:
        target = (6.0, 4.0)
        observations = [
            RssiObservation(anchor.anchor_id, simulate_rssi(anchor, *target, wall_loss_db=8 if anchor.anchor_id in {"A", "C"} else 0))
            for anchor in ANCHORS
        ]
        estimate = RssiLocalizer(ANCHORS).estimate(observations)
        self.assertNotEqual(estimate.confidence, "ALTA")
        self.assertGreaterEqual(estimate.error_radius_m, 0.75)

    def test_invalid_rssi_and_collinear_geometry_are_rejected(self) -> None:
        localizer = RssiLocalizer(ANCHORS)
        for invalid in (math.nan, math.inf, 21, -129):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                localizer.distance_from_rssi(invalid, ANCHORS[0])
        line = RssiLocalizer([Anchor("A", 0, 0), Anchor("B", 1, 0), Anchor("C", 2, 0)])
        with self.assertRaisesRegex(ValueError, "nao colinear"):
            line.estimate([RssiObservation("A", -60), RssiObservation("B", -60), RssiObservation("C", -60)])

    def test_stress_1000_positions_remains_finite(self) -> None:
        rng = random.Random(812026)
        np_rng = np.random.default_rng(812026)
        localizer = RssiLocalizer(ANCHORS)
        for _ in range(1000):
            target = (rng.uniform(0.5, 9.5), rng.uniform(0.5, 7.5))
            observations = [
                RssiObservation(anchor.anchor_id, simulate_rssi(anchor, *target, noise_db=1.8, rng=np_rng))
                for anchor in ANCHORS
            ]
            estimate = localizer.estimate(observations)
            self.assertTrue(math.isfinite(estimate.x))
            self.assertTrue(math.isfinite(estimate.y))
            self.assertTrue(math.isfinite(estimate.error_radius_m))
            self.assertNotEqual(estimate.confidence, "ALTA")


if __name__ == "__main__":
    unittest.main(verbosity=2)
