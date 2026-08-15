"""Cadastro facial persistente e transacional da Etapa 3."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from biometrics.face_recognition import FaceRecognizer
from core.models import PersonRecord
from database.database_manager import DatabaseManager, DuplicatePersonError
from utils.config import AppConfig


class RegistrationError(RuntimeError):
    """Cadastro nao pode ser concluido sem deixar dados parciais."""


class DuplicateFaceError(RegistrationError):
    """O rosto ja pertence a outra pessoa da galeria."""


@dataclass(frozen=True)
class RegistrationResult:
    person: PersonRecord
    photo_path: Path
    embedding_path: Optional[Path]


class IdentityRegistrationService:
    """Coordena foto, pessoa e embedding com rollback em qualquer falha."""

    def __init__(
        self,
        config: AppConfig,
        database: DatabaseManager,
        recognizer: FaceRecognizer,
    ) -> None:
        self.config = config
        self.database = database
        self.recognizer = recognizer

    def register(
        self,
        name: str,
        image: np.ndarray,
        *,
        require_embedding: bool = True,
    ) -> RegistrationResult:
        normalized_name = " ".join(name.strip().split())
        if not normalized_name:
            raise RegistrationError("Digite um nome valido.")
        if image is None or getattr(image, "size", 0) == 0:
            raise RegistrationError("A foto de cadastro esta vazia.")
        existing = self.database.get_person_by_name(normalized_name)
        if existing is not None:
            raise DuplicatePersonError(
                f"O nome {existing.name} ja esta cadastrado no ID {existing.person_id}."
            )

        insight = self.recognizer.insightface
        embedding = None
        if insight.available:
            if hasattr(insight, "extract_single_embedding"):
                embedding, face_count = insight.extract_single_embedding(image)
            else:
                embedding = insight.extract_embedding(image)
                face_count = 1 if embedding is not None else 0
            if face_count > 1:
                raise RegistrationError(
                    "A foto contem mais de um rosto. Deixe apenas a pessoa cadastrada no quadro."
                )
            if embedding is None and require_embedding:
                raise RegistrationError(
                    "Nenhum rosto valido foi encontrado. Capture uma foto frontal e nitida."
                )
            if embedding is not None:
                duplicate = insight.match_embedding(
                    embedding,
                    threshold=self.config.face_confidence_threshold,
                )
                if duplicate is not None:
                    raise DuplicateFaceError(
                        f"Este rosto ja esta cadastrado como {duplicate.name} "
                        f"(ID {duplicate.person_id}, confianca {duplicate.confidence:.0%})."
                    )
        elif require_embedding:
            raise RegistrationError(
                self.recognizer.last_error or "Reconhecimento facial indisponivel."
            )

        photo_path: Optional[Path] = None
        person_id: Optional[int] = None
        try:
            photo_path = self.recognizer.register_face(normalized_name, image)
            person_id = self.database.add_person(normalized_name, str(photo_path))
            person = self.database.get_person_by_name(normalized_name)
            if person is None or person.person_id != person_id:
                raise RegistrationError("O cadastro nao foi confirmado no banco.")

            embedding_path = None
            if embedding is not None:
                embedding_path = insight.store_embedding(person, photo_path, embedding)
            elif require_embedding:
                raise RegistrationError("Embedding facial nao foi criado.")

            return RegistrationResult(person, photo_path, embedding_path)
        except Exception:
            files: list[str] = []
            if person_id is not None:
                files = self.database.delete_person(person_id)
            if photo_path is not None:
                files.append(str(photo_path))
            for file_name in set(files):
                path = Path(file_name)
                path.unlink(missing_ok=True)
                parent = path.parent
                if parent.exists() and parent.is_dir() and not any(parent.iterdir()):
                    parent.rmdir()
            insight.reload_gallery()
            raise
