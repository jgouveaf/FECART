from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4
import unicodedata

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from core.models import IdentityMatch, TrackedTarget
from database.database_manager import DatabaseManager
from recognition.insightface_service import InsightFaceService
from utils.config import AppConfig


class FaceRecognizer:
    """InsightFace-backed identity lookup over the local gallery."""

    def __init__(self, config: AppConfig, database: Optional[DatabaseManager] = None) -> None:
        self.config = config
        self.faces_dir = config.faces_dir
        self.insightface = InsightFaceService(config, database)
        self.available = self.insightface.available
        self.last_error = self.insightface.last_error

    def identify(self, frame, target: TrackedTarget) -> Optional[IdentityMatch]:
        match = self.insightface.identify(frame, target, self.config.face_confidence_threshold)
        self.available = self.insightface.available
        self.last_error = self.insightface.last_error
        return match

    def register_face(self, name: str, image) -> Path:
        if cv2 is None:
            raise RuntimeError("OpenCV nao esta instalado.")
        ascii_name = unicodedata.normalize("NFKD", name.strip()).encode("ascii", "ignore").decode("ascii")
        safe_name = "".join(
            ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in ascii_name
        ).strip("_") or "unknown"
        person_dir = self.faces_dir / safe_name
        person_dir.mkdir(parents=True, exist_ok=True)
        if image is None or getattr(image, "size", 0) == 0:
            raise ValueError("A imagem de cadastro esta vazia.")
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        file_path = person_dir / f"face_{stamp}_{uuid4().hex[:8]}.jpg"
        if not cv2.imwrite(str(file_path), image):
            raise OSError(f"Nao foi possivel gravar a foto em {file_path}")
        return file_path

    def register_embedding_for_person(self, person_id: int, name: str, photo_path: Path, created_at: str = "") -> Optional[Path]:
        from core.models import PersonRecord
        person = PersonRecord(person_id=person_id, name=name, photo_path=str(photo_path), created_at=created_at)
        embedding_path = self.insightface.register_person_embedding(person, photo_path)
        self.available = self.insightface.available
        self.last_error = self.insightface.last_error
        return embedding_path

    def rebuild_embeddings(self) -> tuple[int, int]:
        result = self.insightface.rebuild_embeddings()
        self.available = self.insightface.available
        self.last_error = self.insightface.last_error
        return result
