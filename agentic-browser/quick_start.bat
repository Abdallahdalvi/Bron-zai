@echo off
title Agentic Browser V2 - Quick Start

echo 🌐 Starting Agentic Browser V2...
echo.

REM Activate virtual environment
if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate
    echo ✅ Virtual environment activated
) else (
    echo ⚠️  Virtual environment not found. Running anyway...
)
echo.

REM Check for API key
if exist .env (
    findstr /C:"OPENAI_API_KEY" .env >nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ No OPENAI_API_KEY found in .env!
        echo.
        echo Please add your API key to .env file:
        echo OPENAI_API_KEY=sk-your-key-here
echo.
        notepad .env
        echo.
        pause
        exit /b 1
    )
) else (
    echo ❌ .env file not found!
    echo Please create .env file with your API key.
    pause
    exit /b 1
)

echo ❓ Choose mode:
echo.
echo 1. Interactive Mode (recommended for first time)
echo 2. Quick Test - Go to example.com
echo 3. Compare Prices (Multi-tab demo)
echo 4. Vision Demo
echo.
set /p choice="Enter choice (1-4): "

if "%choice%"=="1" goto interactive
if "%choice%"=="2" goto quicktest
if "%choice%"=="3" goto compare
if "%choice%"=="4" goto vision

echo Invalid choice
goto end

:interactive
echo.
echo 🚀 Starting Interactive Mode...
echo.
python main_v2.py
goto end

:quicktest
echo.
echo 🧪 Running quick test...
python main_v2.py -t "Go to https://example.com and tell me what the main heading says"
goto end

:compare
echo.
echo 🚀 Running multi-tab price comparison...
python main_v2.py -t "Go to example.com and example.org in separate tabs and compare their content" --multi-tab
goto end

:vision
echo.
echo 👁️ Running with vision enabled...
python main_v2.py -t "Go to https://example.com and describe what you see" --vision
goto end

:end
echo.
echo ✅ Done!
pause
