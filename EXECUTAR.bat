@echo off
title Quantum Tracker - Inicializacao Automatica
color 0A
echo ==========================================================
echo               QUANTUM TRACKER - INICIALIZACAO
echo ==========================================================
echo.
echo [1/2] Verificando e instalando dependencias Python...
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha ao instalar dependencias!
    echo Certifique-se de que o Python 3.11+ esta instalado e com "Add Python to PATH" marcado.
    pause
    exit /b
)
echo.
echo [2/2] Iniciando Quantum Tracker...
python main.py
if %errorlevel% neq 0 (
    echo.
    echo [AVISO] O aplicativo encerrou com erros.
    pause
)
