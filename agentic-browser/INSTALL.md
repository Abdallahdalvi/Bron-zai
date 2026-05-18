# Installation Guide - Agentic Browser on Windows

## Step 1: Install Python

### Option A: Microsoft Store (Easiest)
1. Press `Win + S`, search "Microsoft Store"
2. Search for "Python 3.11"
3. Click "Get" and install
4. Restart your terminal/command prompt

### Option B: Official Installer
1. Go to: https://www.python.org/downloads/
2. Click "Download Python 3.11.x"
3. **IMPORTANT**: Check "Add Python to PATH" during installation
4. Click "Install Now"

### Verify Installation:
```bash
python --version
# Should show: Python 3.11.x or higher

pip --version
# Should show pip version
```

## Step 2: Install Agentic Browser

Open Command Prompt or PowerShell in the `agentic-browser` folder:

```bash
# Navigate to the folder
cd path\to\agentic-browser

# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

## Step 3: Setup API Key

```bash
# Copy example file
copy .env.example .env

# Edit .env with Notepad
notepad .env
```

Add your API key:
```
OPENAI_API_KEY=sk-your-actual-api-key-here
```

Get API key from: https://platform.openai.com/api-keys

## Step 4: Run It!

```bash
# Interactive V2 mode
python main_v2.py

# Or single task
python main_v2.py -t "Go to example.com and get the heading"
```

## Troubleshooting

### "Python was not found"
- Restart your terminal after installing Python
- Try `py` instead of `python`
- Make sure "Add to PATH" was checked during install

### "pip is not recognized"
```bash
python -m pip install --upgrade pip
```

### "playwright command not found"
```bash
python -m playwright install chromium
```

### ModuleNotFoundError
Make sure you activated the virtual environment:
```bash
venv\Scripts\activate
```

## Quick Test

After installation, verify everything works:

```bash
python check_setup.py
```

This will check:
- ✅ Python version
- ✅ Required packages
- ✅ Environment file
- ✅ Playwright browsers

## Alternative: Docker (If Available)

If you have Docker:

```dockerfile
# Create Dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN playwright install chromium

COPY . .

CMD ["python", "main_v2.py"]
```

Then:
```bash
docker build -t agentic-browser .
docker run -it --env-file .env agentic-browser
```
