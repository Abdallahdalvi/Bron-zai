@echo off
chcp 65001 >nul
title Agentic Browser - Setup

echo ╔════════════════════════════════════════════════════════════╗
echo ║           🌐 Agentic Browser - Windows Setup               ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Check Python
echo [1/5] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo    ❌ Python not found!
    echo.
    echo    Please install Python 3.11 or higher:
    echo    https://www.python.org/downloads/
    echo.
    echo    ⚠️  IMPORTANT: Check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%a in ('python --version 2^>^&1') do set PYTHON_VERSION=%%a
echo    ✅ %PYTHON_VERSION%
echo.

REM Check pip
echo [2/5] Checking pip...
python -m pip --version >nul 2>&1
if %errorlevel% neq 0 (
    echo    ❌ pip not found!
    pause
    exit /b 1
)
echo    ✅ pip is installed
echo.

REM Create virtual environment
echo [3/5] Creating virtual environment...
if exist venv (
    echo    ⚠️  Virtual environment already exists. Skipping...
) else (
    python -m venv venv
    echo    ✅ Virtual environment created
)
echo.

REM Activate and install
echo [4/5] Installing dependencies (this may take a few minutes)...
call venv\Scripts\activate
python -m pip install --upgrade pip >nul 2>&1
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo    ❌ Failed to install dependencies
    pause
    exit /b 1
)
echo    ✅ Dependencies installed
echo.

REM Install Playwright
echo [5/5] Installing Playwright browsers...
playwright install chromium
if %errorlevel% neq 0 (
    echo    ⚠️  Playwright install had issues, trying alternative...
    python -m playwright install chromium
)
echo    ✅ Playwright browsers installed
echo.

REM Check env file
echo [Bonus] Checking environment file...
if exist .env (
    echo    ✅ .env file exists
    findstr /C:"OPENAI_API_KEY" .env >nul 2>&1
    if %errorlevel% equ 0 (
        echo    ✅ API key configured
    ) else (
        echo    ⚠️  No API key found in .env
        echo       Please edit .env and add your API key
    )
) else (
    echo    ⚠️  .env file not found
    copy .env.example .env >nul 2>&1
    echo    ✅ Created .env from example
    echo       Please edit .env and add your API key
)
echo.

echo ╔════════════════════════════════════════════════════════════╗
echo ║                    ✅ Setup Complete!                      ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo To run Agentic Browser:
echo.
echo   1. Activate virtual environment:
echo      venv\Scripts\activate
echo.
echo   2. Run Agentic Browser V2:
echo      python main_v2.py
echo.
echo   3. Or run a single task:
echo      python main_v2.py -t "Your task here"
echo.
echo.
echo Need an API key? Get one at:
echo https://platform.openai.com/api-keys
echo.
pause
