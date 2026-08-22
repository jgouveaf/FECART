"""Audita a integração web/Arduino sem abrir câmera, Bluetooth ou porta USB."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TestWebRobotControlOffline(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.robot_js = (ROOT / "web" / "robot-control.js").read_text(encoding="utf-8")
        cls.camera_js = (ROOT / "web" / "camera-gestures.js").read_text(encoding="utf-8")
        cls.face_js = (ROOT / "web" / "face-identities.js").read_text(encoding="utf-8")
        cls.firmware = (ROOT / "firmware" / "quantum_tracker_arduino" / "quantum_tracker_arduino.ino").read_text(encoding="utf-8")
        bundle = (ROOT / "web" / "arduino-codes.js").read_text(encoding="utf-8")
        cls.bundle = json.loads(bundle.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])

    def test_interface_has_two_exclusive_camera_tabs(self) -> None:
        self.assertIn('data-camera-view="face"', self.html)
        self.assertIn('data-camera-view="hand"', self.html)
        self.assertIn('id="faceCameraPanel"', self.html)
        self.assertIn('id="gestureCameraPanel"', self.html)
        self.assertIn("facePanel.hidden", self.camera_js)
        self.assertIn("gesturePanel.hidden", self.camera_js)

    def test_only_active_camera_pipeline_runs(self) -> None:
        self.assertIn('activeView !== "hand"', self.camera_js)
        self.assertIn('activeView !== "face"', self.face_js)
        self.assertIn("clearTimeout(detectionTimer)", self.face_js)
        self.assertIn("cancelAnimationFrame(animationId)", self.camera_js)

    def test_three_modes_are_exposed_in_interface_and_firmware(self) -> None:
        self.assertEqual(self.html.count('data-robot-mode="'), 3)
        for number, enum_name in ((1, "MODO_AUTONOMO"), (2, "MODO_SEGUIR"), (3, "MODO_GESTOS")):
            self.assertIn(f'data-robot-mode="{number}"', self.html)
            self.assertRegex(self.firmware, rf"{enum_name}\s*=\s*{number}")

    def test_web_serial_requires_explicit_user_selection_and_9600_baud(self) -> None:
        self.assertIn("navigator.serial.requestPort()", self.robot_js)
        self.assertIn("port.open({ baudRate: 9600", self.robot_js)
        self.assertIn('connectButton.addEventListener("click"', self.robot_js)
        self.assertIn("event.port === port || event.target === port", self.robot_js)
        self.assertIn('requestMode(next.dataset.robotMode, "keyboard")', self.robot_js)
        self.assertNotIn("navigator.serial.requestPort()", self.camera_js)
        self.assertNotIn("navigator.serial.requestPort()", self.face_js)

    def test_gesture_commands_are_forwarded_only_in_mode_three(self) -> None:
        for command in ("FRENTE", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"):
            self.assertIn(f'"{command}"', self.camera_js)
            self.assertIn(f'CMD:{command}', self.firmware)
        self.assertIn('if (!mayAcceptInput(3, detail)) return', self.robot_js)
        self.assertIn('detail.stable !== true', self.robot_js)
        self.assertIn('Number(detail.confidence) < 0.60', self.robot_js)
        self.assertIn('quantum:gesture-command', self.robot_js)

    def test_person_tracking_drives_only_mode_two_and_stops_when_lost(self) -> None:
        self.assertIn('if (!mayAcceptInput(2, detail)) return', self.robot_js)
        self.assertIn('acceptIntent(detail.visible ? detail.command : "PARAR"', self.robot_js)
        self.assertIn('Number(detail.confidence) < 0.45', self.robot_js)
        self.assertIn('center < 0.38 ? "ESQUERDA"', self.face_js)
        self.assertIn('center > 0.62 ? "DIREITA"', self.face_js)
        self.assertIn('visible: false, command: "PARAR"', self.face_js)

    def test_command_heartbeat_is_fail_safe(self) -> None:
        self.assertRegex(self.robot_js, r"INPUT_TIMEOUT_MS\s*=.*\|\|\s*900")
        self.assertRegex(self.firmware, r"TIMEOUT_COMANDO_MS\s*=\s*1500UL")
        self.assertIn("lastFreshInputAt", self.robot_js)
        watchdog = self.robot_js.split("function watchdogTick()", 1)[1].split("async function toggleEmergency", 1)[0]
        self.assertIn("performance.now() - lastFreshInputAt <= INPUT_TIMEOUT_MS", watchdog)
        self.assertIn('sendMotion("PARAR")', watchdog)
        self.assertNotIn("acceptIntent(", watchdog)
        self.assertIn('lastIntent = "PARAR"', self.robot_js)
        self.assertIn("agora - ultimoComandoEm > TIMEOUT_COMANDO_MS", self.firmware)
        self.assertIn("comandoRecebido = CMD_PARAR", self.firmware)

    def test_emergency_stop_interrupts_web_and_firmware(self) -> None:
        self.assertIn('id="emergencyStop"', self.html)
        self.assertIn('transact("ESTOP", (line) => line === "OK:ESTOP"', self.robot_js)
        self.assertIn('transact("RESET_ESTOP", (line) => line === "OK:RESET_ESTOP"', self.robot_js)
        self.assertIn('new TextEncoder().encode("ESTOP\\n")', self.robot_js)
        self.assertIn('strcmp(linha, "ESTOP")', self.firmware)
        self.assertIn("paradaEmergencia = true", self.firmware)
        self.assertRegex(self.firmware, r"if \(paradaEmergencia \|\| !sensorSeguro\(\)\)\s*\{\s*pararMotores\(\)")

    def test_serial_handshake_and_mode_commit_require_acknowledgement(self) -> None:
        self.assertIn('REQUIRED_FIRMWARE_READY = "QT:READY:V3"', self.robot_js)
        self.assertIn('enqueueLine("HELLO"', self.robot_js)
        self.assertIn('readyLine !== REQUIRED_FIRMWARE_READY', self.robot_js)
        self.assertIn('CONFIRME A LIBERAÇÃO', self.robot_js)
        self.assertNotIn('label: "liberação segura"', self.robot_js)
        self.assertIn('line === `OK:MODE:${nextMode}`', self.robot_js)
        self.assertIn('control?.commitMode?.(nextMode', self.robot_js)
        mode_transition = self.robot_js.split("async function executeModeTransition", 1)[1].split("function requestMode", 1)[0]
        estop_index = mode_transition.index('transact("ESTOP"')
        stop_index = mode_transition.index('transact("CMD:PARAR"')
        mode_ack_index = mode_transition.index('transact(`MODE:${nextMode}`')
        commit_index = mode_transition.index('control?.commitMode?.(nextMode')
        self.assertLess(estop_index, stop_index)
        self.assertLess(mode_ack_index, commit_index)
        self.assertIn("control?.rejectMode?.(error", mode_transition)

    def test_motion_requires_ack_and_fails_closed(self) -> None:
        self.assertIn('transact(`CMD:${command}`', self.robot_js)
        self.assertIn('line === `OK:CMD:${command}`', self.robot_js)
        self.assertIn('consecutiveMotionFailures >= 2', self.robot_js)
        self.assertIn('Dois comandos de movimento ficaram sem confirmação', self.robot_js)

    def test_stale_events_and_split_brain_fail_closed(self) -> None:
        self.assertIn("connectionGeneration", self.robot_js)
        self.assertIn("operationGeneration", self.robot_js)
        self.assertIn("modeGeneration", self.robot_js)
        self.assertIn("eventIsFresh(detail)", self.robot_js)
        self.assertIn("firmwareMode !== activeMode", self.robot_js)
        fail_closed = self.robot_js.split("function failClosed", 1)[1].split("function parseTelemetry", 1)[0]
        self.assertIn('setConnection("FALHA DE SINCRONIZAÇÃO", "ERROR"', fail_closed)
        self.assertIn('enqueueLine("ESTOP"', fail_closed)

    def test_ultrasonic_sensor_remains_above_external_commands(self) -> None:
        self.assertRegex(self.firmware, r"LIMITE_FALHAS_SENSOR\s*=\s*5")
        self.assertIn("obstaculoConfirmado()", self.firmware)
        self.assertIn("iniciarDesvio(agora)", self.firmware)
        sensor_guard = self.firmware.index("if (paradaEmergencia || !sensorSeguro())")
        command_application = self.firmware.index("aplicarComando(desejado)")
        self.assertLess(sensor_guard, command_application)

    def test_firmware_loop_has_no_blocking_movement_delays(self) -> None:
        loop = self.firmware.split("void loop()", 1)[1]
        self.assertNotIn("delay(", loop)
        self.assertIn("atualizarDesvio(agora)", loop)
        self.assertIn("lerSerial(agora)", loop)

    def test_five_obstacles_in_window_trigger_latched_stop(self) -> None:
        self.assertRegex(self.firmware, r"LIMITE_OBSTACULOS\s*=\s*5")
        self.assertRegex(self.firmware, r"JANELA_OBSTACULOS_MS\s*=\s*15000UL")
        self.assertIn('Serial.println(F("ALERTA:5_OBSTACULOS"))', self.firmware)
        self.assertIn("registrarObstaculo(agora)", self.firmware)

    def test_firmware_protocol_and_telemetry_are_complete(self) -> None:
        for token in ("HELLO", "MODE:1", "MODE:2", "MODE:3", "CMD:FRENTE", "CMD:PARAR", "ESTOP", "RESET_ESTOP", "PING", "STATUS"):
            self.assertIn(token, self.firmware)
        for field in ("QT|MODE:", "|DIST:", "|CMD:", "|STATE:"):
            self.assertIn(field, self.firmware)
        self.assertIn("parseTelemetry", self.robot_js)

    def test_bluetooth_rssi_is_never_used_as_a_direction_command(self) -> None:
        self.assertIn("watchAdvertisements", self.robot_js)
        self.assertIn("event.rssi", self.robot_js)
        self.assertIn("O sinal informa proximidade, não direção", self.html)
        beacon_handler = self.robot_js.split('beaconDevice.addEventListener("advertisementreceived"', 1)[1].split("});", 1)[0]
        self.assertNotIn("sendLine", beacon_handler)
        self.assertNotIn("deliverIntent", beacon_handler)

    def test_generated_web_bundle_contains_exact_integrated_firmware(self) -> None:
        relative = "firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino"
        self.assertEqual(self.bundle[relative], self.firmware)


if __name__ == "__main__":
    unittest.main(verbosity=2)
