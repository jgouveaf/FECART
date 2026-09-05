"""Contrato offline do transporte Arduino UNO; nunca abre uma porta real."""

from __future__ import annotations

import json
import unittest

from robot.arduino_usb_adapter import ArduinoUSBAdapter
from robot.robot_models import RobotCommand, RobotState


class TestArduinoUSBAdapter(unittest.TestCase):
    def test_hardware_is_blocked_by_default(self) -> None:
        adapter = ArduinoUSBAdapter()
        self.assertEqual(adapter.available_ports(), [])
        ok, _ = adapter.connect("COM5")
        self.assertFalse(ok)
        self.assertFalse(adapter.connected)

    def test_protocol_is_uno_v6_at_9600_baud(self) -> None:
        self.assertEqual(ArduinoUSBAdapter._COMMANDS["FRENTE"], "CMD:FRENTE")
        self.assertEqual(ArduinoUSBAdapter._COMMANDS["RE"], "CMD:TRAS")
        self.assertEqual(ArduinoUSBAdapter.connect.__defaults__, (9600,))

    def test_payload_identifies_the_real_transport(self) -> None:
        adapter = ArduinoUSBAdapter()
        payload = json.loads(adapter.build_payload(
            RobotCommand.STOP, RobotState.STOPPED, None, 0.0, 0.0,
        ))
        self.assertEqual(payload["command"], "PARAR")
        self.assertEqual(payload["transport"], "ARDUINO_UNO_USB_V6")


if __name__ == "__main__":
    unittest.main()
