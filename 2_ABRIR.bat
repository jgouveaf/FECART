@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo O app ainda nao foi instalado.
  echo Execute primeiro: 1_INSTALAR.bat
  pause
  exit /b 1
)

".venv\Scripts\python.exe" main.py
