from __future__ import annotations

import math

from robot.robot_models import RobotCommand, RobotPose


class RobotSimulator:
    """Small logical simulator for robot pose and current command."""

    def __init__(self) -> None:
        self.pose = RobotPose()

    def reset(self) -> None:
        self.pose = RobotPose()

    def update(self, command: RobotCommand, linear_speed: float, angular_speed: float) -> RobotPose:
        self.pose.heading_degrees = (self.pose.heading_degrees + angular_speed * 8.0) % 360.0
        heading_rad = math.radians(self.pose.heading_degrees)
        direction = -1.0 if command == RobotCommand.REVERSE else 1.0
        if command in {RobotCommand.FORWARD, RobotCommand.REVERSE}:
            self.pose.x += math.cos(heading_rad) * linear_speed * 8.0 * direction
            self.pose.y += math.sin(heading_rad) * linear_speed * 8.0 * direction
        return RobotPose(self.pose.x, self.pose.y, self.pose.heading_degrees)
