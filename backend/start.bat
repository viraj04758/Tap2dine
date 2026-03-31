@echo off
echo.
echo  =====================================
echo   Tap2Dine Backend - Starting up...
echo  =====================================
echo.

cd /d "%~dp0"

:: Check if pip is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Install Python from https://python.org
    pause
    exit /b 1
)

:: Install dependencies if not already installed
echo [1/2] Installing dependencies...
pip install -r requirements.txt --quiet

echo [2/2] Starting FastAPI server at http://localhost:8000
echo.
echo  Customer Menu  --> http://localhost:8000/static/index.html?table=1
echo  Admin Panel    --> http://localhost:8000/static/admin.html
echo  QR Generator   --> http://localhost:8000/static/qr.html
echo  API Docs       --> http://localhost:8000/docs
echo.
echo  Press Ctrl+C to stop the server.
echo.

python main.py
pause
