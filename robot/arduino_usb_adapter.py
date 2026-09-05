from __future__ import annotations

import json
import time
from typing import Optional

from robot.robot_models import RobotCommand, RobotState


class ArduinoUSBAdapter:
    """Transporte USB do Arduino UNO usando o protocolo Quantum Tracker V6."""

    _COMMANDS = {
        "FRENTE": "CMD:FRENTE",
        "PARAR": "CMD:PARAR",
        "RE": "CMD:TRAS",
        "ESQUERDA": "CMD:ESQUERDA",
        "DIREITA": "CMD:DIREITA",
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
            return [port.device for port in list_ports.comports()]
        except Exception:
            return []

    @property
    def connected(self) -> bool:
        return bool(self._serial and self._serial.is_open)

    def connect(self, port: str, baudrate: int = 9600) -> tuple[bool, str]:
        if not self.allow_hardware:
            self.last_status = "Hardware bloqueado até a Etapa 10"
            return False, self.last_status
        self.disconnect()
        try:
            import serial
            self._serial = serial.Serial(port, baudrate, timeout=0.15, write_timeout=0.5)
            self.port = port
            # A abertura reinicia a maioria dos UNO. Mantém tudo parado enquanto
            # o firmware termina o boot e prepara o modo supervisionado.
            time.sleep(2.1)
            self._serial.reset_input_buffer()
            for line in ("HELLO", "ESTOP", "CMD:PARAR", "MODE:2"):
                self._serial.write(f"{line}\n".encode("ascii"))
            self._serial.flush()
            self.last_status = f"Arduino UNO conectado em {port} · bloqueado por ESTOP"
            return True, self.last_status
        except Exception as exc:
            self._serial = None
            self.port = None
            self.last_status = f"Falha ao conectar: {exc}"
            return False, self.last_status

    def release_emergency_stop(self) -> bool:
        if not self.connected:
            return False
        try:
            self._serial.write(b"RESET_ESTOP\nCMD:PARAR\n")
            self._serial.flush()
            return True
        except Exception as exc:
            self.last_status = f"Erro serial: {exc}"
            self.disconnect()
            return False

    def disconnect(self) -> None:
        if self._serial:
            try:
                self._serial.write(b"ESTOP\n")
                self._serial.flush()
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
        return json.dumps({
            "command": command.value,
            "state": state.value,
            "target_id": target_id,
            "speed": round(linear_speed, 3),
            "turn": round(angular_speed, 3),
            "transport": "ARDUINO_UNO_USB_V6",
        }, ensure_ascii=True)

    def send(self, payload: str) -> None:
        if not self.connected:
            return
        try:
            command = json.loads(payload).get("command", "PARAR")
            serial_command = self._COMMANDS.get(command, "CMD:PARAR")
            self._serial.write(f"{serial_command}\n".encode("ascii"))
            self._serial.flush()
            while self._serial.in_waiting:
                line = self._serial.readline().decode("utf-8", errors="replace").strip()
                if line:
                    self.last_status = line
        except Exception as exc:
            self.last_status = f"Erro serial: {exc}"
            self.disconnect()
