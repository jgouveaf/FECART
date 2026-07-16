@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo QUANTUM TRACKER - Instalador
echo ==========================================
echo.

set "PYTHON_EXE="
where python >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%P in ('where python') do (
    set "PYTHON_EXE=%%P"
    goto found_python
  )
)

:found_python
if "%PYTHON_EXE%"=="" (
  echo Python nao encontrado.
  echo.
  echo Instale Python 3.12+ em:
  echo https://www.python.org/downloads/
  echo.
  echo IMPORTANTE: marque a opcao "Add python.exe to PATH" durante a instalacao.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  "%PYTHON_EXE%" -m venv .venv
)

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements.txt

echo.
echo Instalacao concluida.
echo Agora execute 2_ABRIR.bat
pause
