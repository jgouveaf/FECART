from __future__ import annotations

import queue
import shutil
import threading
import time
from html import escape
from pathlib import Path
from typing import List, Optional

import numpy as np
from PySide6.QtCore import Qt, QThread, QTimer, Signal
from PySide6.QtGui import QIcon, QImage, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFileDialog,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSplashScreen,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from biometrics.face_recognition import FaceRecognizer
from biometrics.registration_service import IdentityRegistrationService
from brain.quantum_brain import QuantumBrain
from brain.speech_listener import SpeechListener
from brain.tactical_voice import TacticalVoice
from core.models import Detection, EventType, SystemEvent, SystemSnapshot, TargetState
from database.database_manager import DatabaseManager
from hud.tactical_hud import TacticalHUD
from recognition.identity_resolver import IdentityResolver
from robot.robot_controller import RobotController
from robot.robot_models import RobotCommand, RobotTelemetry
from services.snapshot_service import SnapshotService
from simulator.synthetic_world import SyntheticWorld
from tracker.track_manager import TrackManager
from tracker.tracker_wrapper import TrackerWrapper
from tracker.yolo_tracker import YoloPersonTracker
from utils.config import load_config
from utils.logger import setup_logger
from vision.gesture_recognizer import GestureRecognizer
from vision.gesture_trainer import GestureTrainer
from app.splash_screen import QuantumSplash
from brain.gemini_assistant import GeminiAssistant


class QuantumApp:
    def __init__(self) -> None:
        self.qt_app = QApplication.instance() or QApplication([])

        # ── App icon ─────────────────────────────────────────────────
        _logo_path = str(Path(__file__).resolve().parents[1] / "assets" / "quantum_tracker.ico")
        _logo_png  = str(Path(__file__).resolve().parents[1] / "assets" / "logo.png")
        icon_path  = _logo_path if Path(_logo_path).exists() else _logo_png
        if Path(icon_path).exists():
            self.qt_app.setWindowIcon(QIcon(icon_path))

        # ── Animated Splash screen (3.0 seconds transition) ───────────
        self._splash = QuantumSplash()
        self._splash.show()
        self.qt_app.processEvents()

        t0 = time.time()
        # Build main window while rendering smooth progress over 3s
        self.window = QuantumMainWindow()

        while time.time() - t0 < 3.0:
            pct = min(1.0, (time.time() - t0) / 3.0)
            self._splash.set_progress(pct)
            self.qt_app.processEvents()
            time.sleep(0.015)

    def run(self) -> None:
        self.window.show()
        self._splash.finish(self.window)
        self._splash._timer.stop()
        self.qt_app.exec()


