from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np

from core.models import Detection
from robot.robot_models import RobotCommand
from simulator.visual_simulator import SimTarget, VisualSimulator


class SyntheticWorld:
    """Synthetic test world adapter wrapping VisualSimulator for the demo."""

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width = width
        self.height = height
        self.sim = VisualSimulator(width, height)

    @property
    def targets(self) -> List[SimTarget]:
        return self.sim.targets

    def reset(self) -> None:
        self.sim.reset()

    def force_occlusion(self) -> None:
        self.sim.force_occlusion()

    def send_robot_command(self, command: RobotCommand) -> None:
        self.sim.send_robot_command(command)

    @property
    def obstacle_distance_cm(self) -> float:
        return self.sim.obstacle_distance_cm()

    def next_frame(self) -> Tuple[np.ndarray, List[Detection]]:
        frame, detections, _ghost_preds = self.sim.step()
        return frame, detections
