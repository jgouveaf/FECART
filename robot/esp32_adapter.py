from __future__ import annotations

import json

from robot.robot_models import RobotCommand, RobotState


class ESP32Adapter:
    """Future communication layer. Currently serializes commands only."""

    def build_payload(
        self,
        command: RobotCommand,
        state: RobotState,
        target_id: int | None,
        linear_speed: float,
        angular_speed: float,
    ) -> str:
        return json.dumps(
            {
                "command": command.value,
                "state": state.value,
                "target_id": target_id,
                "speed": round(linear_speed, 3),
                "turn": round(angular_speed, 3),
            },
            ensure_ascii=True,
        )

    def send(self, payload: str) -> None:
        # Hardware is intentionally not implemented yet.
        return None