class QuantumMainWindow(QMainWindow):
    """PySide6 desktop app for the Quantum Tracker demo."""

    def __init__(self) -> None:
        super().__init__()
        self.config = load_config()
        self.logger = setup_logger("quantum-app", self.config.logs_dir)
        self.db = DatabaseManager(self.config.database_path)
        self.voice = TacticalVoice(enabled=self.config.voice_enabled)
        self.brain = QuantumBrain(self.config)
        self.gemini = GeminiAssistant(self.config)
        self.hud = TacticalHUD()
        self.tracker = TrackerWrapper(self.config)
        self.detector = self.tracker.detector
        self.track_manager = self.tracker.track_manager
        self.faces = FaceRecognizer(self.config, self.db)
        self.registration_service = IdentityRegistrationService(self.config, self.db, self.faces)
        self.identity_resolver = IdentityResolver()
        self.snapshot_service = SnapshotService()
        self.robot_controller = RobotController(allow_hardware=self.config.hardware_enabled)
        self.gestures = GestureRecognizer(assets_dir=self.config.assets_dir)
        self.gesture_trainer = GestureTrainer(self.config.assets_dir)
        self.world = SyntheticWorld(self.config.frame_width, self.config.frame_height)
        self.speech_queue: "queue.Queue[str]" = queue.Queue()
        self.speech = SpeechListener(self.speech_queue.put)

        self.capture = None
        self.register_capture = None
        self.mode = "idle"
        self.running = False
        self.frame_counter = 0
        self.last_frame_time = time.perf_counter()
        self.fps = 0.0
        self.current_frame: Optional[np.ndarray] = None
        self.register_frame: Optional[np.ndarray] = None
        self.last_gesture = ""
        self.last_gesture_time = 0.0
        self.active_gesture_command: Optional[str] = None
        self.current_targets = []
        self.current_robot_telemetry: Optional[RobotTelemetry] = None
        self._cached_recent_events: list = []
        self._cached_stats: dict = {}
        self._last_stats_time: float = 0.0

        self.timer = QTimer(self)
        self.timer.timeout.connect(self._loop)
        self.register_timer = QTimer(self)
        self.register_timer.timeout.connect(self._register_preview_loop)
        self.speech_timer = QTimer(self)
        self.speech_timer.timeout.connect(self._poll_speech)
        self.robot_heartbeat_timer = QTimer(self)
        self.robot_heartbeat_timer.timeout.connect(self._send_robot_heartbeat)

        self._build_ui()
        self._apply_style()
        self.voice.start()
        self.speech_timer.start(400)
        self.robot_heartbeat_timer.start(250)

    def _build_ui(self) -> None:
        self.setWindowTitle("QUANTUM TRACKER · TESTE 1.0")
        # Set window icon
        _ico = self.config.assets_dir / "quantum_tracker_v5.ico"
        _png = self.config.assets_dir / "logo.png"
        _icon_path = _ico if _ico.exists() else _png
        if _icon_path.exists():
            self.setWindowIcon(QIcon(str(_icon_path)))
        self.resize(1360, 860)
        central = QWidget()
        root = QVBoxLayout(central)
        root.setContentsMargins(14, 12, 14, 14)
        root.setSpacing(10)

        header = QHBoxLayout()
        header.setSpacing(12)

        # Logo image in header
        _logo_file = self.config.assets_dir / "logo.png"
        if _logo_file.exists():
            logo_label = QLabel()
            logo_pix = QPixmap(str(_logo_file)).scaled(48, 48, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            logo_label.setPixmap(logo_pix)
            logo_label.setFixedSize(48, 48)
            header.addWidget(logo_label)

        title = QLabel("QUANTUM TRACKER  |  TESTE 1.0")
        title.setObjectName("Title")
        self.status_label = QLabel("Sistema pronto")
        self.status_label.setObjectName("Status")
        header.addWidget(title)
        header.addStretch(1)
        header.addWidget(self.status_label)
        root.addLayout(header)

        self.tabs = QTabWidget()
        root.addWidget(self.tabs, 1)
        self.tabs.addTab(self._build_monitor_tab(), "📊 Monitoramento")
        self.tabs.addTab(self._build_robot_tab(), "🤖 Controle Robô")
        self.tabs.addTab(self._build_register_tab(), "👤 Cadastro Facial")
        self.tabs.addTab(self._build_photos_tab(), "🖼️ Galeria")
        self.tabs.addTab(self._build_logs_tab(), "📜 Eventos & Logs")
        self.tabs.addTab(self._build_ai_tab(), "📊 Análise Tática")
        self.tabs.addTab(self._build_gesture_trainer_tab(), "🎯 Treinar Gestos")
        self.tabs.addTab(self._build_config_tab(), "⚙️ Configurações")

        self.setCentralWidget(central)

    def _build_monitor_tab(self) -> QWidget:
        """Main tactical video monitoring tab."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(0)
        outer.setContentsMargins(0, 0, 0, 0)

        # Toolbar
        toolbar = QFrame()
        toolbar.setStyleSheet(
            "QFrame { background:qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #0d1726, stop:1 #111827); "
            "border-bottom:1px solid #244466; border-radius:0; }"
        )
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(16, 10, 16, 10)

        self.start_camera_btn = QPushButton("▶ INICIAR CÂMERA")
        self.start_camera_btn.setFixedHeight(34)
        self.start_camera_btn.clicked.connect(self.start_camera)

        self.start_sim_btn = QPushButton("🎮 INICIAR SIMULADOR")
        self.start_sim_btn.setFixedHeight(34)
        self.start_sim_btn.clicked.connect(self.start_simulator)

        ghost_btn = QPushButton("👻 FORÇAR GHOST")
        ghost_btn.setFixedHeight(34)
        ghost_btn.clicked.connect(self.world.force_occlusion)

        stop_btn = QPushButton("■ PARAR SISTEMA")
        stop_btn.setFixedHeight(34)
        stop_btn.setStyleSheet(
            "QPushButton { background:#2d1111; color:#ff9999; border:1px solid #663333; font-weight:800; }"
            "QPushButton:hover { background:#441a1a; color:#ffffff; }"
        )
        stop_btn.clicked.connect(self.stop)

        toolbar_layout.addWidget(self.start_camera_btn)
        toolbar_layout.addSpacing(8)
        toolbar_layout.addWidget(self.start_sim_btn)
        toolbar_layout.addSpacing(8)
        toolbar_layout.addWidget(ghost_btn)
        toolbar_layout.addStretch(1)
        toolbar_layout.addWidget(stop_btn)
        outer.addWidget(toolbar)

        # Body
        body = QHBoxLayout()
        body.setContentsMargins(12, 12, 12, 12)
        body.setSpacing(12)

        self.video_label = QLabel("Clique em ▶ INICIAR CÂMERA ou 🎮 INICIAR SIMULADOR para iniciar a visão")
        self.video_label.setObjectName("Video")
        self.video_label.setAlignment(Qt.AlignCenter)
        self.video_label.setMinimumSize(860, 520)
        body.addWidget(self.video_label, 4)

        side = QVBoxLayout()
        side.setSpacing(8)

        # Card: Target Info
        card_target = QFrame()
        card_target.setObjectName("SideCard")
        card_layout = QVBoxLayout(card_target)
        card_layout.setContentsMargins(12, 10, 12, 10)
        card_layout.setSpacing(4)

        lbl_card = QLabel("ALVO PRIMÁRIO")
        lbl_card.setObjectName("CardHeader")
        card_layout.addWidget(lbl_card)

        self.lbl_target_id    = QLabel("ID: —")
        self.lbl_target_name  = QLabel("Nome: —")
        self.lbl_target_conf  = QLabel("Confiança: —")
        self.lbl_target_dist  = QLabel("Distância: —")
        self.lbl_target_state = QLabel("Estado: —")
        self.lbl_target_speed = QLabel("Velocidade: —")
        for lbl in (self.lbl_target_id, self.lbl_target_name, self.lbl_target_conf,
                    self.lbl_target_dist, self.lbl_target_state, self.lbl_target_speed):
            lbl.setObjectName("InfoValue")
            card_layout.addWidget(lbl)
        side.addWidget(card_target)

        # Card: System
        card_sys = QFrame()
        card_sys.setObjectName("SideCard")
        sys_layout = QVBoxLayout(card_sys)
        sys_layout.setContentsMargins(12, 10, 12, 10)
        sys_layout.setSpacing(4)

        lbl_sys = QLabel("SISTEMA")
        lbl_sys.setObjectName("CardHeader")
        sys_layout.addWidget(lbl_sys)

        self.lbl_fps        = QLabel("FPS: —")
        self.lbl_mode       = QLabel("Modo: —")
        self.lbl_targets_n  = QLabel("Alvos: 0")
        self.lbl_ghost_mode = QLabel("Ghost: INATIVO")
        for lbl in (self.lbl_fps, self.lbl_mode, self.lbl_targets_n, self.lbl_ghost_mode):
            lbl.setObjectName("InfoValue")
            sys_layout.addWidget(lbl)
        side.addWidget(card_sys)

        # Event Stream
        lbl_events = QLabel("EVENTOS RECENTES")
        lbl_events.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        side.addWidget(lbl_events)

        self.event_stream = QTextEdit()
        self.event_stream.setReadOnly(True)
        self.event_stream.setObjectName("PanelText")
        self.event_stream.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#aaaaaa; font-family:Consolas; font-size:11px; padding:6px; }"
        )
        side.addWidget(self.event_stream, 1)

        # Telemetria completa
        lbl_telem = QLabel("TELEMETRIA COMPLETA")
        lbl_telem.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        side.addWidget(lbl_telem)

        self.monitor_info = QTextEdit()
        self.monitor_info.setReadOnly(True)
        self.monitor_info.setObjectName("PanelText")
        self.monitor_info.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#00ff88; font-family:Consolas; font-size:11px; padding:6px; }"
        )
        side.addWidget(self.monitor_info, 1)

        body.addLayout(side, 1)
        outer.addLayout(body, 1)
        return page

    def _build_robot_tab(self) -> QWidget:
        """Robot control & telemetry tab with modern card-based layout."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(0)
        outer.setContentsMargins(0, 0, 0, 0)

        # ── Toolbar ──────────────────────────────────────────────────
        toolbar = QFrame()
        toolbar.setStyleSheet("QFrame { background:#141414; border-bottom:1px solid #2d2d2d; border-radius:0; }")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(16, 10, 16, 10)

        title_lbl = QLabel("CONTROLE E TELEMETRIA DO ROBÔ")
        title_lbl.setStyleSheet("color:#ffffff; font-size:14px; font-weight:800; letter-spacing:3px;")
        
        self.robot_status_chip = QLabel("MODO: SIMULADOR")
        self.robot_status_chip.setStyleSheet(
            "color:#00e5ff; font-size:10px; font-weight:700; letter-spacing:1px;"
            "background:#0a1e28; border:1px solid #1a3e50; border-radius:3px; padding:3px 8px;"
        )

        toolbar_layout.addWidget(title_lbl)
        toolbar_layout.addSpacing(12)
        toolbar_layout.addWidget(self.robot_status_chip)
        toolbar_layout.addSpacing(12)
        self.arduino_port_combo = QComboBox()
        self.arduino_port_combo.setMinimumWidth(100)
        self.arduino_port_combo.setToolTip("Porta USB do Arduino UNO")
        self.arduino_refresh_btn = QPushButton("↻")
        self.arduino_refresh_btn.setToolTip("Atualizar portas USB")
        self.arduino_refresh_btn.clicked.connect(self.refresh_arduino_ports)
        self.arduino_connect_btn = QPushButton("CONECTAR ARDUINO")
        self.arduino_connect_btn.clicked.connect(self.toggle_arduino_connection)
        toolbar_layout.addWidget(self.arduino_port_combo)
        toolbar_layout.addWidget(self.arduino_refresh_btn)
        toolbar_layout.addWidget(self.arduino_connect_btn)
        toolbar_layout.addStretch()
        outer.addWidget(toolbar)
        self.refresh_arduino_ports()

        # ── Body ─────────────────────────────────────────────────────
        body = QHBoxLayout()
        body.setSpacing(0)
        body.setContentsMargins(0, 0, 0, 0)
        outer.addLayout(body, 1)

        # Left Column: Controls & Target
        left_frame = QFrame()
        left_frame.setFixedWidth(360)
        left_frame.setStyleSheet("QFrame { background:#0e0e0e; border-right:1px solid #2d2d2d; border-radius:0; }")
        left_layout = QVBoxLayout(left_frame)
        left_layout.setContentsMargins(16, 16, 16, 16)
        left_layout.setSpacing(14)
        body.addWidget(left_frame)

        # Target Selection Section
        target_lbl = QLabel("SELEÇÃO DE ALVO")
        target_lbl.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        left_layout.addWidget(target_lbl)

        target_row1 = QHBoxLayout()
        self.target_id_input = QLineEdit()
        self.target_id_input.setPlaceholderText("ID do alvo (ex: 1)")
        self.target_id_input.setMinimumHeight(34)
        
        select_id_btn = QPushButton("SELECIONAR ID")
        select_id_btn.setFixedHeight(34)
        select_id_btn.clicked.connect(self.select_robot_target_by_id)
        
        target_row1.addWidget(self.target_id_input, 1)
        target_row1.addWidget(select_id_btn)
        left_layout.addLayout(target_row1)

        target_row2 = QHBoxLayout()
        select_first_btn = QPushButton("PRIMEIRO ALVO")
        select_first_btn.setFixedHeight(34)
        select_first_btn.clicked.connect(self.select_first_robot_target)

        clear_btn = QPushButton("LIBERAR ALVO")
        clear_btn.setFixedHeight(34)
        clear_btn.setStyleSheet(
            "QPushButton { background:#2d1111; color:#ff9999; border:1px solid #663333; }"
            "QPushButton:hover { background:#441a1a; color:#ffffff; }"
        )
        clear_btn.clicked.connect(self.clear_robot_target)

        target_row2.addWidget(select_first_btn, 1)
        target_row2.addWidget(clear_btn, 1)
        left_layout.addLayout(target_row2)

        left_layout.addSpacing(6)

        # Mode Action Buttons
        mode_row = QHBoxLayout()
        follow_btn = QPushButton("▶ SEGUIR ALVO")
        follow_btn.setMinimumHeight(38)
        follow_btn.setStyleSheet(
            "QPushButton { background:#ffffff; color:#000000; border:none; font-weight:800; }"
            "QPushButton:hover { background:#cccccc; }"
        )
        follow_btn.clicked.connect(self.robot_follow)

        stop_btn = QPushButton("■ PARAR SEGUIMENTO")
        stop_btn.setMinimumHeight(38)
        stop_btn.clicked.connect(self.robot_stop)

        mode_row.addWidget(follow_btn, 1)
        mode_row.addWidget(stop_btn, 1)
        left_layout.addLayout(mode_row)

        left_layout.addSpacing(10)

        # Manual D-PAD Controller
        dpad_lbl = QLabel("PILOTAGEM MANUAL (D-PAD)")
        dpad_lbl.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        left_layout.addWidget(dpad_lbl)

        dpad_grid = QGridLayout()
        dpad_grid.setSpacing(6)

        btn_fwd = QPushButton("▲\nFRENTE")
        btn_fwd.setFixedSize(90, 50)
        btn_fwd.clicked.connect(lambda: self.robot_manual_command(RobotCommand.FORWARD))

        btn_left = QPushButton("◄\nESQ")
        btn_left.setFixedSize(90, 50)
        btn_left.clicked.connect(lambda: self.robot_manual_command(RobotCommand.LEFT))

        btn_stop = QPushButton("●\nPARAR")
        btn_stop.setFixedSize(90, 50)
        btn_stop.setStyleSheet(
            "QPushButton { background:#2d1111; color:#ff9999; border:1px solid #663333; font-weight:800; }"
            "QPushButton:hover { background:#441a1a; color:#ffffff; }"
        )
        btn_stop.clicked.connect(lambda: self.robot_manual_command(RobotCommand.STOP))

        btn_right = QPushButton("►\nDIR")
        btn_right.setFixedSize(90, 50)
        btn_right.clicked.connect(lambda: self.robot_manual_command(RobotCommand.RIGHT))

        btn_rev = QPushButton("▼\nRÉ")
        btn_rev.setFixedSize(90, 50)
        btn_rev.clicked.connect(lambda: self.robot_manual_command(RobotCommand.REVERSE))

        dpad_grid.addWidget(btn_fwd, 0, 1)
        dpad_grid.addWidget(btn_left, 1, 0)
        dpad_grid.addWidget(btn_stop, 1, 1)
        dpad_grid.addWidget(btn_right, 1, 2)
        dpad_grid.addWidget(btn_rev, 2, 1)

        dpad_container = QWidget()
        dpad_container.setLayout(dpad_grid)
        left_layout.addWidget(dpad_container, alignment=Qt.AlignCenter)
        left_layout.addStretch(1)

        # Right Column: Telemetry & Logs
        right_frame = QFrame()
        right_frame.setStyleSheet("QFrame { background:#111111; border:none; border-radius:0; }")
        right_layout = QVBoxLayout(right_frame)
        right_layout.setContentsMargins(20, 16, 20, 16)
        right_layout.setSpacing(12)
        body.addWidget(right_frame, 1)

        # Telemetry Dashboard Title
        dash_header = QLabel("DASHBOARD DE TELEMETRIA DO ROBÔ")
        dash_header.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        right_layout.addWidget(dash_header)

        self.robot_dashboard = QTextEdit()
        self.robot_dashboard.setReadOnly(True)
        self.robot_dashboard.setObjectName("PanelText")
        self.robot_dashboard.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#00ff88; font-family:Consolas; font-size:12px; padding:10px; }"
        )
        self.robot_dashboard.setText("Robô em modo simulador. Selecione um alvo no monitoramento.")
        right_layout.addWidget(self.robot_dashboard, 1)

        log_header = QLabel("LOGS DE COMANDO E EVENTOS DO ROBÔ")
        log_header.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        right_layout.addWidget(log_header)

        self.robot_logs = QTextEdit()
        self.robot_logs.setReadOnly(True)
        self.robot_logs.setObjectName("PanelText")
        self.robot_logs.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#aaaaaa; font-family:Consolas; font-size:11px; padding:8px; }"
        )
        self.robot_logs.setText("System: Módulo de robótica inicializado.")
        right_layout.addWidget(self.robot_logs, 1)

        return page

    def _build_register_tab(self) -> QWidget:
        """Facial registration tab with modern card-based layout."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(0)
        outer.setContentsMargins(0, 0, 0, 0)

        # ── Toolbar ──────────────────────────────────────────────────
        toolbar = QFrame()
        toolbar.setStyleSheet("QFrame { background:#141414; border-bottom:1px solid #2d2d2d; border-radius:0; }")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(16, 10, 16, 10)

        title_lbl = QLabel("CADASTRO FACIAL")
        title_lbl.setStyleSheet("color:#ffffff; font-size:14px; font-weight:800; letter-spacing:3px;")
        desc_lbl = QLabel("Registre novas pessoas no banco de reconhecimento")
        desc_lbl.setStyleSheet("color:#555555; font-size:11px;")

        toolbar_layout.addWidget(title_lbl)
        toolbar_layout.addSpacing(12)
        toolbar_layout.addWidget(desc_lbl)
        toolbar_layout.addStretch()
        outer.addWidget(toolbar)

        # ── Body ─────────────────────────────────────────────────────
        body = QHBoxLayout()
        body.setSpacing(0)
        body.setContentsMargins(0, 0, 0, 0)
        outer.addLayout(body, 1)

        # Left: camera preview
        left_frame = QFrame()
        left_frame.setStyleSheet("QFrame { background:#000000; border:none; border-radius:0; }")
        left_layout = QVBoxLayout(left_frame)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(0)

        self.register_video = QLabel()
        self.register_video.setObjectName("Video")
        self.register_video.setAlignment(Qt.AlignCenter)
        self.register_video.setMinimumSize(640, 480)
        self.register_video.setStyleSheet("background:#000000; color:#333333; font-size:14px;")
        self.register_video.setText("CÂMERA INATIVA\nClique em INICIAR CÂMERA")
        left_layout.addWidget(self.register_video, 1)

        # Camera control strip at bottom of preview
        cam_strip = QFrame()
        cam_strip.setFixedHeight(44)
        cam_strip.setStyleSheet("QFrame { background:#141414; border-top:1px solid #2d2d2d; border-radius:0; }")
        cam_strip_layout = QHBoxLayout(cam_strip)
        cam_strip_layout.setContentsMargins(12, 6, 12, 6)

        preview_btn = QPushButton("▶  INICIAR CÂMERA")
        preview_btn.setFixedHeight(30)
        preview_btn.setStyleSheet(
            "QPushButton { background:#222222; color:#cccccc; border:1px solid #444444;"
            "border-radius:4px; font-size:11px; font-weight:700; padding:0 12px; }"
            "QPushButton:hover { background:#333333; border-color:#888888; color:#ffffff; }"
        )
        preview_btn.clicked.connect(self.start_register_preview)

        self.register_live_chip = QLabel("● INATIVO")
        self.register_live_chip.setStyleSheet("color:#555555; font-size:10px; font-weight:700; letter-spacing:1px;")

        cam_strip_layout.addWidget(preview_btn)
        cam_strip_layout.addSpacing(8)
        cam_strip_layout.addWidget(self.register_live_chip)
        cam_strip_layout.addStretch()
        left_layout.addWidget(cam_strip)

        body.addWidget(left_frame, 2)

        # Right: registration controls
        right_frame = QFrame()
        right_frame.setFixedWidth(300)
        right_frame.setStyleSheet("QFrame { background:#0e0e0e; border-left:1px solid #2d2d2d; border-radius:0; }")
        right_layout = QVBoxLayout(right_frame)
        right_layout.setContentsMargins(16, 16, 16, 16)
        right_layout.setSpacing(12)
        body.addWidget(right_frame)

        # Name input section
        name_lbl = QLabel("IDENTIFICAÇÃO")
        name_lbl.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        right_layout.addWidget(name_lbl)

        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("Nome completo da pessoa")
        self.name_input.setMinimumHeight(38)
        right_layout.addWidget(self.name_input)

        right_layout.addSpacing(8)

        # Capture section
        capture_lbl = QLabel("CAPTURA")
        capture_lbl.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        right_layout.addWidget(capture_lbl)

        capture_btn = QPushButton("📷  CAPTURAR FOTO")
        capture_btn.setMinimumHeight(48)
        capture_btn.setStyleSheet(
            "QPushButton { background:#1a1a1a; color:#ffffff; border:2px solid #555555;"
            "border-radius:6px; font-size:12px; font-weight:800; letter-spacing:1px; }"
            "QPushButton:hover { background:#2a2a2a; border-color:#ffffff; }"
            "QPushButton:pressed { background:#111111; }"
        )
        capture_btn.clicked.connect(self.capture_register_photo)
        right_layout.addWidget(capture_btn)

        # Captured photo preview thumbnail
        self.register_thumb = QLabel("Nenhuma foto capturada")
        self.register_thumb.setFixedHeight(120)
        self.register_thumb.setAlignment(Qt.AlignCenter)
        self.register_thumb.setStyleSheet(
            "background:#111111; border:1px solid #333333; border-radius:6px;"
            "color:#555555; font-size:11px;"
        )
        right_layout.addWidget(self.register_thumb)

        right_layout.addSpacing(8)

        # Save button
        save_btn = QPushButton("SALVAR CADASTRO")
        save_btn.setMinimumHeight(44)
        save_btn.setStyleSheet(
            "QPushButton { background:#ffffff; color:#000000; border:none;"
            "border-radius:6px; font-size:12px; font-weight:800; letter-spacing:1px; }"
            "QPushButton:hover { background:#cccccc; }"
            "QPushButton:pressed { background:#aaaaaa; }"
        )
        save_btn.clicked.connect(self.save_registration)
        right_layout.addWidget(save_btn)

        right_layout.addSpacing(8)

        # Status log
        status_lbl = QLabel("LOG")
        status_lbl.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        right_layout.addWidget(status_lbl)

        self.register_status = QTextEdit()
        self.register_status.setReadOnly(True)
        self.register_status.setObjectName("PanelText")
        self.register_status.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#aaaaaa; font-family:Consolas; font-size:11px; padding:8px; }"
        )
        right_layout.addWidget(self.register_status, 1)

        return page


    def _build_photos_tab(self) -> QWidget:
        """Gallery tab displaying registered faces and history."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(0)
        outer.setContentsMargins(0, 0, 0, 0)

        # Toolbar
        toolbar = QFrame()
        toolbar.setStyleSheet("QFrame { background:#141414; border-bottom:1px solid #2d2d2d; border-radius:0; }")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(16, 10, 16, 10)

        title_lbl = QLabel("GALERIA DE FACES CADASTRADAS")
        title_lbl.setStyleSheet("color:#ffffff; font-size:14px; font-weight:800; letter-spacing:3px;")

        self.people_search = QLineEdit()
        self.people_search.setPlaceholderText("🔍 Pesquisar por nome ou ID...")
        self.people_search.setFixedWidth(240)
        self.people_search.setFixedHeight(32)
        self.people_search.textChanged.connect(self.refresh_people)

        refresh_btn = QPushButton("⟳ ATUALIZAR")
        refresh_btn.setFixedHeight(32)
        refresh_btn.clicked.connect(self.refresh_people)

        toolbar_layout.addWidget(title_lbl)
        toolbar_layout.addStretch()
        toolbar_layout.addWidget(self.people_search)
        toolbar_layout.addSpacing(8)
        toolbar_layout.addWidget(refresh_btn)
        outer.addWidget(toolbar)

        # Body Split
        body = QVBoxLayout()
        body.setContentsMargins(16, 16, 16, 16)
        body.setSpacing(12)
        outer.addLayout(body, 1)

        # Scroll grid container
        self.people_scroll = QScrollArea()
        self.people_scroll.setWidgetResizable(True)
        self.people_scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")

        self.people_container = QWidget()
        self.people_container.setStyleSheet("background: transparent;")
        self.people_grid = QGridLayout(self.people_container)
        self.people_grid.setSpacing(12)
        self.people_grid.setAlignment(Qt.AlignTop)
        self.people_scroll.setWidget(self.people_container)
        body.addWidget(self.people_scroll, 2)

        # History output panel
        hist_lbl = QLabel("HISTÓRICO DE IDENTIFICAÇÃO DO ALVO SELECIONADO")
        hist_lbl.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        body.addWidget(hist_lbl)

        self.person_history_output = QTextEdit()
        self.person_history_output.setReadOnly(True)
        self.person_history_output.setObjectName("PanelText")
        self.person_history_output.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#aaaaaa; font-family:Consolas; font-size:11px; padding:8px; }"
        )
        self.person_history_output.setPlaceholderText("Clique em 'Histórico' no card de uma pessoa acima para visualizar os registros de aparição.")
        body.addWidget(self.person_history_output, 1)

        self.refresh_people()
        return page

    def _build_logs_tab(self) -> QWidget:
        """System logs and audit event tab."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(0)
        outer.setContentsMargins(0, 0, 0, 0)

        # Toolbar
        toolbar = QFrame()
        toolbar.setStyleSheet("QFrame { background:#141414; border-bottom:1px solid #2d2d2d; border-radius:0; }")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(16, 10, 16, 10)

        title_lbl = QLabel("CENTRAL DE LOGS E EVENTOS DO SISTEMA")
        title_lbl.setStyleSheet("color:#ffffff; font-size:14px; font-weight:800; letter-spacing:3px;")

        export_btn = QPushButton("💾 EXPORTAR LOGS (.CSV)")
        export_btn.setFixedHeight(32)
        export_btn.clicked.connect(self.export_logs_csv)

        refresh = QPushButton("⟳ ATUALIZAR LOGS")
        refresh.setFixedHeight(32)
        refresh.clicked.connect(self.refresh_logs)

        toolbar_layout.addWidget(title_lbl)
        toolbar_layout.addStretch()
        toolbar_layout.addWidget(export_btn)
        toolbar_layout.addSpacing(8)
        toolbar_layout.addWidget(refresh)
        outer.addWidget(toolbar)

        # Body
        body = QVBoxLayout()
        body.setContentsMargins(16, 16, 16, 16)
        body.setSpacing(10)
        outer.addLayout(body, 1)

        self.logs_output = QTextEdit()
        self.logs_output.setReadOnly(True)
        self.logs_output.setObjectName("PanelText")
        self.logs_output.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#00e5ff; font-family:Consolas; font-size:11px; padding:10px; }"
        )
        body.addWidget(self.logs_output, 1)

        self.refresh_logs()
        return page

    def _build_ai_tab(self) -> QWidget:
        """Conversational AI & tactical telemetry assistant tab."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(0)
        outer.setContentsMargins(0, 0, 0, 0)

        # Toolbar
        toolbar = QFrame()
        toolbar.setStyleSheet("QFrame { background:#141414; border-bottom:1px solid #2d2d2d; border-radius:0; }")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(16, 10, 16, 10)

        toolbar.setStyleSheet(
            "QFrame { background:qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #0d1726, stop:1 #111827); "
            "border-bottom:1px solid #244466; border-radius:0; }"
        )
        lbl_title = QLabel("MÓDULO DE ANÁLISE TÁTICA E IA (OPENAI)")
        lbl_title.setStyleSheet("color:#ffffff; font-size:14px; font-weight:800; letter-spacing:3px;")
        
        self.ai_status_label = QLabel("Pronto para conectar")
        self.ai_status_label.setStyleSheet(
            "color:#9fb4c8; font-size:11px; font-family:Consolas; background:#162536; "
            "border:1px solid #2d5275; border-radius:10px; padding:4px 9px;"
        )

        toolbar_layout.addWidget(lbl_title)
        toolbar_layout.addStretch()
        toolbar_layout.addWidget(self.ai_status_label)
        outer.addWidget(toolbar)

        # Body
        body = QVBoxLayout()
        body.setContentsMargins(16, 16, 16, 16)
        body.setSpacing(10)
        outer.addLayout(body, 1)

        # API Key config bar
        key_row = QHBoxLayout()
        key_lbl = QLabel("API Key OpenAI:")
        key_lbl.setFixedWidth(110)
        self.api_key_input = QLineEdit()
        self.api_key_input.setPlaceholderText("Cole sua API Key da OpenAI aqui (sk-...)")
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_input.setText(self.config.openai_api_key)
        self.api_key_input.setStyleSheet(
            "QLineEdit { background:#0b1220; border:1px solid #284663; border-radius:6px; "
            "padding:0 10px; color:#e6f2ff; } QLineEdit:focus { border:1px solid #4da3ff; }"
        )

        connect_btn = QPushButton("CONECTAR")
        connect_btn.setFixedHeight(34)
        connect_btn.setStyleSheet(
            "QPushButton { background:#2f80ed; color:white; border:none; border-radius:6px; padding:0 14px; font-weight:800; } "
            "QPushButton:hover { background:#4b96f5; }"
        )
        connect_btn.clicked.connect(self._connect_openai)

        new_chat_btn = QPushButton("NOVA CONVERSA")
        new_chat_btn.setFixedHeight(34)
        new_chat_btn.setStyleSheet(
            "QPushButton { background:#162536; color:#c8e1ff; border:1px solid #2d5275; border-radius:6px; padding:0 12px; font-weight:700; } "
            "QPushButton:hover { background:#203a54; }"
        )
        new_chat_btn.clicked.connect(self._reset_ai_chat)

        key_row.addWidget(key_lbl)
        key_row.addWidget(self.api_key_input, 1)
        key_row.addWidget(connect_btn)
        key_row.addWidget(new_chat_btn)
        body.addLayout(key_row)

        # Chat history display
        self.chat_display = QTextEdit()
        self.chat_display.setReadOnly(True)
        self.chat_display.setObjectName("PanelText")
        self.chat_display.setStyleSheet("""
            QTextEdit {
                background: #080e18;
                border: 1px solid #1f3851;
                border-radius: 8px;
                padding: 12px;
                font-family: 'Consolas', monospace;
                font-size: 12px;
                color: #e6f2ff;
            }
        """)
        welcome = (
            "<div style='color:#ffffff; font-weight:bold;'>ANÁLISE QUANTUM ATIVA.</div>"
            "<div style='color:#aaaaaa; font-size:12px;'>Envie consultas sobre a telemetria do sistema, "
            "coordenadas de alvos ou relatórios de rastreamento.</div>"
            "<br><div style='color:#777777; font-size:11px;'>Exemplos: \"Quantos alvos estão ativos?\", "
            "\"O robô está em movimento?\", \"Resumo da operação\"</div>"
        )
        self.chat_display.setHtml(welcome)
        body.addWidget(self.chat_display, 1)

        # Input area
        input_row = QHBoxLayout()
        self.ai_input = QLineEdit()
        self.ai_input.setPlaceholderText("Consultar telemetria ou log do processador...")
        self.ai_input.setMinimumHeight(38)
        self.ai_input.returnPressed.connect(self._send_ai_message)

        send_btn = QPushButton("ENVIAR")
        send_btn.setMinimumHeight(38)
        send_btn.setStyleSheet(
            "QPushButton { background:#ffffff; color:#000000; border:none; font-weight:800; }"
            "QPushButton:hover { background:#cccccc; }"
        )
        send_btn.clicked.connect(self._send_ai_message)

        mic_btn = QPushButton("🎙 MICROFONE")
        mic_btn.setMinimumHeight(38)
        mic_btn.clicked.connect(self.listen_microphone)

        report_btn = QPushButton("📊 RELATÓRIO IA")
        report_btn.setMinimumHeight(38)
        report_btn.clicked.connect(self.generate_report)

        input_row.addWidget(self.ai_input, 1)
        input_row.addWidget(send_btn)
        input_row.addWidget(mic_btn)
        input_row.addWidget(report_btn)
        body.addLayout(input_row)

        if self.config.openai_api_key:
            QTimer.singleShot(1000, self._connect_openai)
        return page

    # ──────────────────────────────────────────────────────────────────
    # Gesture Trainer Tab — Teachable Machine style
    # ──────────────────────────────────────────────────────────────────

    def _build_gesture_trainer_tab(self) -> QWidget:
        """Gesture trainer with a modern card-based UI (Teachable Machine style)."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(0)
        outer.setContentsMargins(0, 0, 0, 0)

        # ── Top toolbar ──────────────────────────────────────────────
        toolbar = QFrame()
        toolbar.setStyleSheet("QFrame { background:#141414; border-bottom:1px solid #2d2d2d; border-radius:0; }")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(16, 10, 16, 10)

        title_lbl = QLabel("TREINAR GESTOS")
        title_lbl.setStyleSheet("color:#ffffff; font-size:14px; font-weight:800; letter-spacing:3px;")
        status_chip = QLabel("MODO: REGRA MANUAL")
        status_chip.setObjectName("gt_mode_chip")
        status_chip.setStyleSheet(
            "color:#888888; font-size:10px; font-weight:700; letter-spacing:1px;"
            "background:#222222; border:1px solid #444444; border-radius:3px; padding:3px 8px;"
        )
        self.gt_mode_chip = status_chip

        train_btn = QPushButton("TREINAR MODELO")
        train_btn.setFixedHeight(34)
        train_btn.setFixedWidth(160)
        train_btn.setStyleSheet(
            "QPushButton { background:#ffffff; color:#000000; border:none; border-radius:4px;"
            "font-size:11px; font-weight:800; letter-spacing:1px; }"
            "QPushButton:hover { background:#cccccc; }"
            "QPushButton:pressed { background:#aaaaaa; }"
        )
        train_btn.clicked.connect(self._gt_train)

        reset_btn = QPushButton("RESETAR")
        reset_btn.setFixedHeight(34)
        reset_btn.setFixedWidth(90)
        reset_btn.setStyleSheet(
            "QPushButton { background:#2d1111; color:#ff9999; border:1px solid #663333;"
            "border-radius:4px; font-size:11px; font-weight:700; }"
            "QPushButton:hover { background:#441a1a; color:#ffffff; }"
        )
        reset_btn.clicked.connect(self._gt_reset)

        toolbar_layout.addWidget(title_lbl)
        toolbar_layout.addWidget(status_chip)
        toolbar_layout.addStretch()
        toolbar_layout.addWidget(train_btn)
        toolbar_layout.addSpacing(8)
        toolbar_layout.addWidget(reset_btn)
        outer.addWidget(toolbar)

        # ── Progress bar (global) ─────────────────────────────────────
        self.gt_progress = QProgressBar()
        self.gt_progress.setValue(0)
        self.gt_progress.setMaximumHeight(4)
        self.gt_progress.setTextVisible(False)
        self.gt_progress.setStyleSheet(
            "QProgressBar { background:#1a1a1a; border:none; }"
            "QProgressBar::chunk { background:#ffffff; }"
        )
        outer.addWidget(self.gt_progress)

        # ── Body (classes panel + right panel) ────────────────────────
        body = QHBoxLayout()
        body.setSpacing(0)
        body.setContentsMargins(0, 0, 0, 0)
        outer.addLayout(body, 1)

        # ── Left: class cards ─────────────────────────────────────────
        left_frame = QFrame()
        left_frame.setStyleSheet("QFrame { background:#0e0e0e; border-right:1px solid #2d2d2d; border-radius:0; }")
        left_frame.setFixedWidth(320)
        left_layout = QVBoxLayout(left_frame)
        left_layout.setContentsMargins(12, 12, 12, 12)
        left_layout.setSpacing(8)

        # Add class row
        add_lbl = QLabel("CLASSES DE GESTO")
        add_lbl.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        left_layout.addWidget(add_lbl)

        add_row = QHBoxLayout()
        self.gt_class_input = QLineEdit()
        self.gt_class_input.setPlaceholderText("Ex: DIREITA, PARAR, SEGUIR...")
        self.gt_class_input.setMinimumHeight(34)
        self.gt_class_input.returnPressed.connect(self._gt_add_class)
        add_btn = QPushButton("+")
        add_btn.setFixedSize(34, 34)
        add_btn.setStyleSheet(
            "QPushButton { background:#222222; color:#ffffff; border:1px solid #444444;"
            "border-radius:4px; font-size:18px; font-weight:700; }"
            "QPushButton:hover { background:#333333; border-color:#ffffff; }"
        )
        add_btn.clicked.connect(self._gt_add_class)
        add_row.addWidget(self.gt_class_input, 1)
        add_row.addWidget(add_btn)
        left_layout.addLayout(add_row)

        # Scroll area for class cards
        self.gt_cards_scroll = QScrollArea()
        self.gt_cards_scroll.setWidgetResizable(True)
        self.gt_cards_scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")
        self.gt_cards_container = QWidget()
        self.gt_cards_container.setStyleSheet("background: transparent;")
        self.gt_cards_layout = QVBoxLayout(self.gt_cards_container)
        self.gt_cards_layout.setSpacing(6)
        self.gt_cards_layout.setAlignment(Qt.AlignTop)
        self.gt_cards_scroll.setWidget(self.gt_cards_container)
        left_layout.addWidget(self.gt_cards_scroll, 1)

        body.addWidget(left_frame)

        # ── Right: recording controls + log ───────────────────────────
        right_frame = QFrame()
        right_frame.setStyleSheet("QFrame { background:#111111; border-radius:0; border:none; }")
        right_layout = QVBoxLayout(right_frame)
        right_layout.setContentsMargins(20, 16, 20, 16)
        right_layout.setSpacing(12)
        body.addWidget(right_frame, 1)

        # Recording section
        rec_header = QLabel("GRAVAR AMOSTRAS")
        rec_header.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        right_layout.addWidget(rec_header)

        # Selected class display
        self.gt_selected_label = QLabel("Clique em uma classe para selecionar →")
        self.gt_selected_label.setStyleSheet(
            "color:#ffffff; font-size:15px; font-weight:700; padding:10px;"
            "background:#1a1a1a; border:1px solid #333333; border-radius:6px;"
        )
        right_layout.addWidget(self.gt_selected_label)
        self.gt_selected_input = QLineEdit()
        self.gt_selected_input.hide()  # Hidden — used internally by record logic

        # Duration row
        dur_row = QHBoxLayout()
        dur_lbl = QLabel("Duração:")
        dur_lbl.setStyleSheet("color:#888888; font-size:12px;")
        self.gt_record_secs = QLineEdit("5")
        self.gt_record_secs.setFixedWidth(60)
        self.gt_record_secs.setFixedHeight(32)
        sec_lbl = QLabel("segundos")
        sec_lbl.setStyleSheet("color:#888888; font-size:12px;")
        dur_row.addWidget(dur_lbl)
        dur_row.addWidget(self.gt_record_secs)
        dur_row.addWidget(sec_lbl)
        dur_row.addStretch()
        right_layout.addLayout(dur_row)

        # Record button
        self.gt_record_btn = QPushButton("● GRAVAR PELA CÂMERA")
        self.gt_record_btn.setMinimumHeight(50)
        self.gt_record_btn.setStyleSheet(
            "QPushButton { background:#1a0000; color:#ff6666; border:2px solid #882222;"
            "border-radius:6px; font-size:13px; font-weight:800; letter-spacing:1px; }"
            "QPushButton:hover { background:#2d0000; border-color:#ff4444; color:#ff4444; }"
            "QPushButton:pressed { background:#0a0000; }"
        )
        self.gt_record_btn.clicked.connect(self._gt_start_record)
        right_layout.addWidget(self.gt_record_btn)

        # Import button
        import_btn = QPushButton("↑  IMPORTAR VÍDEO  (.mp4 / .avi)")
        import_btn.setMinimumHeight(40)
        import_btn.setStyleSheet(
            "QPushButton { background:#1a1a1a; color:#cccccc; border:1px solid #444444;"
            "border-radius:6px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#2a2a2a; border-color:#888888; color:#ffffff; }"
        )
        import_btn.clicked.connect(self._gt_import_video)
        right_layout.addWidget(import_btn)

        right_layout.addSpacing(8)

        # Delete class
        del_btn = QPushButton("REMOVER CLASSE SELECIONADA")
        del_btn.setMinimumHeight(34)
        del_btn.setStyleSheet(
            "QPushButton { background:transparent; color:#884444; border:1px solid #442222;"
            "border-radius:4px; font-size:11px; font-weight:700; }"
            "QPushButton:hover { background:#2d1111; color:#ff6666; border-color:#882222; }"
        )
        del_btn.clicked.connect(self._gt_remove_class)
        right_layout.addWidget(del_btn)

        right_layout.addSpacing(12)

        # Log
        log_lbl = QLabel("LOG DO TREINAMENTO")
        log_lbl.setStyleSheet("color:#888888; font-size:10px; font-weight:700; letter-spacing:2px;")
        right_layout.addWidget(log_lbl)

        self.gt_status = QTextEdit()
        self.gt_status.setReadOnly(True)
        self.gt_status.setObjectName("PanelText")
        self.gt_status.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#aaaaaa; font-family:Consolas, monospace; font-size:11px; padding:10px; }"
        )
        self.gt_status.setHtml(
            "<div style='color:#ffffff; font-weight:bold; font-size:13px; margin-bottom:8px; letter-spacing:1px;'>📖 TUTORIAL E GUIA DE GESTOS DA IA</div>"
            "<div style='color:#00ff88; font-weight:bold; font-size:12px; margin-bottom:4px;'>✋ Gestos Padrão Reconhecidos Automaticamente:</div>"
            "<div style='color:#dddddd; margin-left:10px; margin-bottom:10px; line-height:1.4;'>"
            "• <b>PARAR</b>: ✋ Mão aberta e estendida virada para a câmera<br>"
            "• <b>SEGUIR</b>: ✊ Punho completamente fechado<br>"
            "• <b>RÉ</b>: ✌️ Indicador e médio levantados (sinal de V)<br>"
            "• <b>ESQUERDA</b>: 👈 Mão inclinada para a esquerda<br>"
            "• <b>DIREITA</b>: 👉 Mão inclinada para a direita"
            "</div>"
            "<div style='color:#00e5ff; font-weight:bold; font-size:12px; margin-bottom:4px;'>🎯 Como Treinar um Gesto Personalizado:</div>"
            "<div style='color:#bbbbbb; margin-left:10px; line-height:1.4;'>"
            "<b>1.</b> Digite o nome da nova classe à esquerda (ex: <i>SOCAR</i>) e clique no botão <b>+</b><br>"
            "<b>2.</b> Clique no card da classe criada para ativá-la<br>"
            "<b>3.</b> Inicie a câmera na aba <b>📊 Monitoramento</b><br>"
            "<b>4.</b> Clique em <b>● GRAVAR PELA CÂMERA</b> e segure a pose por 5 segundos<br>"
            "<b>5.</b> Clique no botão no topo <b>TREINAR MODELO</b> para salvar os pesos da IA"
            "</div>"
        )
        right_layout.addWidget(self.gt_status, 1)

        # ── Internal state ────────────────────────────────────────────
        self._gt_recording = False
        self._gt_record_timer: Optional[QTimer] = None
        self._gt_record_deadline = 0.0
        self._gt_recorded_class = ""
        self._gt_selected_class = ""

        self._gt_refresh_list()
        return page

    # ── Gesture Trainer actions ────────────────────────────────────────

    def _gt_add_class(self) -> None:
        name = self.gt_class_input.text().strip().upper()
        if not name:
            return
        self.gesture_trainer.add_class(name)
        self.gt_class_input.clear()
        self._gt_refresh_list()
        self.gt_status.append(f"✓ Classe '{name}' criada.")

    def _gt_remove_class(self) -> None:
        name = self._gt_selected_class
        if not name:
            self.gt_status.append("[AVISO] Selecione uma classe no painel esquerdo.")
            return
        self.gesture_trainer.remove_class(name)
        self._gt_selected_class = ""
        self.gt_selected_input.clear()
        self.gt_selected_label.setText("Clique em uma classe para selecionar ->")
        self._gt_refresh_list()
        self.gt_status.append(f"[OK] Classe '{name}' removida.")

    def _gt_reset(self) -> None:
        answer = QMessageBox.question(
            self, "Resetar", "Apagar todas as classes, amostras e o modelo treinado?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if answer == QMessageBox.StandardButton.Yes:
            self.gesture_trainer.reset()
            self.gestures.reload_model(self.config.assets_dir)
            self._gt_refresh_list()
            self.gt_progress.setValue(0)
            self.gt_status.setText("Resetado. Modo: regras manuais (fallback).")

    def _gt_select_class(self, name: str) -> None:
        """Called when user clicks a class card."""
        self._gt_selected_class = name
        self.gt_selected_input.setText(name)
        self.gt_selected_label.setText(f"Classe: {name}")
        self._gt_refresh_list()  # refresh to highlight selected

    def _gt_start_record(self) -> None:
        if cv2 is None:
            self.gt_status.append("[AVISO] OpenCV nao instalado.")
            return

        # Auto-start camera if not active
        if not self.running or self.mode != "camera":
            self.start_camera()
            if not self.running or self.capture is None or not self.capture.isOpened():
                self.gt_status.append("[ERRO] Nao foi possivel abrir a camera para gravar gestos.")
                return

        cls = self._gt_selected_class or self.gt_class_input.text().strip().upper()
        if not cls:
            self.gt_status.append("[AVISO] Digite o nome de uma classe ou selecione um card no painel esquerdo.")
            return

        if cls not in self.gesture_trainer.classes():
            self.gesture_trainer.add_class(cls)
            self._gt_select_class(cls)

        try:
            secs = float(self.gt_record_secs.text()) if self.gt_record_secs.text() else 5.0
        except ValueError:
            secs = 5.0

        self._gt_recording = True
        self._gt_recorded_class = cls
        self._gt_record_deadline = time.time() + secs
        self._gt_initial_sample_count = self.gesture_trainer.sample_count(cls)
        self.gt_record_btn.setText("● GRAVANDO...")
        self.gt_record_btn.setEnabled(False)
        self.gt_status.append(f"● Gravando '{cls}' por {secs:.0f}s — Mostre a mão para a câmera agora!")

        if self._gt_record_timer is None:
            self._gt_record_timer = QTimer(self)
            self._gt_record_timer.timeout.connect(self._gt_record_tick)
        self._gt_record_timer.start(50)  # 20 fps sampling

    def _gt_record_tick(self) -> None:
        if not self._gt_recording:
            return
        now = time.time()
        if now >= self._gt_record_deadline:
            self._gt_stop_record()
            return
        if self.current_frame is not None:
            self.gesture_trainer.add_sample_from_frame(self.current_frame, self._gt_recorded_class)
            count = self.gesture_trainer.sample_count(self._gt_recorded_class)
            secs_left = max(0.0, self._gt_record_deadline - now)
            self.gt_record_btn.setText(f"● GRAVANDO ({count} amostras | {secs_left:.1f}s)...")

    def _gt_stop_record(self) -> None:
        self._gt_recording = False
        if self._gt_record_timer:
            self._gt_record_timer.stop()
        self.gt_record_btn.setText("● GRAVAR PELA CÂMERA")
        self.gt_record_btn.setEnabled(True)
        count = self.gesture_trainer.sample_count(self._gt_recorded_class)
        new_samples = count - getattr(self, "_gt_initial_sample_count", 0)
        if new_samples > 0:
            self.gt_status.append(f"[OK] Gravação concluída! '{self._gt_recorded_class}': {count} amostras no total (+{new_samples} novas).")
        else:
            self.gt_status.append(f"[AVISO] Nenhuma mão detectada durante a gravação. Certifique-se de posicionar a mão em frente à câmera.")
        self._gt_refresh_list()

    def _gt_import_video(self) -> None:
        cls = self._gt_selected_class
        if not cls:
            self.gt_status.append("[AVISO] Selecione uma classe antes de importar.")
            return
        path, _ = QFileDialog.getOpenFileName(
            self, "Selecionar Vídeo", "", "Vídeos (*.mp4 *.avi *.mov *.mkv *.webm)"
        )
        if not path:
            return
        if cls not in self.gesture_trainer.classes():
            self.gesture_trainer.add_class(cls)

        self.gt_status.append(f"⏳ Importando '{path}'...")
        self.gt_progress.setValue(0)

        def _progress(val: int) -> None:
            self.gt_progress.setValue(val)

        collected = self.gesture_trainer.add_samples_from_video(path, cls, max_frames=400, progress_cb=_progress)
        self._gt_refresh_list()
        self.gt_status.append(f"✓ Importado: {collected} amostras de '{cls}'.")

    def _gt_train(self) -> None:
        self.gt_status.append("[TREINANDO] Processando amostras...")
        self.gt_progress.setValue(0)

        def _progress(val: int) -> None:
            self.gt_progress.setValue(val)

        ok, msg = self.gesture_trainer.train(progress_cb=_progress)
        if ok:
            self.gestures.reload_model(self.config.assets_dir)
            self.gt_mode_chip.setText("MODO: MODELO TREINADO")
            self.gt_mode_chip.setStyleSheet(
                "color:#00cc66; font-size:10px; font-weight:700; letter-spacing:1px;"
                "background:#0a1f14; border:1px solid #1a5c38; border-radius:3px; padding:3px 8px;"
            )
            self.gt_status.append(f"[OK] {msg}")
            self.gt_status.append("Modelo ativo! Teste ao vivo na aba Monitoramento.")
            self.voice.say("Modelo de gestos treinado com sucesso.")
        else:
            self.gt_status.append(f"[ERRO] {msg}")

    def _gt_refresh_list(self) -> None:
        """Rebuild the visual class cards in the left panel."""
        if not hasattr(self, "gt_cards_layout"):
            return

        # Clear existing cards
        while self.gt_cards_layout.count():
            item = self.gt_cards_layout.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()

        classes = self.gesture_trainer.classes()
        if not classes:
            empty = QLabel("Nenhuma classe criada.\nClique em + para adicionar.")
            empty.setStyleSheet("color:#555555; font-size:12px; padding:20px;")
            empty.setAlignment(Qt.AlignCenter)
            empty.setWordWrap(True)
            self.gt_cards_layout.addWidget(empty)
            return

        for cls in classes:
            n = self.gesture_trainer.sample_count(cls)
            is_selected = cls == self._gt_selected_class

            card = QFrame()
            border_color = "#ffffff" if is_selected else "#333333"
            bg_color = "#1e1e1e" if is_selected else "#161616"
            card.setStyleSheet(
                f"QFrame {{ background:{bg_color}; border:1px solid {border_color};"
                f"border-radius:6px; }}"
                f"QFrame:hover {{ background:#222222; border-color:#888888; }}"
            )
            card.setCursor(Qt.PointingHandCursor)
            card.setFixedHeight(64)

            card_layout = QHBoxLayout(card)
            card_layout.setContentsMargins(12, 8, 12, 8)
            card_layout.setSpacing(10)

            # Class name
            name_lbl = QLabel(cls)
            name_color = "#ffffff" if is_selected else "#cccccc"
            name_lbl.setStyleSheet(f"color:{name_color}; font-size:13px; font-weight:700; border:none; background:transparent;")

            # Sample count + mini bar
            MAX_GOOD = 100
            filled = min(n, MAX_GOOD)
            pct = int((filled / MAX_GOOD) * 10)
            bar_str = "▮" * pct + "▯" * (10 - pct)
            bar_color = "#888888" if not is_selected else "#ffffff"
            count_lbl = QLabel(f"{n}  {bar_str}")
            count_lbl.setStyleSheet(f"color:{bar_color}; font-size:10px; font-family:Consolas; border:none; background:transparent;")

            card_layout.addWidget(name_lbl, 1)
            card_layout.addWidget(count_lbl)

            # Make clickable via mousePressEvent override
            def make_handler(class_name):
                def handler(event):
                    self._gt_select_class(class_name)
                return handler
            card.mousePressEvent = make_handler(cls)

            self.gt_cards_layout.addWidget(card)

    def _build_config_tab(self) -> QWidget:
        """System configuration and diagnostic dashboard tab."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(0)
        outer.setContentsMargins(0, 0, 0, 0)

        # Toolbar
        toolbar = QFrame()
        toolbar.setStyleSheet("QFrame { background:#141414; border-bottom:1px solid #2d2d2d; border-radius:0; }")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(16, 10, 16, 10)

        title_lbl = QLabel("CONFIGURAÇÕES DO SISTEMA E DIAGNÓSTICO")
        title_lbl.setStyleSheet("color:#ffffff; font-size:14px; font-weight:800; letter-spacing:3px;")

        rebuild_btn = QPushButton("⚙ RECRIAR BASE FACIAL")
        rebuild_btn.setFixedHeight(32)
        rebuild_btn.setStyleSheet(
            "QPushButton { background:#1a1a1a; color:#ffffff; border:1px solid #555555; font-weight:700; }"
            "QPushButton:hover { background:#333333; border-color:#ffffff; }"
        )
        rebuild_btn.clicked.connect(self.rebuild_face_embeddings)

        toolbar_layout.addWidget(title_lbl)
        toolbar_layout.addStretch()
        toolbar_layout.addWidget(rebuild_btn)
        outer.addWidget(toolbar)

        # Body
        body = QVBoxLayout()
        body.setContentsMargins(16, 16, 16, 16)
        body.setSpacing(12)
        outer.addLayout(body, 1)

        self.config_info = QTextEdit()
        self.config_info.setReadOnly(True)
        self.config_info.setObjectName("PanelText")
        self.config_info.setStyleSheet(
            "QTextEdit { background:#0a0a0a; border:1px solid #2d2d2d; border-radius:6px;"
            "color:#00ff88; font-family:Consolas; font-size:12px; padding:12px; }"
        )

        insights_status = 'ATIVO' if self.faces.available else (self.faces.last_error or 'INDISPONÍVEL')
        gestures_status = 'ATIVO' if self.gestures.available else 'INDISPONÍVEL'
        openai_status = 'CONFIGURADO' if self.config.openai_api_key else 'NÃO CONFIGURADO'

        info_lines = [
            "================================================================================",
            "                 QUANTUM TRACKER — DIAGNÓSTICO DO AMBIENTE                     ",
            "================================================================================",
            f" [DIRETÓRIOS E AMBIENTE]",
            f"   • Projeto Root       : {self.config.project_root}",
            f"   • Banco de Dados     : {self.config.database_path}",
            f"   • Diretório de Faces : {self.config.faces_dir}",
            "",
            f" [VISÃO COMPUTACIONAL & DETECÇÃO]",
            f"   • Backend Detector   : {self.detector.backend_name}",
            f"   • Modelo YOLOv8      : {self.config.yolo_model}",
            "",
            f" [MÓDULOS BIOMÉTRICOS & IA]",
            f"   • InsightFace        : {insights_status}",
            f"   • MediaPipe Gestos   : {gestures_status}",
            f"   • OpenAI Chat        : {openai_status}",
            "================================================================================",
        ]
        self.config_info.setText("\n".join(info_lines))
        body.addWidget(self.config_info, 1)

        return page

    def _apply_style(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow, QWidget {
                background-color: #07111f;
                color: #e6f2ff;
                font-family: 'Consolas', 'Courier New', 'Segoe UI', Arial, sans-serif;
                font-size: 13px;
            }
            #Title {
                color: #eaf6ff;
                font-size: 24px;
                font-weight: 900;
                letter-spacing: 5px;
                padding: 4px 0;
            }
            #Status {
                color: #ffffff;
                font-family: Consolas, monospace;
                font-size: 12px;
                font-weight: bold;
                padding: 5px 14px;
                border: 1px solid #24527c;
                border-radius: 10px;
                background: #10233a;
            }
            QTabWidget::pane {
                border: 1px solid #1f4a70;
                border-radius: 6px;
                background: #0c1a2b;
                margin-top: -1px;
            }
            QTabBar::tab {
                background: #0d1c2d;
                color: #8faec8;
                padding: 10px 18px;
                border: 1px solid #1d405f;
                border-bottom: none;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                margin-right: 3px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1px;
            }
            QTabBar::tab:selected {
                background: #10263d;
                color: #ffffff;
                border-top: 3px solid #28b7ff;
                border-bottom: 1px solid #10263d;
            }
            QTabBar::tab:hover:!selected {
                background: #15304b;
                color: #e0f2ff;
            }
            QPushButton {
                background: #10243a;
                color: #e8f6ff;
                border: 1px solid #285578;
                border-radius: 6px;
                padding: 8px 18px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1px;
            }
            QPushButton:hover {
                background: #174267;
                border-color: #3bc0ff;
                color: #ffffff;
            }
            QPushButton:pressed {
                background: #091724;
                border-color: #248fc7;
            }
            QPushButton:disabled {
                background: #0a1623;
                color: #52687a;
                border-color: #172c3e;
            }
            #DangerButton {
                background: #2d1111;
                border-color: #883333;
                color: #ff9999;
            }
            #DangerButton:hover {
                background: #441a1a;
                border-color: #ff3333;
                color: #ffffff;
            }
            QLineEdit {
                background: #0b1928;
                border: 1px solid #285578;
                border-radius: 4px;
                color: #eaf6ff;
                padding: 8px 12px;
                font-size: 13px;
                selection-background-color: #444444;
            }
            QLineEdit:focus {
                border-color: #35bfff;
            }
            QTextEdit, QPlainTextEdit {
                background: #0b1928;
                border: 1px solid #1f4a70;
                border-radius: 6px;
                color: #d9edff;
                padding: 10px;
                font-family: Consolas, 'Courier New', monospace;
                font-size: 12px;
                selection-background-color: #1f6794;
            }
            QScrollBar:vertical {
                background: #081522;
                width: 9px;
                margin: 0;
            }
            QScrollBar::handle:vertical {
                background: #245273;
                border-radius: 4px;
                min-height: 30px;
            }
            QScrollBar::handle:vertical:hover {
                background: #36bfff;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0;
            }
            QScrollBar:horizontal {
                background: #081522;
                height: 9px;
            }
            QScrollBar::handle:horizontal {
                background: #245273;
                border-radius: 4px;
                min-width: 30px;
            }
            QScrollBar::handle:horizontal:hover {
                background: #36bfff;
            }
            QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
                width: 0;
            }
            QLabel {
                color: #a9c7de;
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 1px;
            }
            #Video {
                background: #000000;
                border: 1px solid #1f4a70;
                border-radius: 8px;
                color: #dff4ff;
                font-size: 14px;
            }
            #PanelText {
                font-family: Consolas, monospace;
                font-size: 11px;
                color: #c8e5fa;
                background: #0b1928;
                border: 1px solid #1d405f;
                border-radius: 6px;
            }
            QFrame {
                background: #0d1c2d;
                border: 1px solid #1d405f;
                border-radius: 6px;
            }
            QScrollArea {
                border: none;
                background: transparent;
            }
            #SideCard {
                background: #102238;
                border: 1px solid #245273;
                border-radius: 8px;
                margin-bottom: 4px;
            }
            #CardHeader {
                color: #dff4ff;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 2px;
                padding-bottom: 4px;
                border-bottom: 1px solid #245273;
                margin-bottom: 6px;
            }
            #InfoValue {
                color: #c8e5fa;
                font-family: Consolas, monospace;
                font-size: 12px;
                font-weight: 500;
                padding: 2px 0;
            }
            QComboBox {
                background: #0b1928;
                color: #dff4ff;
                border: 1px solid #285578;
                border-radius: 6px;
                padding: 7px 28px 7px 10px;
                min-height: 18px;
            }
            QComboBox:hover, QComboBox:focus { border-color: #36bfff; }
            QComboBox QAbstractItemView {
                background: #0d1c2d;
                color: #dff4ff;
                selection-background-color: #1f6794;
                border: 1px solid #285578;
            }
            """
        )



    def start_camera(self) -> None:
        if cv2 is None:
            self._message("OpenCV nao esta instalado. Rode Instalar_Dependencias.bat.")
            return
        self.stop()
        self.capture = cv2.VideoCapture(self.config.camera_index)
        self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.frame_width)
        self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.frame_height)
        if not self.capture.isOpened():
            self._message("Nao foi possivel abrir a webcam.")
            return
        self.mode = "camera"
        self.running = True
        self.tracker.reset()
        self.current_targets = []
        self.status_label.setText(f"Camera ativa | Detector: {self.detector.backend_name}")
        self.timer.start(self.config.ui_tick_ms)

    def start_simulator(self) -> None:
        self.stop()
        self.mode = "simulator"
        self.running = True
        self.tracker.reset()
        self.current_targets = []
        self.world.reset()
        self.status_label.setText("Simulador ativo")
        self.timer.start(self.config.ui_tick_ms)

    def stop(self) -> None:
        self.timer.stop()
        self.running = False
        self.robot_controller.manual_command(RobotCommand.STOP)
        self.detector.shutdown()
        if self.capture is not None:
            self.capture.release()
            self.capture = None
        self.identity_resolver = IdentityResolver()
        self.robot_controller.clear_target()
        self.current_targets = []
        self.mode = "idle"
        self.status_label.setText("Sistema parado")


    def _loop(self) -> None:
        if not self.running:
            return
        if self.mode == "camera":
            ok, frame = self.capture.read() if self.capture is not None else (False, None)
            if not ok or frame is None:
                self.status_label.setText("Frame indisponivel")
                return
            # Non-blocking: submits frame to background thread, returns cached result
            detections = self.detector.detect(frame)
        else:
            frame, detections = self.world.next_frame()


        self.current_frame = frame.copy()
        targets, events = self._process_frame(frame, detections)
        self.current_targets = targets
        self._update_robot_controller(targets, frame)
        active_g = self.active_gesture_command if time.time() - self.last_gesture_time <= 2.5 else None
        # Reuse cached recent_events from monitor panel to avoid redundant DB query
        snapshot = SystemSnapshot(self.fps, targets, self._cached_recent_events, self.mode.upper(), active_gesture=active_g)
        hud_frame = self.hud.draw(frame, snapshot)
        self._display_frame(hud_frame, self.video_label)
        self._update_monitor_panel(targets)
        if self.frame_counter % 5 == 0:
            # Offload DB writes to a background thread to avoid blocking the UI timer
            _targets_snapshot = list(targets)
            threading.Thread(
                target=self._db_write_observations,
                args=(_targets_snapshot,),
                daemon=True,
            ).start()
        for event in events:
            self._handle_event(event)

    def _db_write_observations(self, targets: list) -> None:
        """Write track observations and session upserts in a background thread."""
        try:
            self.db.log_track_observations(targets)
            for target in targets:
                self.db.upsert_track_session(target)
        except Exception as exc:
            self.logger.warning(f"Erro ao escrever observacoes no DB: {exc}")

    def _process_frame(self, frame, detections: List[Detection]):
        now = time.perf_counter()
        dt = max(now - self.last_frame_time, 1e-4)
        self.last_frame_time = now
        self.fps = 0.90 * self.fps + 0.10 * (1.0 / dt)
        self.frame_counter += 1

        targets, events = self.tracker.update(frame, detections)
        if self.mode == "camera" and self.frame_counter % self.config.face_recognition_interval == 0:
            for target in targets:
                match = self.faces.identify(frame, target)
                if match and match.confidence >= self.config.face_confidence_threshold:
                    resolved = self.identity_resolver.resolve(target.track_id, match)
                    if resolved is None:
                        events.append(SystemEvent(EventType.IDENTITY_CONFLICT, target.track_id, match.name, match.confidence, target.state.value))
                        continue
                    previous_person_id = target.person_id
                    target.person_id = resolved.person_id
                    target.name = resolved.name
                    target.identity_confidence = resolved.confidence
                    if previous_person_id != resolved.person_id:
                        self.db.log_identity_event(target.track_id, resolved.person_id, resolved.name, resolved.confidence, "IDENTIFIED")
                        events.append(SystemEvent(EventType.TARGET_IDENTIFIED, target.track_id, target.name, resolved.confidence, target.state.value))

        gesture = self.gestures.detect(frame)
        if gesture and (gesture.command != self.last_gesture or time.time() - self.last_gesture_time > 2.0):
            self.last_gesture = gesture.command
            self.last_gesture_time = time.time()
            self.active_gesture_command = gesture.command
            events.append(SystemEvent(EventType.GESTURE_DETECTED, None, None, gesture.confidence, "GESTURE", gesture.command))
            # Voz imediata no gesto
            _voz_map = {
                "VIRAR_DIREITA": "Movimento para a direita",
                "VIRAR_ESQUERDA": "Movimento para a esquerda",
                "PARAR": "Parar",
                "SEGUIR": "Seguir em frente",
                "RE": "Recuar",
                "GIRAR": "Girar",
            }
            self.voice.say(_voz_map.get(gesture.command, f"Gesto {gesture.command}"))
        return targets, events

    def _update_robot_controller(self, targets, frame) -> None:
        h, w = frame.shape[:2]
        gesture = self.active_gesture_command if time.time() - self.last_gesture_time <= 2.5 else None
        if gesture is None:
            self.active_gesture_command = None
        obstacle_distance_cm = (
            self.world.obstacle_distance_cm if self.mode == "simulator" else None
        )
        telemetry = self.robot_controller.update(
            targets,
            (w, h),
            gesture,
            obstacle_distance_cm=obstacle_distance_cm,
        )
        if self.mode == "simulator":
            self.world.send_robot_command(telemetry.command)
        self.current_robot_telemetry = telemetry
        self._update_robot_dashboard(telemetry)

    def _send_robot_heartbeat(self) -> None:
        """Keep a manual Arduino command alive even when the camera is off."""
        controller = self.robot_controller
        if not controller.arduino.connected or controller.manual_override is None:
            return
        telemetry = controller.update([], (640, 480))
        self.current_robot_telemetry = telemetry
        self._update_robot_dashboard(telemetry)

    def _handle_event(self, event: SystemEvent) -> None:
        self.db.log_event(event)
        if event.event_type == EventType.TARGET_REMOVED and event.track_id is not None:
            self.db.close_track_session(event.track_id, event.state)
            self.identity_resolver.release_track(event.track_id)
        if event.event_type in {
            EventType.TARGET_IDENTIFIED,
            EventType.GHOST_ACTIVATED,
            EventType.TARGET_LOST,
            EventType.IDENTITY_CONFLICT,
            EventType.GESTURE_DETECTED,
            EventType.VOICE_COMMAND,
        }:
            if event.event_type == EventType.GESTURE_DETECTED:
                text = f"Gesto detectado: {event.message}."
            elif event.event_type == EventType.IDENTITY_CONFLICT:
                text = f"Conflito de identidade evitado para {event.name}."
            else:
                text = self.brain.analyze_event(event)
            if hasattr(self, 'chat_display'):
                self._append_chat("ai", text)
            self.voice.say(text)
        # Invalidate cache so next monitor panel refresh picks up new events
        self._last_stats_time = 0.0

    def _update_monitor_panel(self, targets) -> None:
        metrics = self.snapshot_service.build_metrics(targets)
        # Throttle expensive DB queries: max once every 2 seconds
        now_t = time.monotonic()
        if not hasattr(self, '_last_stats_time') or now_t - self._last_stats_time > 2.0:
            self._cached_stats = self.db.stats_summary()
            self._cached_recent_events = self.db.recent_events(limit=10)
            self._last_stats_time = now_t
        stats = self._cached_stats

        # ── Cards do painel lateral ───────────────────────────────────
        primary = targets[0] if targets else None
        if primary:
            ghost_active = any(t.state.value in ("GHOST", "OCCLUDED") for t in targets)
            self.lbl_target_id.setText(f"ID: {primary.track_id}")
            self.lbl_target_name.setText(f"Nome: {primary.name or 'DESCONHECIDO'}")
            self.lbl_target_conf.setText(f"Confianca: {primary.confidence:.0%}")
            self.lbl_target_dist.setText(f"Distancia: {primary.distance_estimate:.1f} m")
            self.lbl_target_state.setText(f"Estado: {primary.state.value}")
            self.lbl_target_speed.setText(f"Velocidade: {primary.speed:.1f} px/f")
            # Color state label by state
            state_color = {"VISIBLE": "#00ff88", "GHOST": "#ff9800", "LOST": "#f44336", "OCCLUDED": "#ffcc00"}
            self.lbl_target_state.setStyleSheet(f"color: {state_color.get(primary.state.value, '#aaaaaa')};")
            ghost_text = "ATIVO" if ghost_active else "INATIVO"
            ghost_color = "#ff9800" if ghost_active else "#00e5ff"
            self.lbl_ghost_mode.setText(f"Ghost: {ghost_text}")
            self.lbl_ghost_mode.setStyleSheet(f"color: {ghost_color}; font-weight: bold;")
        else:
            self.lbl_target_id.setText("ID: —")
            self.lbl_target_name.setText("Nome: —")
            self.lbl_target_conf.setText("Confianca: —")
            self.lbl_target_dist.setText("Distancia: —")
            self.lbl_target_state.setText("Estado: —")
            self.lbl_target_speed.setText("Velocidade: —")
            self.lbl_ghost_mode.setText("Ghost: INATIVO")
            self.lbl_ghost_mode.setStyleSheet("color: #00e5ff;")

        self.lbl_fps.setText(f"FPS: {self.fps:.1f}")
        self.lbl_mode.setText(f"Modo: {self.mode.upper()}")
        self.lbl_targets_n.setText(f"Alvos: {metrics.total}  (vis={metrics.visible} ghost={metrics.ghost})")

        # ── Telemetria detalhada ──────────────────────────────────────
        lines = [
            f"Identificadas: {metrics.identified}  |  Desconhecidas: {metrics.unknown}",
            f"Detector: {self.detector.backend_name}",
            f"Reconhec.: {'InsightFace OK' if self.faces.available else 'InsightFace N/D'}",
            f"DB: pessoas={stats['people']}  sessoes={stats['track_sessions']}",
            f"Hoje: detec={stats.get('today_detected', 0)}  ident={stats.get('today_identified', 0)}  ghost={stats.get('today_ghost', 0)}",
            "",
        ]
        for target in targets:
            lines.append(
                f"ID {target.track_id} | {target.name or 'UNKNOWN'} | {target.state.value} | "
                f"conf {target.confidence:.2f} | vel {target.speed:.1f}px/f"
            )
        self.monitor_info.setText("\n".join(lines))

        # ── Stream de eventos (reuse cached to avoid extra DB query per frame) ──
        self.event_stream.setText("\n".join(
            f"{log.timestamp[-8:]} | {log.event} | ID {log.track_id or '-'}" for log in self._cached_recent_events
        ))


    def start_register_preview(self) -> None:
        if cv2 is None:
            self._message("OpenCV nao esta instalado.")
            return
        if self.register_capture is None:
            self.register_capture = cv2.VideoCapture(self.config.camera_index)
        if not self.register_capture.isOpened():
            self._message("Nao foi possivel abrir a webcam para cadastro.")
            return
        self.register_status.append("Camera de cadastro ativa.")
        if hasattr(self, "register_live_chip"):
            self.register_live_chip.setText("● AO VIVO")
            self.register_live_chip.setStyleSheet(
                "color:#00cc66; font-size:10px; font-weight:700; letter-spacing:1px;"
            )
        self.register_timer.start(40)

    def _register_preview_loop(self) -> None:
        if self.register_capture is None:
            return
        ok, frame = self.register_capture.read()
        if not ok or frame is None:
            return
        self.register_frame = frame.copy()
        self._display_frame(frame, self.register_video)

    def capture_register_photo(self) -> None:
        if self.register_frame is None and self.current_frame is not None:
            self.register_frame = self.current_frame.copy()
        if self.register_frame is None:
            self._message("Nenhuma imagem disponivel. Abra a camera de cadastro primeiro.")
            return
        if self.register_timer.isActive():
            self.register_timer.stop()
            if hasattr(self, "register_live_chip"):
                self.register_live_chip.setText("● CONGELADO")
                self.register_live_chip.setStyleSheet(
                    "color:#ffaa00; font-size:10px; font-weight:700; letter-spacing:1px;"
                )
        # Show thumbnail of captured frame
        if hasattr(self, "register_thumb") and self.register_frame is not None:
            rgb = cv2.cvtColor(self.register_frame, cv2.COLOR_BGR2RGB)
            h, w, ch = rgb.shape
            qimg = QImage(rgb.data, w, h, ch * w, QImage.Format_RGB888)
            pixmap = QPixmap.fromImage(qimg)
            self.register_thumb.setPixmap(
                pixmap.scaled(self.register_thumb.width(), self.register_thumb.height(),
                              Qt.KeepAspectRatio, Qt.SmoothTransformation)
            )
        self.register_status.append("Foto capturada. Clique em SALVAR CADASTRO para confirmar.")

    def save_registration(self) -> None:
        name = self.name_input.text().strip()
        if not name:
            self._message("Digite o nome da pessoa.")
            return
        if self.register_frame is None:
            self._message("Capture uma foto antes de salvar.")
            return
        try:
            result = self.registration_service.register(name, self.register_frame)
            self.register_status.append(
                f"[OK] Cadastro salvo: ID {result.person.person_id} | {result.person.name}"
            )
            if result.embedding_path:
                self.register_status.append(
                    f"[OK] Embedding facial salvo: {result.embedding_path.name}"
                )
            self.voice.say(f"{result.person.name} cadastrado.")
            self.refresh_people()

            # Clear and restart preview for next registration
            self.name_input.clear()
            self.register_frame = None
            if hasattr(self, "register_thumb"):
                self.register_thumb.clear()
                self.register_thumb.setText("Nenhuma foto capturada")
            if hasattr(self, "register_live_chip"):
                self.register_live_chip.setText("● INATIVO")
                self.register_live_chip.setStyleSheet(
                    "color:#555555; font-size:10px; font-weight:700; letter-spacing:1px;"
                )
            if not self.register_timer.isActive():
                self.register_timer.start(40)
                if hasattr(self, "register_live_chip"):
                    self.register_live_chip.setText("● AO VIVO")
                    self.register_live_chip.setStyleSheet(
                        "color:#00cc66; font-size:10px; font-weight:700; letter-spacing:1px;"
                    )
        except Exception as exc:
            self._message(f"Erro ao salvar cadastro: {exc}")


    def refresh_people(self) -> None:
        if not hasattr(self, "people_grid"):
            return
        while self.people_grid.count():
            item = self.people_grid.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        query = self.people_search.text() if hasattr(self, "people_search") else ""
        people = self.db.search_people(query)
        if not people:
            self.people_grid.addWidget(QLabel("Nenhuma pessoa cadastrada ainda."), 0, 0)
            return
        for index, person in enumerate(people):
            card = QFrame()
            card_layout = QVBoxLayout(card)
            image_label = QLabel()
            image_label.setFixedSize(210, 160)
            image_label.setAlignment(Qt.AlignCenter)
            pixmap = QPixmap(person.photo_path)
            if not pixmap.isNull():
                image_label.setPixmap(pixmap.scaled(210, 160, Qt.KeepAspectRatio, Qt.SmoothTransformation))
            else:
                image_label.setText("Foto indisponivel")
            card_layout.addWidget(image_label)
            card_layout.addWidget(QLabel(f"ID: {person.person_id}"))
            card_layout.addWidget(QLabel(f"Nome: {person.name}"))
            card_layout.addWidget(QLabel(f"Data: {person.created_at}"))
            history_btn = QPushButton("Historico")
            history_btn.clicked.connect(lambda checked=False, person_id=person.person_id, name=person.name: self.show_person_history(person_id, name))
            card_layout.addWidget(history_btn)
            delete_btn = QPushButton("Excluir")
            delete_btn.setObjectName("DangerButton")
            delete_btn.clicked.connect(
                lambda checked=False, person_id=person.person_id, name=person.name: self.delete_person_from_gallery(person_id, name)
            )
            card_layout.addWidget(delete_btn)
            self.people_grid.addWidget(card, index // 4, index % 4)

    def show_person_history(self, person_id: int, name: str) -> None:
        rows = self.db.person_history(person_id, limit=80)
        if not rows:
            self.person_history_output.setText(f"{name} ainda nao possui identificacoes registradas.")
            return
        lines = [f"Historico de {name} (ID {person_id})", ""]
        for row in rows:
            lines.append(f"{row.timestamp} | track {row.track_id} | {row.event} | conf {row.confidence:.2f}")
        self.person_history_output.setText("\n".join(lines))

    def delete_person_from_gallery(self, person_id: int, name: str) -> None:
        answer = QMessageBox.question(
            self,
            "Excluir cadastro",
            f"Excluir {name} (ID {person_id}) da galeria?\n\nA foto e os embeddings serao removidos.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        files = self.db.delete_person(person_id)
        removed = 0
        for file_name in files:
            path = Path(file_name)
            try:
                if path.exists():
                    path.unlink()
                    removed += 1
                    parent = path.parent
                    if parent.exists() and parent.is_dir() and not any(parent.iterdir()):
                        parent.rmdir()
            except Exception:
                pass
        self.faces.insightface.reload_gallery()
        self.person_history_output.setText(f"{name} foi excluido. Arquivos removidos: {removed}.")
        self.refresh_people()
        self.refresh_logs()

    def refresh_logs(self) -> None:
        if not hasattr(self, "logs_output"):
            return
        rows = self.db.recent_events(limit=120)
        self.logs_output.setText("\n".join(f"{r.timestamp} | ID {r.track_id or '-'} | {r.name or 'UNKNOWN'} | {r.state} | {r.event}" for r in rows))

    def export_logs_csv(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Exportar Logs de Eventos", "quantum_tracker_logs.csv", "Arquivo CSV (*.csv)"
        )
        if not path:
            return
        try:
            import csv
            rows = self.db.recent_events(limit=1000)
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["Timestamp", "Track_ID", "Nome", "Confianca", "Evento", "Estado"])
                for r in rows:
                    writer.writerow([r.timestamp, r.track_id or "", r.name or "", f"{r.confidence:.2f}", r.event, r.state])
            self._message(f"Logs exportados com sucesso para:\n{path}")
        except Exception as exc:
            self._message(f"Erro ao exportar logs: {exc}")

    def select_first_robot_target(self) -> None:
        if not self.current_targets:
            self._message("Nenhum alvo detectado para selecionar.")
            return
        target = self.current_targets[0]
        self.robot_controller.select_target(target)
        self.robot_controller.follow()
        self.target_id_input.setText(str(target.track_id))
        self._append_robot_log(f"Alvo selecionado: ID {target.track_id} {target.name or 'UNKNOWN'}")

    def select_robot_target_by_id(self) -> None:
        raw = self.target_id_input.text().strip()
        if not raw.isdigit():
            self._message("Digite um ID numerico.")
            return
        if self.robot_controller.select_target_by_id(int(raw), self.current_targets):
            self.robot_controller.follow()
            self._append_robot_log(f"Alvo selecionado por ID: {raw}")
        else:
            self._message(f"ID {raw} nao esta ativo agora.")

    def clear_robot_target(self) -> None:
        self.robot_controller.clear_target()
        self._append_robot_log("Alvo liberado. Robo em IDLE.")
        if self.current_robot_telemetry:
            self._update_robot_dashboard(self.current_robot_telemetry)

    def robot_follow(self) -> None:
        self.robot_controller.follow()
        self._append_robot_log("Modo seguir ativado.")

    def robot_stop(self) -> None:
        self.robot_controller.stop()
        self.current_robot_telemetry = self.robot_controller.manual_command(RobotCommand.STOP)
        self._update_robot_dashboard(self.current_robot_telemetry)
        self._append_robot_log("Robo parado por comando manual.")

    def refresh_arduino_ports(self) -> None:
        if not hasattr(self, "arduino_port_combo"):
            return
        ports = self.robot_controller.arduino.available_ports()
        current = self.robot_controller.arduino.port
        self.arduino_port_combo.clear()
        self.arduino_port_combo.addItems(ports or ["Nenhuma porta encontrada"])
        if current and current in ports:
            self.arduino_port_combo.setCurrentText(current)

    def toggle_arduino_connection(self) -> None:
        adapter = self.robot_controller.arduino
        if adapter.connected:
            adapter.disconnect()
            self.robot_status_chip.setText("MODO: SIMULADOR")
            self.arduino_connect_btn.setText("CONECTAR ARDUINO")
            self._append_robot_log("Arduino desconectado; simulador ativo.")
            return
        port = self.arduino_port_combo.currentText()
        if not port or port == "Nenhuma porta encontrada":
            self._message("Conecte o Arduino ao USB e clique em ↻ para localizar a porta COM.")
            return
        ok, message = adapter.connect(port)
        self._append_robot_log(message)
        if ok:
            if not adapter.release_emergency_stop():
                adapter.disconnect()
                self._message("O Arduino conectou, mas não confirmou a liberação segura. Verifique o firmware V5.")
                return
            self.robot_status_chip.setText(f"ARDUINO: {port}")
            self.arduino_connect_btn.setText("DESCONECTAR")
        else:
            self._message(message)

    def robot_manual_command(self, command: RobotCommand) -> None:
        if not self.robot_controller.arduino.connected and (self.mode == "simulator" or not self.running):
            self.world.send_robot_command(command)
        telemetry = self.robot_controller.manual_command(command)
        self.current_robot_telemetry = telemetry
        self._update_robot_dashboard(telemetry)
        self._append_robot_log(f"Comando manual: {command.value}")

    def _update_robot_dashboard(self, telemetry: RobotTelemetry) -> None:
        if not hasattr(self, "robot_dashboard"):
            return
        hardware_connected = self.robot_controller.arduino.connected
        mode_label = (
            f"MODO: ARDUINO UNO CONECTADO ({self.robot_controller.arduino.port})"
            if hardware_connected
            else "MODO: SIMULADOR (nenhum Arduino conectado)"
        )
        lines = [
            mode_label,
            f"Alvo seguido: {telemetry.target_id if telemetry.target_id is not None else '-'}",
            f"Nome: {telemetry.target_name or 'UNKNOWN'}",
            f"Estado robo: {telemetry.state.value}",
            f"Comando atual: {telemetry.command.value}",
            f"Estado visual: {telemetry.target_state or '-'}",
            f"Ghost: {'ATIVO' if telemetry.ghost_active else 'OFF'}",
            f"Gesto override: {telemetry.gesture_override or '-'}",
            f"Distancia estimada: {telemetry.distance_estimate:.2f} m",
            f"Erro horizontal: {telemetry.horizontal_error:.2f}",
            f"Velocidade alvo: {telemetry.speed:.1f}px/frame",
            f"Direcao alvo: {telemetry.direction_degrees:.0f} graus",
            f"Obstaculo virtual: {telemetry.obstacle_distance_cm if telemetry.obstacle_distance_cm is not None else '-'} cm",
            f"Seguranca: {'ATIVA' if telemetry.safety_active else 'INATIVA'}",
            (
                f"Posição visual: x={telemetry.pose.x:.1f} y={telemetry.pose.y:.1f} heading={telemetry.pose.heading_degrees:.1f}"
                if not hardware_connected
                else "Saída física: comandos enviados ao Arduino UNO por cabo USB"
            ),
            f"Motivo: {telemetry.reason}",
            "",
            "Último comando USB Arduino:",
            telemetry.arduino_payload,
        ]
        self.robot_dashboard.setText("\n".join(lines))

    def _append_robot_log(self, message: str) -> None:
        if not hasattr(self, "robot_logs"):
            return
        stamp = time.strftime("%H:%M:%S")
        self.robot_logs.append(f"{stamp} | {message}")

    def _connect_openai(self) -> None:
        key = self.api_key_input.text().strip()
        if not key:
            self._append_chat("sistema", "Digite uma API Key valida para conectar.")
            return
        self.ai_status_label.setText("Conectando...")
        self.ai_status_label.setStyleSheet("color:#ffaa00;")

        def do_connect():
            ok = self.gemini.configure(key)
            # Update UI from main thread
            QTimer.singleShot(0, lambda: self._on_openai_connected(ok))

        threading.Thread(target=do_connect, daemon=True).start()

    def _on_openai_connected(self, ok: bool) -> None:
        if ok:
            self.ai_status_label.setText("QUANTUM AI conectado")
            self.ai_status_label.setStyleSheet("color:#00ff88; font-weight:bold;")
            self._append_chat("ai", "Conexao estabelecida com sucesso! Estou pronto para analisar o campo de rastreamento. Como posso ajudar?")
        else:
            self.ai_status_label.setText(f"Erro: {self.gemini.error_message[:50]}")
            self.ai_status_label.setStyleSheet("color:#ff4444;")
            self._append_chat("sistema", f"Falha na conexao: {self.gemini.error_message}")

    def _update_ai_status(self) -> None:
        if self.gemini.available:
            self.ai_status_label.setText("QUANTUM AI conectado")
            self.ai_status_label.setStyleSheet("color:#00ff88; font-weight:bold;")
        else:
            self.ai_status_label.setText("Offline — configure a API Key")
            self.ai_status_label.setStyleSheet("color:#ff6644;")

    def _reset_ai_chat(self) -> None:
        self.gemini.reset_chat()
        self.chat_display.clear()
        self._append_chat("sistema", "Nova conversa iniciada. Contexto resetado.")

    def _send_ai_message(self) -> None:
        question = self.ai_input.text().strip()
        if not question:
            return
        self.ai_input.clear()
        self._append_chat("user", question)
        self._append_chat("thinking", "QUANTUM AI esta pensando...")

        targets = self.current_targets or []
        fps = self.fps
        mode = self.mode

        def on_answer(answer: str):
            # Remove "thinking" and add real answer
            QTimer.singleShot(0, lambda: self._replace_thinking(answer))

        self.gemini.ask(
            question=question,
            targets=targets,
            fps=fps,
            mode=mode,
            on_done=on_answer,
        )

    def _append_chat(self, role: str, text: str) -> None:
        colors = {
            "user":     ("#003d5c", "#c8ecff", "OPERADOR"),
            "ai":       ("#003320", "#00ff88", "QUANTUM AI"),
            "sistema":  ("#1a1a00", "#ffcc00", "SISTEMA"),
            "thinking": ("#0a0a0a", "#555555", "..."),
        }
        bg, color, label = colors.get(role, ("#111", "#aaa", role.upper()))
        safe_text = escape(text).replace("\n", "<br>")
        html = (
            f'<div style="background:{bg}; border-radius:6px; padding:8px 12px; margin:4px 0;">'
            f'<span style="color:{color}; font-weight:bold; font-size:11px;">{label}</span><br>'
            f'<span style="color:#c8ecff; font-size:13px; line-height:1.45;">{safe_text}</span>'
            f'</div>'
        )
        self.chat_display.append(html)
        self.chat_display.verticalScrollBar().setValue(
            self.chat_display.verticalScrollBar().maximum()
        )

    def _replace_thinking(self, answer: str) -> None:
        """Replace the 'thinking' placeholder with the real answer."""
        cursor = self.chat_display.textCursor()
        cursor.movePosition(cursor.End)
        cursor.select(cursor.BlockUnderCursor)
        if "QUANTUM AI esta pensando" in cursor.selectedText():
            cursor.removeSelectedText()
            cursor.deletePreviousChar()
        self._append_chat("ai", answer)
        self.voice.say(answer[:200])  # speak first 200 chars

    def ask_brain(self) -> None:
        """Legacy method kept for compatibility (speech listener uses it)."""
        question = self.ai_input.text().strip()
        if not question and hasattr(self, 'question_input'):
            question = self.question_input.text().strip()
        if not question:
            return
        if hasattr(self, 'ai_input'):
            self.ai_input.setText(question)
        self._send_ai_message()

    def listen_microphone(self) -> None:
        if hasattr(self, 'chat_display'):
            self._append_chat("sistema", "Ouvindo microfone...")
        self.speech.listen_once()

    def _poll_speech(self) -> None:
        while not self.speech_queue.empty():
            text = self.speech_queue.get()
            if hasattr(self, 'ai_input'):
                self.ai_input.setText(text)
            self.ask_brain()
        while not self.speech.errors.empty():
            err = self.speech.errors.get()
            if hasattr(self, 'chat_display'):
                self._append_chat("sistema", err)

    def generate_report(self) -> None:
        report = self.brain.generate_report(self.db.recent_events(limit=50))
        if hasattr(self, 'chat_display'):
            self._append_chat("ai", report)
        self.voice.say("Relatorio gerado.")

    def rebuild_face_embeddings(self) -> None:
        if not self.faces.available:
            self._message(f"InsightFace indisponivel: {self.faces.last_error}")
            return
        created, failed = self.faces.rebuild_embeddings()
        self._message(f"Base facial reconstruida.\nEmbeddings: {created}\nFalhas: {failed}")

    def _display_frame(self, frame, label: QLabel) -> None:
        if frame is None:
            return
        if cv2 is not None:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        else:
            rgb = frame[:, :, ::-1].copy()
        h, w, ch = rgb.shape
        image = QImage(rgb.data, w, h, ch * w, QImage.Format_RGB888).copy()
        pixmap = QPixmap.fromImage(image)
        label.setPixmap(pixmap.scaled(label.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))

    def _message(self, text: str) -> None:
        QMessageBox.information(self, "QUANTUM TRACKER", text)

    def closeEvent(self, event) -> None:  # noqa: N802
        self.stop()
        self.robot_controller.arduino.disconnect()
        self.register_timer.stop()
        if self.register_capture is not None:
            self.register_capture.release()
        self.voice.stop()
        self.db.close()
        event.accept()
