@echo off
chcp 65001 >nul
cls

echo.
echo ╔═══════════════════════════════════════════════════════════════════╗
echo ║                                                                   ║
echo ║         🌐 AGENTIC BROWSER V2 - ONE-CLICK LAUNCHER                ║
echo ║                                                                   ║
echo ║    Installing Python packages and launching browser agent...      ║
echo ║                                                                   ║
echo ╚═══════════════════════════════════════════════════════════════════╝
echo.

:: Check if setup is already complete
if exist venv\Scripts\python.exe (
    echo ✅ Setup already complete! Launching Agentic Browser...
    echo.
    goto :launch
)

:: Run auto-setup
echo 🔧 First time setup detected. Running automatic installation...
echo.
call AUTO_SETUP.bat
if %errorlevel% neq 0 (
    echo.
    echo ❌ Setup failed. Please check the errors above.
    pause
    exit /b 1
)

:launch
cls
echo.
echo ╔═══════════════════════════════════════════════════════════════════╗
echo ║              🌐 AGENTIC BROWSER V2 - READY                        ║
echo ╚═══════════════════════════════════════════════════════════════════╝
echo.

:: Activate and run
call venv\Scripts\activate

:menu
cls
echo.
echo ╔═══════════════════════════════════════════════════════════════════╗
echo ║              🌐 AGENTIC BROWSER V2 - MAIN MENU                    ║
echo ╚═══════════════════════════════════════════════════════════════════╝
echo.
echo    Choose a mode:
echo.
echo    [1] 🤖 Interactive Mode (Recommended for first time)
echo        Full-featured with prompts for task input and configuration
echo.
echo    [2] 🧪 Quick Test - Go to example.com
echo        Simple test to verify everything works
echo.
echo    [3] 📊 Demo: Compare Sites (Multi-tab)
echo        Opens multiple tabs and compares content
echo.
echo    [4] 👁️ Demo: Vision Mode
echo        Screenshot analysis with AI vision
echo.
echo    [5] ⚙️  Custom Command
echo        Enter your own command with flags
echo.
echo    [Q] Quit
echo.
set /p choice="Enter your choice (1-5 or Q): "

if "%choice%"=="1" goto interactive
if "%choice%"=="2" goto quicktest  
if "%choice%"=="3" goto compare
if "%choice%"=="4" goto vision
if "%choice%"=="5" goto custom
if /i "%choice%"=="q" goto quit
if /i "%choice%"=="quit" goto quit

echo Invalid choice, please try again.
timeout /t 2 >nul
goto menu

:interactive
cls
echo.
echo 🚀 Starting Interactive Mode...
echo.
python main_v2.py
goto done

:quicktest
cls
echo.
echo 🧪 Running quick test on example.com...
echo.
python main_v2.py -t "Go to https://example.com and tell me what the main heading says"
goto done

:compare
cls
echo.
echo 📊 Running multi-tab comparison demo...
echo.
python main_v2.py -t "Go to example.com in one tab and example.org in another, then compare their main content" --multi-tab
goto done

:vision
cls
echo.
echo 👁️ Running Vision Mode demo...
echo.
python main_v2.py -t "Go to https://example.com, take a screenshot, and describe what you see visually" --vision
goto done

:custom
cls
echo.
echo ⚙️  Custom Command Mode
echo.
echo Available flags:
echo   -t "task description"    Task to execute
echo   --vision                 Enable screenshot analysis
echo   --memory                 Enable session persistence
echo   --multi-tab              Enable parallel tabs
echo   --headless               Run without visible browser
echo   --provider anthropic     Use Anthropic instead of OpenAI
echo.
echo Example: python main_v2.py -t "Go to google.com" --vision
echo.
set /p cmd="Enter command: "
%cmd%
goto done

:done
echo.
echo ╔═══════════════════════════════════════════════════════════════════╗
echo ║                         ✅ DONE                                   ║
echo ╚═══════════════════════════════════════════════════════════════════╝
echo.
echo What would you like to do?
echo [R] Run again  [M] Main menu  [Q] Quit
echo.
set /p again="Choice: "
if /i "%again%"=="r" goto menu
if /i "%again%"=="m" goto menu
if /i "%again%"=="q" goto quit

:quit
echo.
echo 👋 Thanks for using Agentic Browser V2!
echo.
echo To run again later, just double-click:
echo   RUN_ME_FIRST.bat
echo.
echo Or open Command Prompt in this folder and run:
echo   venv\Scripts\activate
echo   python main_v2.py
echo.
timeout /t 3 >nul
exit /b 0
