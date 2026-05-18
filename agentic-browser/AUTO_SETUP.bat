@echo off
chcp 65001 >nul
title Agentic Browser - Automatic Setup
cls

echo ╔═══════════════════════════════════════════════════════════════════╗
echo ║                                                                   ║
echo ║              🌐 AGENTIC BROWSER - AUTO SETUP                      ║
echo ║                                                                   ║
echo ║         Installing everything automatically...                    ║
echo ║                                                                   ║
echo ╚═══════════════════════════════════════════════════════════════════╝
echo.

:: Try to find Python
echo [Step 1/6] Locating Python installation...
set PYTHON_CMD=

:: Check common Python locations
if exist "C:\Python311\python.exe" set PYTHON_CMD=C:\Python311\python.exe
if exist "C:\Python312\python.exe" set PYTHON_CMD=C:\Python312\python.exe
if exist "C:\Python310\python.exe" set PYTHON_CMD=C:\Python310\python.exe
if exist "C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python311\python.exe" set PYTHON_CMD=C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python311\python.exe
if exist "C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\python.exe" set PYTHON_CMD=C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\python.exe
if exist "C:\Program Files\Python311\python.exe" set PYTHON_CMD=C:\Program Files\Python311\python.exe
if exist "C:\Program Files\Python312\python.exe" set PYTHON_CMD=C:\Program Files\Python312\python.exe

:: Try python command directly
python --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%a in ('python --version 2^>^&1') do echo    ✅ Found: %%a
    set PYTHON_CMD=python
    goto :python_found
)

:: Try py command
py --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%a in ('py --version 2^>^&1') do echo    ✅ Found: %%a
    set PYTHON_CMD=py
    goto :python_found
)

:: If we found Python in a specific path
if not "%PYTHON_CMD%"=="" (
    echo    ✅ Found Python at: %PYTHON_CMD%
    goto :python_found
)

echo.
echo    ❌ Python not found in PATH!
echo.
echo    Please make sure Python is installed and "Add Python to PATH" was checked.
echo    Common locations checked:
echo      - C:\Python311\
echo      - C:\Python312\
echo      - C:\Program Files\Python311\
echo      - %%USERPROFILE%%\AppData\Local\Programs\Python\
echo.
echo    After installing Python, RESTART this command prompt/terminal and try again.
echo.
pause
exit /b 1

:python_found
echo.

:: Create virtual environment
echo [Step 2/6] Creating virtual environment...
if exist venv (
    echo    ⚠️  Virtual environment already exists. Skipping...
) else (
    %PYTHON_CMD% -m venv venv
    if %errorlevel% neq 0 (
        echo    ❌ Failed to create virtual environment
        pause
        exit /b 1
    )
    echo    ✅ Virtual environment created
)
echo.

:: Activate virtual environment
echo [Step 3/6] Activating virtual environment...
call venv\Scripts\activate.bat
if %errorlevel% neq 0 (
    echo    ❌ Failed to activate virtual environment
    pause
    exit /b 1
)
echo    ✅ Virtual environment activated
echo.

:: Upgrade pip
echo [Step 4/6] Upgrading pip...
python -m pip install --upgrade pip -q
if %errorlevel% neq 0 (
    echo    ⚠️  Pip upgrade failed, continuing anyway...
) else (
    echo    ✅ Pip upgraded
)
echo.

:: Install requirements
echo [Step 5/6] Installing dependencies (this may take 3-5 minutes)...
echo    Installing: playwright, pydantic, rich, httpx, pillow, aiofiles, openai, anthropic...
pip install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo    ❌ Failed to install dependencies
    echo    Trying with verbose output...
    pip install -r requirements.txt
    pause
    exit /b 1
)
echo    ✅ All dependencies installed
echo.

:: Install Playwright browsers
echo [Step 6/6] Installing Playwright Chromium browser...
playwright install chromium
if %errorlevel% neq 0 (
    echo    ⚠️  Playwright install failed, trying alternative method...
    python -m playwright install chromium
)
echo    ✅ Playwright Chromium installed
echo.

:: Check/create .env file
echo [Bonus] Setting up environment file...
if exist .env (
    echo    ✅ .env file already exists
    findstr /C:"OPENAI_API_KEY" .env >nul 2>&1
    if %errorlevel% equ 0 (
        echo    ✅ API key found in .env
    ) else (
        echo    ⚠️  .env exists but no API key found
        echo       Please edit .env and add your OPENAI_API_KEY
        notepad .env
    )
) else (
    copy .env.example .env >nul 2>&1
    echo    ✅ Created .env file from template
    echo.
    echo ╔═══════════════════════════════════════════════════════════════════╗
    echo ║                    🔑 API KEY REQUIRED                            ║
    echo ╚═══════════════════════════════════════════════════════════════════╝
    echo.
    echo    Please add your OpenAI API key to the .env file.
    echo    The file will open automatically...
    echo.
    echo    Get your API key from: https://platform.openai.com/api-keys
    echo.
    timeout /t 3 >nul
    notepad .env
)
echo.

:: Verification
echo ╔═══════════════════════════════════════════════════════════════════╗
echo ║                      ✅ SETUP COMPLETE!                           ║
echo ╚═══════════════════════════════════════════════════════════════════╝
echo.
echo    Your Agentic Browser is ready to use!
echo.
echo    To run it, use these commands:
echo.
echo    ┌─────────────────────────────────────────────────────────────────┐
echo    │  venv\Scripts\activate                                          │
echo    │  python main_v2.py                                              │
echo    └─────────────────────────────────────────────────────────────────┘
echo.
echo    Or use the quick start menu:
echo    quick_start.bat
echo.
echo    Interactive modes:
echo    • python main_v2.py              ← Full interactive mode
echo    • python main_v2.py -t "task"    ← Single task mode
echo    • python main_v2.py --vision --memory --multi-tab
echo.
pause
