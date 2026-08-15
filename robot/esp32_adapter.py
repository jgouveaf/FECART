from __future__ import annotations

import json
from typing import Optional

from robot.robot_models import RobotCommand, RobotState


class ESP32Adapter:
    """USB serial transport for the Arduino UNO robot (name retained for compatibility)."""

    _COMMANDS = {
        "FRENTE": "F",
        "PARAR": "S",
        "RE": "B",
        "ESQUERDA": "L",
        "DIREITA": "R",
    }

    def __init__(self, allow_hardware: bool = False) -> None:
        self.allow_hardware = bool(allow_hardware)
        self._serial = None
        self.port: Optional[str] = None
        self.last_status = "Desconectado"

    def available_ports(self) -> list[str]:
        if not self.allow_hardware:
            return []
        try:
            from serial.tools import list_ports

            # Bluetooth virtual COM ports are not Arduino USB devices and
            # commonly remain busy, causing confusing connection errors.
            return [
                port.device
                for port in list_ports.comports()
                if "bluetooth" not in f"{port.description} {port.hwid}".lower()
            ]
        except Exception:
            return []

    @property
    def connected(self) -> bool:
        return bool(self._serial and self._serial.is_open)

    def connect(self, port: str, baudrate: int = 115200) -> tuple[bool, str]:
        if not self.allow_hardware:
            self.last_status = "Hardware bloqueado ate a Etapa 10"
            return False, self.last_status
        self.disconnect()
        try:
            import serial

            self._serial = serial.Serial(port, baudrate, timeout=0.15, write_timeout=0.5)
            self.port = port
            self._serial.reset_input_buffer()
            self._serial.write(b"S\n")  # Always connect in a safe stopped state.
            self.last_status = f"Arduino conectado em {port}"
            return True, self.last_status
        except Exception as exc:
            self._serial = None
            self.port = None
            self.last_status = f"Falha ao conectar: {exc}"
            return False, self.last_status

    def disconnect(self) -> None:
        if self._serial:
            try:
                self._serial.write(b"S\n")
                self._serial.close()
            except Exception:
                pass
        self._serial = None
        self.port = None
        self.last_status = "Desconectado"

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
        if not self.connected:
            return
        try:
            command = json.loads(payload).get("command", "PARAR")
            serial_command = self._COMMANDS.get(command, "S")
            self._serial.write(f"{serial_command}\n".encode("ascii"))
            self._serial.flush()
            while self._serial.in_waiting:
                line = self._serial.readline().decode("utf-8", errors="replace").strip()
                if line:
                    self.last_status = line
        except Exception as exc:
            self.last_status = f"Erro serial: {exc}"
            self.disconnect()
