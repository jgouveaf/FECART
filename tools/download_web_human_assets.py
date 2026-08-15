"""Baixa os artefatos oficiais e fixados do Human usados pelo FaceID web."""

from __future__ import annotations

from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "web" / "vendor" / "human"
VERSION = "3.3.6"
PACKAGE_ROOT = f"https://cdn.jsdelivr.net/npm/@vladmandic/human@{VERSION}"
FILES = {
    "human.js": f"{PACKAGE_ROOT}/dist/human.js",
    "LICENSE.human.txt": f"{PACKAGE_ROOT}/LICENSE",
    "models/blazeface.json": f"{PACKAGE_ROOT}/models/blazeface.json",
    "models/blazeface.bin": f"{PACKAGE_ROOT}/models/blazeface.bin",
    "models/facemesh.json": f"{PACKAGE_ROOT}/models/facemesh.json",
    "models/facemesh.bin": f"{PACKAGE_ROOT}/models/facemesh.bin",
    "models/iris.json": f"{PACKAGE_ROOT}/models/iris.json",
    "models/iris.bin": f"{PACKAGE_ROOT}/models/iris.bin",
    "models/faceres.json": f"{PACKAGE_ROOT}/models/faceres.json",
    "models/faceres.bin": f"{PACKAGE_ROOT}/models/faceres.bin",
    "models/antispoof.json": f"{PACKAGE_ROOT}/models/antispoof.json",
    "models/antispoof.bin": f"{PACKAGE_ROOT}/models/antispoof.bin",
    "models/liveness.json": f"{PACKAGE_ROOT}/models/liveness.json",
    "models/liveness.bin": f"{PACKAGE_ROOT}/models/liveness.bin",
}


def main() -> None:
    for relative, url in FILES.items():
        destination = DESTINATION / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        request = Request(url, headers={"User-Agent": "Quantum-Tracker-build"})
        with urlopen(request, timeout=120) as response:
            content = response.read()
        if len(content) < 100:
            raise RuntimeError(f"Arquivo inválido ou incompleto: {relative}")
        destination.write_bytes(content)
        print(f"{relative}: {len(content)} bytes")


if __name__ == "__main__":
    main()
