"""Integracao real da Etapa 3 com InsightFace, sem webcam e sem dados do usuario."""

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
from biometrics.registration_service import IdentityRegistrationService
from database.database_manager import DatabaseManager
from recognition.insightface_service import InsightFaceService
from utils.config import AppConfig


class TesteInsightFaceRealOffline(unittest.TestCase):
    def test_embedding_persiste_reabre_reconhece_e_exclui(self) -> None:
        import ultralytics

        asset = Path(ultralytics.__file__).resolve().parent / "assets" / "zidane.jpg"
        image = cv2.imread(str(asset))
        if image is None:
            raise unittest.SkipTest(f"Imagem offline nao encontrada: {asset}")

        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            config = replace(
                AppConfig(),
                insightface_root=ROOT / "assets" / "insightface_models",
                faces_dir=base / "faces",
                embeddings_dir=base / "embeddings",
                database_path=base / "database" / "teste.sqlite3",
            )
            db = DatabaseManager(config.database_path)
            recognizer = FaceRecognizer(config, db)
            service = recognizer.insightface
            if not recognizer.available:
                db.close()
                raise unittest.SkipTest(recognizer.last_error)

            faces = service.app.get(image)
            self.assertGreaterEqual(len(faces), 2)
            x1, y1, x2, y2 = map(int, faces[0].bbox)
            margin_x = max(20, (x2 - x1) // 3)
            margin_y = max(20, (y2 - y1) // 3)
            h, w = image.shape[:2]
            face_photo = image[
                max(0, y1 - margin_y) : min(h, y2 + margin_y),
                max(0, x1 - margin_x) : min(w, x2 + margin_x),
            ]
            single_embedding, face_count = service.extract_single_embedding(face_photo)
            self.assertEqual(face_count, 1)
            self.assertIsNotNone(single_embedding)
            self.assertEqual(single_embedding.shape, (512,))
            self.assertAlmostEqual(float(np.linalg.norm(single_embedding)), 1.0, places=5)

            registration = IdentityRegistrationService(config, db, recognizer)
            result = registration.register("Pessoa Offline", face_photo)
            person_id = result.person.person_id
            self.assertTrue(result.photo_path.exists())
            self.assertIsNotNone(result.embedding_path)
            self.assertTrue(result.embedding_path.exists())
            db.close()

            # Simula a proxima inicializacao: novo banco e nova galeria.
            reopened_db = DatabaseManager(config.database_path)
            reopened = InsightFaceService(config, reopened_db)
            self.assertTrue(reopened.available, reopened.last_error)
            self.assertEqual(len(reopened.known_faces), 1)

            query, query_count = reopened.extract_single_embedding(face_photo)
            self.assertEqual(query_count, 1)
            match = reopened.match_embedding(query, threshold=config.face_confidence_threshold)
            self.assertIsNotNone(match)
            self.assertEqual(match.person_id, person_id)
            self.assertEqual(match.name, "Pessoa Offline")
            self.assertGreater(match.confidence, 0.99)

            files = reopened_db.delete_person(person_id)
            for file_name in files:
                Path(file_name).unlink(missing_ok=True)
            reopened.reload_gallery()
            self.assertEqual(reopened_db.list_people(), [])
            self.assertEqual(reopened.known_faces, [])
            self.assertIsNone(reopened.match_embedding(query))
            reopened_db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
