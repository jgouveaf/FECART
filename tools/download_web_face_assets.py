"""Baixa os arquivos oficiais e fixados do face-api.js usados pelo site."""

from __future__ import annotations

from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "web" / "vendor" / "face-api"
COMMIT = "a86f011d72124e5fb93e59d5c4ab98f699dd5c9c"
RAW_ROOT = f"https://raw.githubusercontent.com/justadudewhohacks/face-api.js/{COMMIT}"
FILES = {
    "face-api.min.js": "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js",
    "LICENSE.face-api.txt": f"{RAW_ROOT}/LICENSE",
    "models/tiny_face_detector_model-weights_manifest.json": f"{RAW_ROOT}/weights/tiny_face_detector_model-weights_manifest.json",
    "models/tiny_face_detector_model-shard1": f"{RAW_ROOT}/weights/tiny_face_detector_model-shard1",
    "models/face_landmark_68_tiny_model-weights_manifest.json": f"{RAW_ROOT}/weights/face_landmark_68_tiny_model-weights_manifest.json",
    "models/face_landmark_68_tiny_model-shard1": f"{RAW_ROOT}/weights/face_landmark_68_tiny_model-shard1",
    "models/face_recognition_model-weights_manifest.json": f"{RAW_ROOT}/weights/face_recognition_model-weights_manifest.json",
    "models/face_recognition_model-shard1": f"{RAW_ROOT}/weights/face_recognition_model-shard1",
    "models/face_recognition_model-shard2": f"{RAW_ROOT}/weights/face_recognition_model-shard2",
}


def main() -> None:
    for relative, url in FILES.items():
        destination = DESTINATION / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        request = Request(url, headers={"User-Agent": "Quantum-Tracker-build"})
        with urlopen(request, timeout=90) as response:
            content = response.read()
        if len(content) < 100:
            raise RuntimeError(f"Arquivo inválido ou incompleto: {relative}")
        destination.write_bytes(content)
        print(f"{relative}: {len(content)} bytes")


if __name__ == "__main__":
    main()
