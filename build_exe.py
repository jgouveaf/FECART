import shutil
import subprocess
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).parent.resolve()
    spec_file = root / "QuantumTracker.spec"
    dist_dir = root / "dist"
    app_dir = dist_dir / "QuantumTracker"
    zip_output = root / "dist" / "QuantumTracker_Portatil"

    # Comando do PyInstaller usando a Spec customizada
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--clean",
        "--noconfirm",
        str(spec_file)
    ]

    print("====================================================")
    print("Iniciando compilacao do QUANTUM TRACKER Portatil...")
    print("Mapeando modelos de IA, OpenCV, PySide6 e dependencias.")
    print("Por favor, aguarde alguns minutos...")
    print("====================================================\n")

    try:
        # Executa o build
        subprocess.run(cmd, check=True)
        print("\n[OK] Executavel gerado com sucesso em: dist/QuantumTracker/")

        # Criacao automatica do arquivo .zip pronto para distribuicao
        print("\nEmpacotando aplicativo em arquivo .zip...")
        if zip_output.with_suffix(".zip").exists():
            zip_output.with_suffix(".zip").unlink()
            
        shutil.make_archive(str(zip_output), 'zip', str(dist_dir), 'QuantumTracker')
        print(f"[OK] Arquivo de distribuicao criado: dist/QuantumTracker_Portatil.zip")
        print("\nPronto! Agora voce so precisa enviar o arquivo .zip para os PCs da escola.")
    except subprocess.CalledProcessError as e:
        print(f"\n[ERRO] Erro durante a compilacao do PyInstaller: {e}")
    except Exception as e:
        print(f"\n[ERRO] Erro no empacotamento do ZIP: {e}")


if __name__ == "__main__":
    main()
