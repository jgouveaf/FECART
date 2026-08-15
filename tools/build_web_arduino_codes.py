"""Gera o pacote web offline dos sketches exibidos na aba Códigos."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCES = (
    "firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino",
    "firmware/teste_motores/teste_motores.ino",
    "firmware/teste_sensor_hcsr04/teste_sensor_hcsr04.ino",
)
DESTINATION = ROOT / "web" / "arduino-codes.js"


def main() -> None:
    entries = []
    for relative in SOURCES:
        code = (ROOT / relative).read_text(encoding="utf-8")
        entries.append(f"  {json.dumps(relative)}: {json.dumps(code, ensure_ascii=False)}")

    output = (
        "// Gerado por tools/build_web_arduino_codes.py. Não edite manualmente.\n"
        "window.QUANTUM_ARDUINO_CODES = Object.freeze({\n"
        + ",\n".join(entries)
        + "\n});\n"
    )
    DESTINATION.write_text(output, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
