@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo.
echo 江苏大学智能图书馆 - 本地参赛原型
echo 浏览器访问 http://127.0.0.1:8765
echo 按 Ctrl+C 停止服务。
echo.
set "LIBRARY_PYTHON=python"
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "LIBRARY_PYTHON=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
"%LIBRARY_PYTHON%" -X utf8 "%~dp0agent_backend\server.py"
echo.
pause
