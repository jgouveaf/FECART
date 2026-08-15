from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


# Detecta se está rodando via PyInstaller (.exe)
if getattr(sys, 'frozen', False):
    INTERNAL_ROOT = Path(sys._MEIPASS)
    PROJECT_ROOT = Path(sys.executable).parent
else:
    INTERNAL_ROOT = Path(__file__).resolve().parents[1]
    PROJECT_ROOT = INTERNAL_ROOT

try:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
except Exception:
    pass

# Para total portabilidade, salvar dados na mesma pasta do .exe
USER_DATA_DIR = PROJECT_ROOT / "data"


@dataclass(frozen=True)
class AppConfig:
    project_root: Path = PROJECT_ROOT
    assets_dir: Path = INTERNAL_ROOT / "assets"

    # Pastas de dados dinâmicos do usuário
    faces_dir: Path = USER_DATA_DIR / "faces"
    embeddings_dir: Path = USER_DATA_DIR / "embeddings"
    logs_dir: Path = USER_DATA_DIR / "logs"
    database_path: Path = USER_DATA_DIR / "database" / "quantum_tracker.sqlite3"

    # Modelos IA
    insightface_root: Path = INTERNAL_ROOT / "assets" / "insightface_models"

    # Câmera: 720p é suficiente e reduz o custo de leitura/transferência
    camera_index: int = 0
    frame_width: int = 1280
    frame_height: int = 720
    ui_tick_ms: int = 30

    # Modelo YOLO
    yolo_model: str = str(INTERNAL_ROOT / "yolov8n.pt") if (INTERNAL_ROOT / "yolov8n.pt").exists() else "yolov8n.pt"
    yolo_tracker: str = "bytetrack.yaml"

    # ── Performance (notebook sem GPU) ─────────────────────────────────
    # Resolução de inferência: 320=mais rápido | 416=balanceado | 640=mais preciso
    yolo_infer_size: int = 416
    # Roda YOLO a cada N frames (frames no meio reutilizam último resultado)
    yolo_detect_interval: int = 2
    # FP16 só funciona com CUDA; em CPU deve ficar False
    yolo_half_precision: bool = False

    # Rastreamento
    detection_confidence: float = 0.42
    face_recognition_interval: int = 12
    face_confidence_threshold: float = 0.42
    occluded_after_frames: int = 2
    ghost_after_frames: int = 8
    lost_after_frames: int = 60
    remove_after_frames: int = 120
    max_match_distance: float = 95.0

    # Outros
    voice_enabled: bool = True
    # Hardware fisico e validado somente na Etapa 10. Enquanto False, nem
    # portas COM sao enumeradas e nenhuma conexao serial pode ser aberta.
    hardware_enabled: bool = False
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def load_config() -> AppConfig:
    config = AppConfig()
    for path in (config.faces_dir, config.embeddings_dir, config.logs_dir, config.database_path.parent):
        path.mkdir(parents=True, exist_ok=True)
    return config
