from __future__ import annotations

import queue
import shutil
import time
from pathlib import Path
from typing import List, Optional

import numpy as np
from PySide6.QtCore import Qt, QThread, QTimer, Signal
from PySide6.QtGui import QIcon, QImage, QPixmap
from PySide6.QtWidgets import (
    QApplication,
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
        self.identity_resolver = IdentityResolver()
        self.snapshot_service = SnapshotService()
        self.robot_controller = RobotController()
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

        self.timer = QTimer(self)
        self.timer.timeout.connect(self._loop)
        self.register_timer = QTimer(self)
        self.register_timer.timeout.connect(self._register_preview_loop)
        self.speech_timer = QTimer(self)
        self.speech_timer.timeout.connect(self._poll_speech)

        self._build_ui()
        self._apply_style()
        self.voice.start()
        self.speech_timer.start(400)

    def _build_ui(self) -> None:
        self.setWindowTitle("QUANTUM TRACKER")
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

        title = QLabel("QUANTUM TRACKER")
        title.setObjectName("Title")
        self.status_label = QLabel("Sistema pronto")
        self.status_label.setObjectName("Status")
        header.addWidget(title)
        header.addStretch(1)
        header.addWidget(self.status_label)
        root.addLayout(header)

        self.tabs = QTabWidget()
        root.addWidget(self.tabs, 1)
        self.tabs.addTab(self._build_monitor_tab(), "Monitoramento")
        self.tabs.addTab(self._build_robot_tab(), "Robo")
        self.tabs.addTab(self._build_register_tab(), "Cadastro")
        self.tabs.addTab(self._build_photos_tab(), "Fotos")
        self.tabs.addTab(self._build_logs_tab(), "Logs")
        self.tabs.addTab(self._build_ai_tab(), "IA")
        self.tabs.addTab(self._build_gesture_trainer_tab(), "Treinar Gestos")
        self.tabs.addTab(self._build_config_tab(), "Configuracoes")

        self.setCentralWidget(central)

    def _build_monitor_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        toolbar = QHBoxLayout()
        self.start_camera_btn = QPushButton("Iniciar Camera")
        self.start_camera_btn.clicked.connect(self.start_camera)
        self.start_sim_btn = QPushButton("Iniciar Simulador")
        self.start_sim_btn.clicked.connect(self.start_simulator)
        ghost_btn = QPushButton("Forcar Ghost")
        ghost_btn.clicked.connect(self.world.force_occlusion)
        stop_btn = QPushButton("Parar")
        stop_btn.clicked.connect(self.stop)
        toolbar.addWidget(self.start_camera_btn)
        toolbar.addWidget(self.start_sim_btn)
        toolbar.addWidget(ghost_btn)
        toolbar.addStretch(1)
        toolbar.addWidget(stop_btn)
        layout.addLayout(toolbar)

        body = QHBoxLayout()
        self.video_label = QLabel("Clique em Iniciar Camera ou Iniciar Simulador")
        self.video_label.setObjectName("Video")
        self.video_label.setAlignment(Qt.AlignCenter)
        self.video_label.setMinimumSize(860, 520)
        body.addWidget(self.video_label, 4)

        side = QVBoxLayout()
        side.setSpacing(6)

        # ── Card: Target Info ────────────────────────────────────────
        card_target = QFrame()
        card_target.setObjectName("SideCard")
        card_layout = QVBoxLayout(card_target)
        card_layout.setContentsMargins(10, 8, 10, 8)
        card_layout.setSpacing(4)
        lbl_card = QLabel("ALVO PRIMARIO")
        lbl_card.setObjectName("CardHeader")
        card_layout.addWidget(lbl_card)
        self.lbl_target_id    = QLabel("ID: —")
        self.lbl_target_name  = QLabel("Nome: —")
        self.lbl_target_conf  = QLabel("Confianca: —")
        self.lbl_target_dist  = QLabel("Distancia: —")
        self.lbl_target_state = QLabel("Estado: —")
        self.lbl_target_speed = QLabel("Velocidade: —")
        for lbl in (self.lbl_target_id, self.lbl_target_name, self.lbl_target_conf,
                    self.lbl_target_dist, self.lbl_target_state, self.lbl_target_speed):
            lbl.setObjectName("InfoValue")
            card_layout.addWidget(lbl)
        side.addWidget(card_target)

        # ── Card: System ─────────────────────────────────────────────
        card_sys = QFrame()
        card_sys.setObjectName("SideCard")
        sys_layout = QVBoxLayout(card_sys)
        sys_layout.setContentsMargins(10, 8, 10, 8)
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

        # ── Event Stream ─────────────────────────────────────────────
        side.addWidget(QLabel("EVENTOS RECENTES"))
        self.event_stream = QTextEdit()
        self.event_stream.setReadOnly(True)
        self.event_stream.setObjectName("PanelText")
        side.addWidget(self.event_stream, 1)

        # ── Telemetria completa ───────────────────────────────────────
        side.addWidget(QLabel("TELEMETRIA"))
        self.monitor_info = QTextEdit()
        self.monitor_info.setReadOnly(True)
        self.monitor_info.setObjectName("PanelText")
        side.addWidget(self.monitor_info, 1)
        body.addLayout(side, 1)
        layout.addLayout(body, 1)
        return page

    def _build_robot_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)

        controls = QHBoxLayout()
        self.target_id_input = QLineEdit()
        self.target_id_input.setPlaceholderText("ID do alvo")
        select_id_btn = QPushButton("Selecionar ID")
        select_id_btn.clicked.connect(self.select_robot_target_by_id)
        select_first_btn = QPushButton("Selecionar Primeiro Alvo")
        select_first_btn.clicked.connect(self.select_first_robot_target)
        follow_btn = QPushButton("Seguir")
        follow_btn.clicked.connect(self.robot_follow)
        stop_btn = QPushButton("Parar")
        stop_btn.clicked.connect(self.robot_stop)
        clear_btn = QPushButton("Liberar Alvo")
        clear_btn.clicked.connect(self.clear_robot_target)
        controls.addWidget(self.target_id_input)
        controls.addWidget(select_id_btn)
        controls.addWidget(select_first_btn)
        controls.addWidget(follow_btn)
        controls.addWidget(stop_btn)
        controls.addWidget(clear_btn)
        layout.addLayout(controls)

        manual = QHBoxLayout()
        for label, command in (
            ("Frente", RobotCommand.FORWARD),
            ("Re", RobotCommand.REVERSE),
            ("Esquerda", RobotCommand.LEFT),
            ("Direita", RobotCommand.RIGHT),
            ("Parar", RobotCommand.STOP),
        ):
            button = QPushButton(label)
            button.clicked.connect(lambda checked=False, command=command: self.robot_manual_command(command))
            manual.addWidget(button)
        layout.addLayout(manual)

        body = QHBoxLayout()
        self.robot_dashboard = QTextEdit()
        self.robot_dashboard.setReadOnly(True)
        self.robot_dashboard.setObjectName("PanelText")
        self.robot_dashboard.setText("Robo em modo simulador. Selecione um alvo no monitoramento.")
        body.addWidget(self.robot_dashboard, 2)

        self.robot_logs = QTextEdit()
        self.robot_logs.setReadOnly(True)
        self.robot_logs.setObjectName("PanelText")
        self.robot_logs.setText("Logs do robo aparecerao aqui.")
        body.addWidget(self.robot_logs, 1)
        layout.addLayout(body, 1)
        return page

    def _build_register_tab(self) -> QWidget:
        page = QWidget()
        layout = QHBoxLayout(page)
        left = QVBoxLayout()
        self.register_video = QLabel("Preview de cadastro")
        self.register_video.setObjectName("Video")
        self.register_video.setAlignment(Qt.AlignCenter)
        self.register_video.setMinimumSize(720, 500)
        left.addWidget(self.register_video)
        layout.addLayout(left, 2)

        right = QVBoxLayout()
        right.addWidget(QLabel("Nome da pessoa"))
        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("Ex: Joao")
        right.addWidget(self.name_input)
        preview_btn = QPushButton("Abrir Camera de Cadastro")
        preview_btn.clicked.connect(self.start_register_preview)
        capture_btn = QPushButton("Capturar Foto")
        capture_btn.clicked.connect(self.capture_register_photo)
        save_btn = QPushButton("Salvar Cadastro")
        save_btn.clicked.connect(self.save_registration)
        right.addWidget(preview_btn)
        right.addWidget(capture_btn)
        right.addWidget(save_btn)
        self.register_status = QTextEdit()
        self.register_status.setReadOnly(True)
        self.register_status.setObjectName("PanelText")
        right.addWidget(self.register_status, 1)
        right.addStretch(1)
        layout.addLayout(right, 1)
        return page

    def _build_photos_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        refresh = QPushButton("Atualizar Fotos")
        refresh.clicked.connect(self.refresh_people)
        search_row = QHBoxLayout()
        self.people_search = QLineEdit()
        self.people_search.setPlaceholderText("Pesquisar por nome ou ID")
        self.people_search.textChanged.connect(self.refresh_people)
        search_row.addWidget(self.people_search, 1)
        search_row.addWidget(refresh)
        layout.addLayout(search_row)
        self.people_scroll = QScrollArea()
        self.people_scroll.setWidgetResizable(True)
        self.people_container = QWidget()
        self.people_grid = QGridLayout(self.people_container)
        self.people_scroll.setWidget(self.people_container)
        layout.addWidget(self.people_scroll, 2)
        self.person_history_output = QTextEdit()
        self.person_history_output.setReadOnly(True)
        self.person_history_output.setObjectName("PanelText")
        self.person_history_output.setPlaceholderText("Selecione uma pessoa para ver o historico.")
        layout.addWidget(self.person_history_output, 1)
        self.refresh_people()
        return page

    def _build_logs_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        refresh = QPushButton("Atualizar Logs")
        refresh.clicked.connect(self.refresh_logs)
        layout.addWidget(refresh, alignment=Qt.AlignRight)
        self.logs_output = QTextEdit()
        self.logs_output.setReadOnly(True)
        self.logs_output.setObjectName("PanelText")
        layout.addWidget(self.logs_output, 1)
        self.refresh_logs()
        return page

    def _build_ai_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        # Header
        header = QHBoxLayout()
        lbl_title = QLabel("QUANTUM AI  ─  Assistente Inteligente")
        lbl_title.setObjectName("CardHeader")
        lbl_title.setStyleSheet("color:#00e5ff; font-size:14px; font-weight:700; letter-spacing:2px;")
        self.ai_status_label = QLabel("Verificando conexao...")
        self.ai_status_label.setStyleSheet("color:#ffaa00; font-size:11px; font-family:Consolas;")
        header.addWidget(lbl_title)
        header.addStretch()
        header.addWidget(self.ai_status_label)
        layout.addLayout(header)

        # API Key config bar
        key_row = QHBoxLayout()
        key_lbl = QLabel("API Key Gemini:")
        key_lbl.setFixedWidth(110)
        self.api_key_input = QLineEdit()
        self.api_key_input.setPlaceholderText("Cole sua API Key do Google AI Studio aqui...")
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_input.setText(self.config.gemini_api_key)
        connect_btn = QPushButton("Conectar")
        connect_btn.setFixedWidth(100)
        connect_btn.clicked.connect(self._connect_gemini)
        new_chat_btn = QPushButton("Nova Conversa")
        new_chat_btn.setFixedWidth(120)
        new_chat_btn.clicked.connect(self._reset_ai_chat)
        key_row.addWidget(key_lbl)
        key_row.addWidget(self.api_key_input, 1)
        key_row.addWidget(connect_btn)
        key_row.addWidget(new_chat_btn)
        layout.addLayout(key_row)

        # Chat history display
        self.chat_display = QTextEdit()
        self.chat_display.setReadOnly(True)
        self.chat_display.setObjectName("PanelText")
        self.chat_display.setStyleSheet("""
            QTextEdit {
                background: #040b14;
                border: 1px solid #0d3550;
                border-radius: 8px;
                padding: 10px;
                font-family: 'Segoe UI', sans-serif;
                font-size: 13px;
                color: #c8ecff;
            }
        """)
        welcome = (
            "<div style='color:#00e5ff; font-weight:bold;'>QUANTUM AI inicializado.</div>"
            "<div style='color:#7ab8d4; font-size:12px;'>Pergunte qualquer coisa sobre o rastreamento, "
            "os alvos detectados, o ghost mode ou peca uma analise da situacao atual.</div>"
            "<br><div style='color:#4a7a8a; font-size:11px;'>Dicas: \"Quantos alvos tem na tela?\", "
            "\"O ghost mode ta ativo?\", \"Analise a situacao atual\"</div>"
        )
        self.chat_display.setHtml(welcome)
        layout.addWidget(self.chat_display, 1)

        # Input area
        input_row = QHBoxLayout()
        self.ai_input = QLineEdit()
        self.ai_input.setPlaceholderText("Digite sua pergunta para o QUANTUM AI...")
        self.ai_input.setMinimumHeight(38)
        self.ai_input.returnPressed.connect(self._send_ai_message)
        send_btn = QPushButton("Enviar")
        send_btn.setMinimumHeight(38)
        send_btn.setFixedWidth(90)
        send_btn.clicked.connect(self._send_ai_message)
        mic_btn = QPushButton("Microfone")
        mic_btn.setMinimumHeight(38)
        mic_btn.setFixedWidth(100)
        mic_btn.clicked.connect(self.listen_microphone)
        report_btn = QPushButton("Relatorio IA")
        report_btn.setMinimumHeight(38)
        report_btn.setFixedWidth(110)
        report_btn.clicked.connect(self.generate_report)
        input_row.addWidget(self.ai_input, 1)
        input_row.addWidget(send_btn)
        input_row.addWidget(mic_btn)
        input_row.addWidget(report_btn)
        layout.addLayout(input_row)

        # Update status label after a moment
        QTimer.singleShot(1500, self._update_ai_status)
        return page

    # ──────────────────────────────────────────────────────────────────
    # Gesture Trainer Tab — Teachable Machine style
    # ──────────────────────────────────────────────────────────────────

    def _build_gesture_trainer_tab(self) -> QWidget:
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(12)

        # ── Header ────────────────────────────────────────────────────
        title = QLabel("🧠  TREINAR GESTOS  —  Teachable Machine")
        title.setObjectName("Title")
        title.setStyleSheet("font-size:16px; font-weight:800; color:#00e5ff; letter-spacing:2px;")
        outer.addWidget(title)

        sub = QLabel(
            "Crie classes, grave amostras pela câmera (ou importe um vídeo) e treine a IA para reconhecer seus gestos."
        )
        sub.setWordWrap(True)
        sub.setStyleSheet("color:#7ab8d4; font-size:12px;")
        outer.addWidget(sub)

        body = QHBoxLayout()
        outer.addLayout(body, 1)

        # ── Left: class list + add ─────────────────────────────────────
        left = QVBoxLayout()
        body.addLayout(left, 1)

        add_row = QHBoxLayout()
        self.gt_class_input = QLineEdit()
        self.gt_class_input.setPlaceholderText("Nome da classe (ex: DIREITA)")
        add_btn = QPushButton("＋ Nova Classe")
        add_btn.clicked.connect(self._gt_add_class)
        add_row.addWidget(self.gt_class_input, 1)
        add_row.addWidget(add_btn)
        left.addLayout(add_row)

        self.gt_class_list = QTextEdit()
        self.gt_class_list.setReadOnly(True)
        self.gt_class_list.setObjectName("PanelText")
        self.gt_class_list.setPlaceholderText("Nenhuma classe criada ainda...")
        left.addWidget(QLabel("Classes e Amostras:"), 0)
        left.addWidget(self.gt_class_list, 1)

        # Selected class
        sel_row = QHBoxLayout()
        self.gt_selected_label = QLabel("Classe selecionada: —")
        self.gt_selected_label.setStyleSheet("color:#00e5ff; font-weight:bold;")
        self.gt_selected_input = QLineEdit()
        self.gt_selected_input.setPlaceholderText("Classe para gravar/importar")
        sel_row.addWidget(self.gt_selected_input, 1)
        left.addLayout(sel_row)
        left.addWidget(self.gt_selected_label)

        # ── Center: actions ───────────────────────────────────────────
        center = QVBoxLayout()
        body.addLayout(center, 1)

        center.addWidget(QLabel("📷  Gravar pela Câmera:"))
        self.gt_record_secs = QLineEdit("5")
        self.gt_record_secs.setPlaceholderText("Segundos de gravação")
        self.gt_record_secs.setFixedWidth(80)
        rec_row = QHBoxLayout()
        rec_row.addWidget(QLabel("Duração (s):"))
        rec_row.addWidget(self.gt_record_secs)
        rec_row.addStretch()
        center.addLayout(rec_row)

        self.gt_record_btn = QPushButton("● GRAVAR GESTO")
        self.gt_record_btn.setStyleSheet(
            "background: qlineargradient(x1:0,y1:0,x2:0,y2:1,stop:0 #3d1420,stop:1 #7a0000);"
            "color:#ff8a80; border:1px solid #c0392b; border-radius:6px; padding:10px; font-size:13px; font-weight:700;"
        )
        self.gt_record_btn.clicked.connect(self._gt_start_record)
        center.addWidget(self.gt_record_btn)

        center.addSpacing(16)
        center.addWidget(QLabel("🎬  Importar Vídeo (.mp4 / .avi):"))
        import_btn = QPushButton("📁  Importar Vídeo")
        import_btn.clicked.connect(self._gt_import_video)
        center.addWidget(import_btn)

        center.addSpacing(16)
        center.addWidget(QLabel("🗑️  Gerenciar Classes:"))
        del_btn = QPushButton("Remover Classe Selecionada")
        del_btn.setObjectName("DangerButton")
        del_btn.clicked.connect(self._gt_remove_class)
        center.addWidget(del_btn)

        reset_btn = QPushButton("⟳ Resetar Tudo")
        reset_btn.setObjectName("DangerButton")
        reset_btn.clicked.connect(self._gt_reset)
        center.addWidget(reset_btn)

        center.addStretch(1)

        # ── Right: train + status ─────────────────────────────────────
        right = QVBoxLayout()
        body.addLayout(right, 1)

        right.addWidget(QLabel("🚀  Treinar Modelo:"))
        train_btn = QPushButton("🧠  TREINAR IA")
        train_btn.setStyleSheet(
            "background: qlineargradient(x1:0,y1:0,x2:0,y2:1,stop:0 #0d3d14,stop:1 #07200a);"
            "color:#69ff6a; border:1px solid #1e8c20; border-radius:6px; padding:12px; font-size:14px; font-weight:800;"
        )
        train_btn.clicked.connect(self._gt_train)
        right.addWidget(train_btn)

        self.gt_progress = QProgressBar()
        self.gt_progress.setValue(0)
        self.gt_progress.setStyleSheet(
            "QProgressBar{background:#060f19;border:1px solid #1a3a52;border-radius:4px;height:18px;}"
            "QProgressBar::chunk{background:qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #00a8c5,stop:1 #00e5ff);border-radius:4px;}"
        )
        right.addWidget(self.gt_progress)

        right.addSpacing(10)
        right.addWidget(QLabel("📋  Status / Log:"))
        self.gt_status = QTextEdit()
        self.gt_status.setReadOnly(True)
        self.gt_status.setObjectName("PanelText")
        self.gt_status.setText(
            "Nenhum modelo treinado ainda.\n"
            "Modo atual: regras manuais (fallback).\n\n"
            "Como usar:\n"
            "1. Crie classes com os nomes dos gestos\n"
            "2. Selecione uma classe no campo abaixo\n"
            "3. Grave amostras ou importe um vídeo\n"
            "4. Repita para cada gesto\n"
            "5. Clique TREINAR IA\n"
        )
        right.addWidget(self.gt_status, 1)

        # State
        self._gt_recording = False
        self._gt_record_timer: Optional[QTimer] = None
        self._gt_record_deadline = 0.0
        self._gt_recorded_class = ""

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
        name = self.gt_selected_input.text().strip().upper()
        if not name:
            self.gt_status.append("⚠ Digite o nome da classe no campo de seleção.")
            return
        self.gesture_trainer.remove_class(name)
        self._gt_refresh_list()
        self.gt_status.append(f"✗ Classe '{name}' removida.")

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

    def _gt_start_record(self) -> None:
        if cv2 is None:
            self.gt_status.append("⚠ OpenCV não instalado.")
            return
        if not self.running or self.mode != "camera":
            self.gt_status.append("⚠ Inicie a câmera na aba Monitoramento primeiro!")
            return
        cls = self.gt_selected_input.text().strip().upper()
        if not cls:
            self.gt_status.append("⚠ Digite o nome da classe no campo de seleção.")
            return
        if cls not in self.gesture_trainer.classes():
            self.gesture_trainer.add_class(cls)
            self._gt_refresh_list()

        try:
            secs = float(self.gt_record_secs.text()) if self.gt_record_secs.text() else 5.0
        except ValueError:
            secs = 5.0

        self._gt_recording = True
        self._gt_recorded_class = cls
        self._gt_record_deadline = time.time() + secs
        self.gt_record_btn.setText("● GRAVANDO...")
        self.gt_record_btn.setEnabled(False)
        self.gt_status.append(f"● Gravando '{cls}' por {secs:.0f}s — Faça o gesto agora!")

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
            self._gt_refresh_list()

    def _gt_stop_record(self) -> None:
        self._gt_recording = False
        if self._gt_record_timer:
            self._gt_record_timer.stop()
        self.gt_record_btn.setText("● GRAVAR GESTO")
        self.gt_record_btn.setEnabled(True)
        count = self.gesture_trainer.sample_count(self._gt_recorded_class)
        self.gt_status.append(f"✓ Gravação concluída. '{self._gt_recorded_class}': {count} amostras.")
        self._gt_refresh_list()

    def _gt_import_video(self) -> None:
        cls = self.gt_selected_input.text().strip().upper()
        if not cls:
            self.gt_status.append("⚠ Digite o nome da classe no campo de seleção.")
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
        self.gt_status.append("🧠 Treinando modelo...")
        self.gt_progress.setValue(0)

        def _progress(val: int) -> None:
            self.gt_progress.setValue(val)

        ok, msg = self.gesture_trainer.train(progress_cb=_progress)
        if ok:
            self.gestures.reload_model(self.config.assets_dir)
            self.gt_status.append(f"✅ {msg}")
            self.gt_status.append("Modo: MODELO TREINADO ativo. Testando ao vivo na aba Monitoramento!")
            self.voice.say("Modelo de gestos treinado com sucesso.")
        else:
            self.gt_status.append(f"❌ {msg}")

    def _gt_refresh_list(self) -> None:
        if not hasattr(self, "gt_class_list"):
            return
        lines = []
        for cls in self.gesture_trainer.classes():
            n = self.gesture_trainer.sample_count(cls)
            bar = "█" * min(20, n // 5) + "░" * max(0, 20 - n // 5)
            lines.append(f"  {cls:<20} {n:>4} amostras  [{bar}]")
        if not lines:
            lines = ["  Nenhuma classe ainda."]
        total = self.gesture_trainer.total_samples()
        lines.append(f"\n  Total: {total} amostras em {len(self.gesture_trainer.classes())} classe(s)")
        self.gt_class_list.setText("\n".join(lines))

    def _build_config_tab(self) -> QWidget:

        page = QWidget()
        layout = QVBoxLayout(page)
        info = QTextEdit()
        info.setReadOnly(True)
        info.setObjectName("PanelText")
        info.setText(
            "\n".join(
                [
                    f"Projeto: {self.config.project_root}",
                    f"Banco: {self.config.database_path}",
                    f"Faces: {self.config.faces_dir}",
                    f"Detector: {self.detector.backend_name}",
                    f"Modelo YOLO: {self.config.yolo_model}",
                    f"InsightFace: {'ativo' if self.faces.available else self.faces.last_error or 'indisponivel'}",
                    f"Gestos MediaPipe: {'ativo' if self.gestures.available else 'indisponivel'}",
                    f"Gemini: {'configurado' if self.config.gemini_api_key else 'nao configurado'}",
                ]
            )
        )
        layout.addWidget(info, 1)
        rebuild_btn = QPushButton("Recriar Base Facial")
        rebuild_btn.clicked.connect(self.rebuild_face_embeddings)
        layout.addWidget(rebuild_btn, alignment=Qt.AlignRight)
        return page

    def _apply_style(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow, QWidget {
                background-color: #080d14;
                color: #c8ecff;
                font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
                font-size: 13px;
            }
            #Title {
                color: #00e5ff;
                font-size: 22px;
                font-weight: 800;
                letter-spacing: 3px;
                padding: 4px 0;
            }
            #Status {
                color: #4fc3f7;
                font-family: Consolas, monospace;
                font-size: 12px;
                padding: 4px 10px;
                border: 1px solid #1a4a5e;
                border-radius: 4px;
                background: #0d1e2e;
            }
            QTabWidget::pane {
                border: 1px solid #1a3a52;
                border-radius: 6px;
                background: #0b1522;
                margin-top: -1px;
            }
            QTabBar::tab {
                background: #0d1a26;
                color: #7ab8d4;
                padding: 9px 20px;
                border: 1px solid #1a3a52;
                border-bottom: none;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                margin-right: 2px;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 1px;
            }
            QTabBar::tab:selected {
                background: #0b1522;
                color: #00e5ff;
                border-top: 2px solid #00e5ff;
            }
            QTabBar::tab:hover:!selected {
                background: #112233;
                color: #b0d8f0;
            }
            QPushButton {
                background: qlineargradient(x1:0,y1:0,x2:0,y2:1,stop:0 #14374f,stop:1 #0d2538);
                color: #00e5ff;
                border: 1px solid #1e5c7a;
                border-radius: 6px;
                padding: 8px 18px;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 1px;
            }
            QPushButton:hover {
                background: qlineargradient(x1:0,y1:0,x2:0,y2:1,stop:0 #1e4f72,stop:1 #133650);
                border-color: #00e5ff;
                color: #ffffff;
            }
            QPushButton:pressed {
                background: #081a27;
                border-color: #00b8d4;
            }
            QPushButton:disabled {
                background: #0a1622;
                color: #2a4e60;
                border-color: #142030;
            }
            #DangerButton {
                background: qlineargradient(x1:0,y1:0,x2:0,y2:1,stop:0 #3d1420,stop:1 #250c14);
                border-color: #c0392b;
                color: #ff8a80;
            }
            #DangerButton:hover {
                background: #5a1e2e;
                border-color: #ff5252;
                color: #ffffff;
            }
            QLineEdit {
                background: #060f19;
                border: 1px solid #1a3a52;
                border-radius: 5px;
                color: #c8ecff;
                padding: 7px 10px;
                font-size: 13px;
                selection-background-color: #1a5c7a;
            }
            QLineEdit:focus { border-color: #00e5ff; }
            QTextEdit, QPlainTextEdit {
                background: #060f19;
                border: 1px solid #1a3a52;
                border-radius: 5px;
                color: #a0cce0;
                padding: 8px;
                font-family: Consolas, 'Courier New', monospace;
                font-size: 12px;
                selection-background-color: #1a5c7a;
            }
            QScrollBar:vertical {
                background: #060f19; width: 8px; margin: 0;
            }
            QScrollBar::handle:vertical {
                background: #1a4a62; border-radius: 4px; min-height: 30px;
            }
            QScrollBar::handle:vertical:hover { background: #00a8c5; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
            QScrollBar:horizontal { background: #060f19; height: 8px; }
            QScrollBar::handle:horizontal {
                background: #1a4a62; border-radius: 4px; min-width: 30px;
            }
            QScrollBar::handle:horizontal:hover { background: #00a8c5; }
            QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0; }
            QLabel {
                color: #7ab8d4;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 1px;
            }
            #Video {
                background: #02060e;
                border: 1px solid #1a3a52;
                border-radius: 6px;
                color: #00e5ff;
                font-size: 14px;
            }
            #PanelText {
                font-family: Consolas, monospace;
                font-size: 11px;
                color: #7ab8d4;
                background: #040b14;
                border: 1px solid #122030;
            }
            QFrame {
                background: #0a1622;
                border: 1px solid #1a3a52;
                border-radius: 6px;
            }
            QScrollArea { border: none; background: transparent; }
            #SideCard {
                background: #080f1c;
                border: 1px solid #0d3550;
                border-radius: 8px;
                margin-bottom: 2px;
            }
            #CardHeader {
                color: #00e5ff;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 2px;
                padding-bottom: 4px;
                border-bottom: 1px solid #0d3550;
                margin-bottom: 4px;
            }
            #InfoValue {
                color: #c8ecff;
                font-family: Consolas, monospace;
                font-size: 12px;
                font-weight: 400;
                letter-spacing: 0px;
                padding: 1px 0;
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
        snapshot = SystemSnapshot(self.fps, targets, self.db.recent_events(limit=6), self.mode.upper(), active_gesture=active_g)
        hud_frame = self.hud.draw(frame, snapshot)
        self._display_frame(hud_frame, self.video_label)
        self._update_monitor_panel(targets)
        if self.frame_counter % 5 == 0:
            self.db.log_track_observations(targets)
            for target in targets:
                self.db.upsert_track_session(target)
        for event in events:
            self._handle_event(event)

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
            }
            self.voice.say(_voz_map.get(gesture.command, f"Gesto {gesture.command}"))
        return targets, events

    def _update_robot_controller(self, targets, frame) -> None:
        h, w = frame.shape[:2]
        gesture = self.active_gesture_command if time.time() - self.last_gesture_time <= 1.4 else None
        if gesture is None:
            self.active_gesture_command = None
        telemetry = self.robot_controller.update(targets, (w, h), gesture)
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
            self.brain_output.append(f"\nQUANTUM: {text}")
            self.voice.say(text)
        self.refresh_logs()

    def _update_monitor_panel(self, targets) -> None:
        metrics = self.snapshot_service.build_metrics(targets)
        stats = self.db.stats_summary()

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
            "",
        ]
        for target in targets:
            lines.append(
                f"ID {target.track_id} | {target.name or 'UNKNOWN'} | {target.state.value} | "
                f"conf {target.confidence:.2f} | vel {target.speed:.1f}px/f"
            )
        self.monitor_info.setText("\n".join(lines))

        # ── Stream de eventos ─────────────────────────────────────────
        logs = self.db.recent_events(limit=10)
        self.event_stream.setText("\n".join(
            f"{log.timestamp[-8:]} | {log.event} | ID {log.track_id or '-'}" for log in logs
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
        self.register_status.append("Foto capturada. Agora clique em Salvar Cadastro.")

    def save_registration(self) -> None:
        name = self.name_input.text().strip()
        if not name:
            self._message("Digite o nome da pessoa.")
            return
        if self.register_frame is None:
            self._message("Capture uma foto antes de salvar.")
            return
        try:
            photo_path = self.faces.register_face(name, self.register_frame)
            person_id = self.db.add_person(name, str(photo_path))
            embedding_path = self.faces.register_embedding_for_person(person_id, name, photo_path)
            self.register_status.append(f"Cadastro salvo: ID {person_id} | {name}")
            if embedding_path:
                self.register_status.append(f"Embedding facial salvo: {embedding_path.name}")
            elif self.faces.last_error:
                self.register_status.append(f"Reconhecimento facial indisponivel: {self.faces.last_error}")
            self.voice.say(f"{name} cadastrado.")
            self.refresh_people()
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
        self._append_robot_log("Robo parado por comando manual.")

    def robot_manual_command(self, command: RobotCommand) -> None:
        if self.mode == "simulator" or not self.running:
            self.world.send_robot_command(command)
        telemetry = self.robot_controller.manual_command(command)
        self.current_robot_telemetry = telemetry
        self._update_robot_dashboard(telemetry)
        self._append_robot_log(f"Comando manual: {command.value}")

    def _update_robot_dashboard(self, telemetry: RobotTelemetry) -> None:
        if not hasattr(self, "robot_dashboard"):
            return
        lines = [
            "MODO: SIMULADOR / HARDWARE DESATIVADO",
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
            f"Pose simulada: x={telemetry.pose.x:.1f} y={telemetry.pose.y:.1f} heading={telemetry.pose.heading_degrees:.1f}",
            f"Motivo: {telemetry.reason}",
            "",
            "Payload futuro ESP32:",
            telemetry.esp32_payload,
        ]
        self.robot_dashboard.setText("\n".join(lines))

    def _append_robot_log(self, message: str) -> None:
        if not hasattr(self, "robot_logs"):
            return
        stamp = time.strftime("%H:%M:%S")
        self.robot_logs.append(f"{stamp} | {message}")

    def _connect_gemini(self) -> None:
        key = self.api_key_input.text().strip()
        if not key:
            self._append_chat("sistema", "Digite uma API Key valida para conectar.")
            return
        self.ai_status_label.setText("Conectando...")
        self.ai_status_label.setStyleSheet("color:#ffaa00;")

        def do_connect():
            ok = self.gemini.configure(key)
            # Update UI from main thread
            QTimer.singleShot(0, lambda: self._on_gemini_connected(ok))

        threading.Thread(target=do_connect, daemon=True).start()

    def _on_gemini_connected(self, ok: bool) -> None:
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
        html = (
            f'<div style="background:{bg}; border-radius:6px; padding:8px 12px; margin:4px 0;">'
            f'<span style="color:{color}; font-weight:bold; font-size:11px;">{label}</span><br>'
            f'<span style="color:#c8ecff; font-size:13px;">{text}</span>'
            f'</div>'
        )
        self.chat_display.append(html)
        self.chat_display.verticalScrollBar().setValue(
            self.chat_display.verticalScrollBar().maximum()
        )

    def _replace_thinking(self, answer: str) -> None:
        """Replace the 'thinking' placeholder with the real answer."""
        cursor = self.chat_display.textCursor()
        html = self.chat_display.toHtml()
        # Remove last thinking block and re-render
        if "QUANTUM AI esta pensando" in html:
            self.chat_display.undo()  # remove thinking message
        self._append_chat("ai", answer)
        self.voice.say(answer[:200])  # speak first 200 chars

    def ask_brain(self) -> None:
        """Legacy method kept for compatibility (speech listener uses it)."""
        question = self.ai_input.text().strip() or getattr(self, 'question_input', None) and self.question_input.text().strip()
        if not question:
            return
        if hasattr(self, 'ai_input'):
            self.ai_input.setText(question)
        self._send_ai_message()

    def listen_microphone(self) -> None:
        self.brain_output.append("\nQUANTUM: Ouvindo microfone...")
        self.speech.listen_once()

    def _poll_speech(self) -> None:
        while not self.speech_queue.empty():
            text = self.speech_queue.get()
            self.question_input.setText(text)
            self.ask_brain()
        while not self.speech.errors.empty():
            self.brain_output.append(f"\nQUANTUM: {self.speech.errors.get()}")

    def generate_report(self) -> None:
        report = self.brain.generate_report(self.db.recent_events(limit=50))
        self.brain_output.setText(report)
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
        self.register_timer.stop()
        if self.register_capture is not None:
            self.register_capture.release()
        self.voice.stop()
        self.db.close()
        event.accept()
