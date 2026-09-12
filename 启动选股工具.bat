@echo off
chcp 65001 >nul
title 八字选股服务
cd /d %~dp0

if exist "..\.venv\Scripts\python.exe" (
  set PYTHON=..\.venv\Scripts\python.exe
) else (
  set PYTHON=python
)

echo [i] 启动八字选股服务...
start "八字选股服务" %PYTHON% server\app.py
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:5175
echo [i] 服务已在独立窗口运行，浏览器已打开。关闭该服务窗口即可停止。
pause
