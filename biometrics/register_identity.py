from __future__ import annotations

import argparse
from pathlib import Path

import cv2

from biometrics.face_recognition import FaceRecognizer
from utils.config import load_config


def main() -> None:
    parser = argparse.ArgumentParser(description="Registra uma identidade no banco biometrico local.")
    parser.add_argument("name", help="Nome da pessoa")
    parser.add_argument("--camera", type=int, default=0, help="Indice da webcam")
    args = parser.parse_args()

    config = load_config()
    recognizer = FaceRecognizer(config)
    camera = cv2.VideoCapture(args.camera)
    if not camera.isOpened():
        raise RuntimeError("Nao foi possivel abrir a webcam.")

    print("Pressione ESPACO para capturar, ESC para sair.")
    while True:
        ok, frame = camera.read()
        if not ok:
            continue
        cv2.imshow("Registrar identidade", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            break
        if key == 32:
            path: Path = recognizer.register_face(args.name, frame)
            print(f"Identidade salva em: {path}")
            break

    camera.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
