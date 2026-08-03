from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

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
        safe_name = "".join(ch for ch in name.strip() if ch.isalnum() or ch in ("_", "-")) or "unknown"
        person_dir = self.faces_dir / safe_name
        person_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_path = person_dir / f"face_{stamp}.jpg"
        cv2.imwrite(str(file_path), image)
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
