@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE="
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set "PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  goto found_python
)

where python >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%P in ('where python') do (
    set "PYTHON_EXE=%%P"
    goto found_python
  )
)

:found_python
if "%PYTHON_EXE%"=="" (
  echo Python nao encontrado. Instale Python 3.12+ antes de continuar.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  "%PYTHON_EXE%" -m venv .venv
)
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements-basic.txt
echo.
echo Instalacao basica concluida. O simulador e a interface devem abrir.
echo Para YOLO, DeepFace, MediaPipe e IA completa, rode Instalar_Dependencias.bat depois.
pause
