"""Etapa 3: cadastro e persistencia sem webcam e sem dados reais."""

from __future__ import annotations

import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from biometrics.face_recognition import FaceRecognizer
from biometrics.registration_service import (
    DuplicateFaceError,
    IdentityRegistrationService,
    RegistrationError,
)
from core.models import IdentityMatch
from database.database_manager import DatabaseManager, DuplicatePersonError
from utils.config import AppConfig


class _InsightDeterministico:
    def __init__(self, database: DatabaseManager, config: AppConfig) -> None:
        self.database = database
        self.config = config
        self.available = True
        self.known: dict[int, tuple[str, np.ndarray]] = {}
        self.fail_store = False

    def extract_embedding(self, image: np.ndarray):
        if image is None or image.size == 0 or float(image.mean()) < 1:
            return None
        # O primeiro pixel codifica uma identidade deterministica para o teste.
        code = int(image[0, 0, 0]) % 8
        vector = np.zeros(8, dtype=np.float32)
        vector[code] = 1.0
        return vector

    def extract_single_embedding(self, image: np.ndarray):
        embedding = self.extract_embedding(image)
        return embedding, 1 if embedding is not None else 0

    def match_embedding(self, embedding: np.ndarray, threshold: float = 0.42):
        for person_id, (name, known) in self.known.items():
            score = float(np.dot(embedding, known))
            if score >= threshold:
                return IdentityMatch(person_id, name, score)
        return None

    def store_embedding(self, person, photo_path: Path, embedding: np.ndarray) -> Path:
        if self.fail_store:
            raise OSError("falha de disco simulada")
        path = self.config.embeddings_dir / f"person_{person.person_id}.npy"
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path, embedding)
        self.database.add_face_embedding(person.person_id, str(path), str(photo_path))
        self.known[person.person_id] = (person.name, embedding.copy())
        return path

    def reload_gallery(self) -> None:
        self.known.clear()
        people = {person.person_id: person for person in self.database.list_people()}
        for record in self.database.list_face_embeddings():
            person = people.get(record.person_id)
            if person and Path(record.embedding_path).exists():
                self.known[record.person_id] = (
                    person.name,
                    np.load(record.embedding_path).astype(np.float32),
                )


class _RecognizerDeterministico:
    def __init__(self, config: AppConfig, database: DatabaseManager) -> None:
        # Reutiliza somente a rotina real de gravacao segura da foto.
        self.config = config
        self.faces_dir = config.faces_dir
        self.insightface = _InsightDeterministico(database, config)
        self.available = True
        self.last_error = ""

    register_face = FaceRecognizer.register_face


class TesteCadastroPersistenteOffline(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.config = replace(
            AppConfig(),
            faces_dir=base / "faces",
            embeddings_dir=base / "embeddings",
            logs_dir=base / "logs",
            database_path=base / "database" / "teste.sqlite3",
        )
        self.db = DatabaseManager(self.config.database_path)
        self.recognizer = _RecognizerDeterministico(self.config, self.db)
        self.service = IdentityRegistrationService(self.config, self.db, self.recognizer)

    def tearDown(self) -> None:
        self.db.close()
        self.temp.cleanup()

    @staticmethod
    def imagem(code: int) -> np.ndarray:
        image = np.full((160, 120, 3), 80, dtype=np.uint8)
        image[0, 0, 0] = code
        cv2.circle(image, (60, 60), 30, (180, 160, 140), -1)
        return image

    def test_fluxo_cadastrar_fechar_abrir_reconhecer_excluir(self) -> None:
        result = self.service.register("  Joao   Teste  ", self.imagem(1))
        self.assertTrue(result.photo_path.exists())
        self.assertIsNotNone(result.embedding_path)
        self.assertTrue(result.embedding_path.exists())
        person_id = result.person.person_id

        self.db.close()
        self.db = DatabaseManager(self.config.database_path)
        reopened_recognizer = _RecognizerDeterministico(self.config, self.db)
        reopened_recognizer.insightface.reload_gallery()
        embedding = reopened_recognizer.insightface.extract_embedding(self.imagem(1))
        match = reopened_recognizer.insightface.match_embedding(embedding)

        self.assertIsNotNone(match)
        self.assertEqual(match.person_id, person_id)
        self.assertEqual(match.name, "Joao Teste")

        files = self.db.delete_person(person_id)
        for file_name in files:
            Path(file_name).unlink(missing_ok=True)
        reopened_recognizer.insightface.reload_gallery()
        self.assertEqual(self.db.list_people(), [])
        self.assertEqual(self.db.list_face_embeddings(), [])
        self.assertIsNone(reopened_recognizer.insightface.match_embedding(embedding))

    def test_nome_repetido_ignora_caixa_acentos_e_maiusculas(self) -> None:
        self.service.register("Joao da Silva", self.imagem(1))
        with self.assertRaises(DuplicatePersonError):
            self.service.register("  JOAO   DA SILVA ", self.imagem(2))

        self.service.register("José", self.imagem(3))
        with self.assertRaises(DuplicatePersonError):
            self.service.register("JOSÉ", self.imagem(4))
        with self.assertRaises(DuplicatePersonError):
            self.service.register("Jose", self.imagem(5))

    def test_foto_com_varios_rostos_e_rejeitada(self) -> None:
        original = self.recognizer.insightface.extract_single_embedding
        self.recognizer.insightface.extract_single_embedding = lambda image: (None, 2)
        try:
            with self.assertRaisesRegex(RegistrationError, "mais de um rosto"):
                self.service.register("Duas Pessoas", self.imagem(6))
        finally:
            self.recognizer.insightface.extract_single_embedding = original
        self.assertEqual(self.db.list_people(), [])

    def test_rosto_repetido_com_outro_nome_e_bloqueado(self) -> None:
        self.service.register("Pessoa A", self.imagem(2))
        with self.assertRaises(DuplicateFaceError):
            self.service.register("Pessoa B", self.imagem(2))
        self.assertEqual(len(self.db.list_people()), 1)

    def test_foto_sem_rosto_nao_cria_arquivo_ou_linha(self) -> None:
        with self.assertRaises(RegistrationError):
            self.service.register("Sem Rosto", np.zeros((100, 100, 3), dtype=np.uint8))
        self.assertEqual(self.db.list_people(), [])
        self.assertFalse(self.config.faces_dir.exists())

    def test_falha_ao_salvar_embedding_faz_rollback_total(self) -> None:
        self.recognizer.insightface.fail_store = True
        with self.assertRaises(OSError):
            self.service.register("Falha", self.imagem(5))
        self.assertEqual(self.db.list_people(), [])
        self.assertEqual(self.db.list_face_embeddings(), [])
        fotos = list(self.config.faces_dir.rglob("*.jpg")) if self.config.faces_dir.exists() else []
        self.assertEqual(fotos, [])

    def test_duas_fotos_no_mesmo_instante_nao_colidem(self) -> None:
        first = self.recognizer.register_face("Rapido", self.imagem(1))
        second = self.recognizer.register_face("Rapido", self.imagem(1))
        self.assertNotEqual(first, second)
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
