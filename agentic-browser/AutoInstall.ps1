# Agentic Browser - Auto Installation PowerShell Script
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Agentic Browser V2 - Auto Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Find Python
Write-Host "[1/6] Locating Python..." -ForegroundColor Yellow
$pythonPaths = @(
    "C:\Python311\python.exe",
    "C:\Python312\python.exe",
    "C:\Python310\python.exe",
    "$env:USERPROFILE\AppData\Local\Programs\Python\Python311\python.exe",
    "$env:USERPROFILE\AppData\Local\Programs\Python\Python312\python.exe",
    "$env:USERPROFILE\AppData\Local\Programs\Python\Python310\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "C:\Program Files\Python311\python.exe",
    "C:\Program Files\Python312\python.exe"
)

$pythonCmd = $null
foreach ($path in $pythonPaths) {
    if (Test-Path $path) {
        $pythonCmd = $path
        break
    }
}

# Try command-based Python
if (-not $pythonCmd) {
    try {
        $result = & python.exe --version 2>&1
        if ($result -match "Python") {
            $pythonCmd = "python.exe"
        }
    } catch {}
}

if (-not $pythonCmd) {
    Write-Host "  X Python not found!" -ForegroundColor Red
    Write-Host "  Please restart your computer after installing Python," -ForegroundColor Red
    Write-Host "  or install Python from https://python.org/downloads" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "  Found: $pythonCmd" -ForegroundColor Green

# Create virtual environment
Write-Host ""
Write-Host "[2/6] Creating virtual environment..." -ForegroundColor Yellow
if (Test-Path "venv") {
    Write-Host "  Virtual environment exists" -ForegroundColor Green
} else {
    & $pythonCmd -m venv venv
    Write-Host "  Created venv" -ForegroundColor Green
}

# Activate and install
Write-Host ""
Write-Host "[3/6] Activating virtual environment..." -ForegroundColor Yellow
$venvPython = ".\venv\Scripts\python.exe"
$venvPip = ".\venv\Scripts\pip.exe"

Write-Host "  Activated" -ForegroundColor Green

Write-Host ""
Write-Host "[4/6] Upgrading pip..." -ForegroundColor Yellow
& $venvPython -m pip install --upgrade pip -q
Write-Host "  Done" -ForegroundColor Green

Write-Host ""
Write-Host "[5/6] Installing packages (this takes 3-5 minutes)..." -ForegroundColor Yellow
& $venvPip install -r requirements.txt -q
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Retrying with verbose output..." -ForegroundColor Yellow
    & $venvPip install -r requirements.txt
}
Write-Host "  Packages installed" -ForegroundColor Green

Write-Host ""
Write-Host "[6/6] Installing Playwright browsers..." -ForegroundColor Yellow
$venvPlaywright = ".\venv\Scripts\playwright.exe"
& $venvPlaywright install chromium
Write-Host "  Chromium installed" -ForegroundColor Green

# Check .env
Write-Host ""
Write-Host "Checking environment file..." -ForegroundColor Yellow
if (Test-Path ".env") {
    $envContent = Get-Content ".env" -Raw
    if ($envContent -match "OPENAI_API_KEY=sk-" -or $envContent -match "ANTHROPIC_API_KEY=sk-") {
        Write-Host "  API key configured" -ForegroundColor Green
    } else {
        Write-Host "  Please add your API key to .env file" -ForegroundColor Yellow
        notepad .env
    }
} else {
    Copy-Item ".env.example" ".env"
    Write-Host "  Created .env - please add your API key" -ForegroundColor Yellow
    notepad .env
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "To run Agentic Browser:" -ForegroundColor Cyan
Write-Host "  1. Run: .\venv\Scripts\activate" -ForegroundColor White
Write-Host "  2. Run: python main_v2.py" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
