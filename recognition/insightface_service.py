from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

from core.models import IdentityMatch, PersonRecord, TrackedTarget
from database.database_manager import DatabaseManager
from utils.config import AppConfig


@dataclass(frozen=True)
class KnownFace:
    person_id: int
    name: str
    embedding_id: Optional[int]
    embedding: np.ndarray


class InsightFaceService:
    """Face embedding service using InsightFace, with a clean unavailable mode."""

    def __init__(self, config: AppConfig, database: Optional[DatabaseManager] = None) -> None:
        self.config = config
        self.database = database
        self.available = False
        self.last_error = ""
        self.app = None
        self.known_faces: List[KnownFace] = []
        try:
            from insightface.app import FaceAnalysis

            providers = ["CPUExecutionProvider"]
            self.config.insightface_root.mkdir(parents=True, exist_ok=True)
            self.app = FaceAnalysis(name="buffalo_l", root=str(self.config.insightface_root), providers=providers)
            self.app.prepare(ctx_id=0, det_size=(320, 320))
            self.available = True
        except Exception as exc:
            self.last_error = f"InsightFace indisponivel: {exc}"
            self.available = False
        if self.available and database is not None:
            self.reload_gallery()

    def reload_gallery(self) -> None:
        self.known_faces.clear()
        if not self.available or self.database is None:
            return
        people_by_id = {person.person_id: person for person in self.database.list_people()}
        for record in self.database.list_face_embeddings():
            person = people_by_id.get(record.person_id)
            if person is None:
                continue
            embedding = self._load_embedding(Path(record.embedding_path))
            if embedding is None:
                continue
            self.known_faces.append(KnownFace(person.person_id, person.name, record.embedding_id, embedding))

    def identify(self, frame, target: TrackedTarget, threshold: float = 0.42) -> Optional[IdentityMatch]:
        if not self.available or not self.known_faces:
            return None
        crop = self._crop_target(frame, target)
        if crop is None:
            return None
        embedding = self._extract_embedding(crop)
        if embedding is None:
            return None

        best: Optional[KnownFace] = None
        best_score = -1.0
        for known in self.known_faces:
            score = self._cosine_similarity(embedding, known.embedding)
            if score > best_score:
                best = known
                best_score = score
        if best is None or best_score < threshold:
            return None
        return IdentityMatch(best.person_id, best.name, float(best_score), best.embedding_id)

    def register_person_embedding(self, person: PersonRecord, photo_path: Path) -> Optional[Path]:
        if not self.available or self.database is None or cv2 is None:
            return None
        image = cv2.imread(str(photo_path))
        if image is None:
            return None
        embedding = self._extract_embedding(image)
        if embedding is None:
            return None
        embedding_dir = self.config.assets_dir / "embeddings"
        embedding_dir.mkdir(parents=True, exist_ok=True)
        embedding_path = embedding_dir / f"person_{person.person_id}_{photo_path.stem}.npy"
        np.save(str(embedding_path), embedding)
        self.database.add_face_embedding(person.person_id, str(embedding_path), str(photo_path))
        self.reload_gallery()
        return embedding_path

    def rebuild_embeddings(self) -> tuple[int, int]:
        if self.database is None:
            return (0, 0)
        if not self.available:
            return (0, len(self.database.list_people()))
        people = self.database.list_people()
        self.database.clear_face_embeddings()
        created = 0
        failed = 0
        for person in people:
            path = Path(person.photo_path)
            if not path.exists():
                failed += 1
                continue
            if self.register_person_embedding(person, path) is None:
                failed += 1
            else:
                created += 1
        self.reload_gallery()
        return (created, failed)

    def _crop_target(self, frame, target: TrackedTarget):
        if frame is None:
            return None
        x1, y1, x2, y2 = map(int, (target.bbox.x1, target.bbox.y1, target.bbox.x2, target.bbox.y2))
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            return None
        return frame[y1:y2, x1:x2]

    def _extract_embedding(self, image) -> Optional[np.ndarray]:
        if self.app is None:
            return None
        try:
            faces = self.app.get(image)
        except Exception as exc:
            self.last_error = f"Falha InsightFace: {exc}"
            return None
        if not faces:
            return None
        face = max(faces, key=lambda item: (item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1]))
        embedding = np.asarray(face.embedding, dtype=np.float32)
        norm = np.linalg.norm(embedding)
        if norm <= 0:
            return None
        return embedding / norm

    def _load_embedding(self, path: Path) -> Optional[np.ndarray]:
        try:
            embedding = np.load(str(path)).astype(np.float32)
            norm = np.linalg.norm(embedding)
            return embedding / norm if norm > 0 else None
        except Exception:
            return None

    def _cosine_similarity(self, left: np.ndarray, right: np.ndarray) -> float:
        return float(np.dot(left, right))
