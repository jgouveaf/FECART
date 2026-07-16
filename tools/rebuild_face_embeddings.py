from __future__ import annotations

from biometrics.face_recognition import FaceRecognizer
from database.database_manager import DatabaseManager
from utils.config import load_config


def main() -> None:
    config = load_config()
    database = DatabaseManager(config.database_path)
    recognizer = FaceRecognizer(config, database)
    if not recognizer.available:
        print(f"InsightFace indisponivel: {recognizer.last_error}")
        database.close()
        return
    created, failed = recognizer.rebuild_embeddings()
    print(f"Embeddings recriados: {created}")
    print(f"Falhas: {failed}")
    database.close()


if __name__ == "__main__":
    main()
