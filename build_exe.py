# -*- coding: utf-8 -*-
"""Script de build automatizado do Quantum Tracker para PyInstaller.

Gera o executavel portátil único (com modelos inclusos, dados mantidos localmente na mesma pasta)
e empacota em um arquivo .zip pronto para distribuição com README explicativo.

Execução:
    python build_exe.py
"""
import os
import shutil
import sys
import zipfile
from pathlib import Path

import PyInstaller.__main__
from PyInstaller.utils.hooks import collect_all

PROJECT_ROOT = Path(__file__).resolve().parent

def build_portable_exe() -> None:
    print("==========================================================")
    print("🚀 INICIANDO BUILD PORTÁTIL DO QUANTUM TRACKER")
    print("==========================================================")

    # 1. Mapeamento de arquivos de dados (Assets e Modelos IA)
    datas = [
        (str(PROJECT_ROOT / "assets"), "assets"),
    ]

    yolo_model = PROJECT_ROOT / "yolov8n.pt"
    if yolo_model.exists():
        datas.append((str(yolo_model), "."))
        print(f"✓ Modelo YOLOv8 encontrado e incluído: {yolo_model.name}")
    else:
        print("⚠️ Aviso: yolov8n.pt não encontrado na raiz. O modelo será baixado no primeiro uso se necessário.")

    # Modelos faciais se houver pasta assets/insightface_models
    insight_dir = PROJECT_ROOT / "assets" / "insightface_models"
    if insight_dir.exists():
        datas.append((str(insight_dir), "assets/insightface_models"))
        print(f"✓ Modelos InsightFace incluídos: {insight_dir}")

    binaries = []
    hiddenimports = [
        "pyttsx3",
        "pyttsx3.drivers",
        "pyttsx3.drivers.sapi5",
        "speech_recognition",
        "PIL",
        "cv2",
        "scipy",
        "sklearn",
        "sqlite3",
    ]

    # 2. Coleta de hooks para dependências complexas de Visão e IA
    for pkg in ["ultralytics", "insightface", "mediapipe", "sklearn", "scipy", "cv2"]:
        try:
            tmp_datas, tmp_binaries, tmp_hiddenimports = collect_all(pkg)
            datas.extend(tmp_datas)
            binaries.extend(tmp_binaries)
            hiddenimports.extend(tmp_hiddenimports)
            print(f"✓ Coletadas dependências estáticas do pacote: {pkg}")
        except Exception as err:
            print(f"⚠️ Instabilidade ao coletar hook para {pkg}: {err}")

    # Icone do aplicativo
    icon_ico = PROJECT_ROOT / "assets" / "quantum_tracker.ico"
    icon_png = PROJECT_ROOT / "assets" / "logo.png"
    icon_path = str(icon_ico if icon_ico.exists() else icon_png)

    # 3. Argumentos do PyInstaller
    cmd_args = [
        str(PROJECT_ROOT / "main.py"),
        "--name=QuantumTracker",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--windowed",
        f"--icon={icon_path}",
    ]

    # Incluir datas e hidden imports
    for src, dst in datas:
        cmd_args.append(f"--add-data={src}{os.pathsep}{dst}")

    for imp in set(hiddenimports):
        cmd_args.append(f"--hidden-import={imp}")

    print("\n📦 Compilando via PyInstaller...")
    PyInstaller.__main__.run(cmd_args)

    # 4. Preparação da pasta portátil e criação do README.txt
    dist_dir = PROJECT_ROOT / "dist" / "QuantumTracker"
    readme_path = dist_dir / "README.txt"

    readme_content = (
        "==========================================================\n"
        "                QUANTUM TRACKER - PORTÁTIL                \n"
        "==========================================================\n\n"
        "COMO USAR:\n"
        "1. Extraia todo o conteúdo deste ZIP em uma pasta de sua escolha.\n"
        "2. Execute o arquivo 'QuantumTracker.exe'.\n\n"
        "NOTAS:\n"
        "- Esta versão é totalmente PORTÁTIL. Todos os dados, logs, fotos\n"
        "  e o banco de dados serão salvos na pasta local 'data/'.\n"
        "- Feito por: João, Gustavo e Renato.\n"
    )

    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(readme_content)
    print("✓ README.txt gerado na pasta de distribuição.")

    # 5. Gerar arquivo ZIP final portátil
    zip_output = PROJECT_ROOT / "dist" / "QuantumTracker_Portable.zip"
    print(f"\n🤐 Compactando pasta em '{zip_output.name}'...")

    with zipfile.ZipFile(zip_output, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file in dist_dir.rglob("*"):
            arcname = file.relative_to(dist_dir.parent)
            zipf.write(file, arcname)

    print("==========================================================")
    print(f"🎉 BUILD CONCLUÍDO COM SUCESSO!")
    print(f"📂 Executável gerado em: {dist_dir}")
    print(f"📦 Arquivo ZIP final: {zip_output}")
    print("==========================================================")


if __name__ == "__main__":
    build_portable_exe()
