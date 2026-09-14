@echo off
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
title Bazi Stock Service
cd /d %~dp0

set "PYTHON=..\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

REM Clean up stale process on port 5175
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5175.*LISTENING"') do (
  echo [!] Port 5175 in use by PID %%a, killing...
  taskkill /pid %%a /f >nul 2>&1
  timeout /t 1 /nobreak >nul
)

echo [i] Starting Bazi Stock Service...
echo [i] Browser will open automatically.
echo [i] Close this window to stop the service.
echo.
"%PYTHON%" server\app.py

echo.
echo [!] Service stopped. Press any key to close.
pause >nul
