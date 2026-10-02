@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo ========================================================
echo Starting Aria Coach Backend
echo ========================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

REM Detect Python 3.12 installation
set "PY_EXE="
if exist "C:\Users\Abdul Fattah\AppData\Local\Programs\Python\Python312\python.exe" (
    set "PY_EXE=C:\Users\Abdul Fattah\AppData\Local\Programs\Python\Python312\python.exe"
    set "PY_DIR=C:\Users\Abdul Fattah\AppData\Local\Programs\Python\Python312"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    set "PY_DIR=%LOCALAPPDATA%\Programs\Python\Python312"
) else (
    set "PY_EXE=%ROOT%\.venv\Scripts\python.exe"
    set "PY_DIR=%ROOT%\.venv\Scripts"
)

REM Configure DLL and Python package resolution
set "PATH=%PY_DIR%;%PY_DIR%\DLLs;%PY_DIR%\Scripts;%PATH%"
set "PYTHONPATH=%ROOT%;%ROOT%\.venv\Lib\site-packages"

echo Using Python: "%PY_EXE%"
echo Project root: "%ROOT%"
echo.

"%PY_EXE%" -m uvicorn backend.server:app --host 127.0.0.1 --port 8000 --reload

pause
