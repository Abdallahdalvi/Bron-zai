# 🌐 Agentic Browser V2

A powerful, fully-featured agentic browser built with Python + Playwright + LLMs. 

**New in V2:** Vision analysis • Persistent memory • Multi-tab support • Auto-retry • Error recovery

Inspired by BrowserOS and browser-use.

## ✨ Features

### Core
- **Chromium-based**: Uses Playwright for reliable browser automation
- **CDP Integration**: Full Chrome DevTools Protocol support
- **Multi-LLM Support**: Works with OpenAI (GPT-4, GPT-4o) and Anthropic (Claude 3)
- **Tool System**: Extensible tool registry for custom actions
- **Headless/Vision Mode**: Run in background or with visual browser

### V2 Enhancements 🚀

#### 👁️ Vision Analysis
- Screenshots analyzed by multimodal LLMs
- Visual understanding of page state
- UI element detection and guidance
- Progress tracking via visual cues

#### 🧠 Persistent Memory
- Session history stored locally
- Learned behaviors across tasks
- Similar task suggestions
- Detailed session reports

#### 📑 Multi-Tab Management
- Parallel browsing across multiple sites
- Tab grouping by task
- Concurrent data extraction
- Side-by-side page comparison

#### 🔄 Auto-Retry & Recovery
- Intelligent error classification
- Exponential backoff with jitter
- Automatic recovery actions
- Circuit breaker pattern
- Context-aware retries (scroll, wait, refresh)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Clone or create the project directory
cd agentic-browser

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate
# Activate (Mac/Linux)
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

### 2. Setup API Keys

```bash
# Copy example env file
cp .env.example .env

# Edit .env and add your API keys
OPENAI_API_KEY=your_key_here
# OR
ANTHROPIC_API_KEY=your_key_here
```

### 3. Run It

```bash
# Interactive mode
python main.py

# Single task mode
python main.py -t "Go to example.com and find the main heading"

# Headless mode (no visible browser)
python main.py -t "Search for Python tutorials on google.com" --headless

# Use Anthropic Claude
python main.py --provider anthropic -t "Go to news.ycombinator.com and get the top 3 stories"
```

## 📁 Project Structure

```
agentic-browser/
├── agent.py              # Main agent loop and LLM integration
├── browser.py            # Browser controller (Playwright/CDP)
├── tools.py              # Tool registry and default tools
├── main.py               # CLI entry point
├── custom_tools_example.py  # How to add custom tools
├── requirements.txt      # Python dependencies
├── .env.example          # Environment variables template
└── README.md             # This file
```

## 🔧 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AgenticAgent                            │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐      │
│  │  Task    │→ │  LLM Client  │→ │  Browser Control │      │
│  └──────────┘  └──────────────┘  └──────────────────┘      │
│                                   │                         │
│                    ┌──────────────┴──────────────┐         │
│                    │        Tool Registry        │         │
│                    │  • navigate                 │         │
│                    │  • click                    │         │
│                    │  • type                     │         │
│                    │  • get_text                 │         │
│                    │  • screenshot               │         │
│                    │  • scroll                   │         │
│                    └─────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌───────────────────┐
                    │  Playwright/CDP   │
                    │  Chromium Browser │
                    └───────────────────┘
```

## 🛠️ Available Tools

| Tool | Description |
|------|-------------|
| `navigate` | Navigate to a URL |
| `click` | Click an element by selector or text |
| `type` | Type text into input fields |
| `get_text` | Extract text content from page |
| `scroll` | Scroll page in any direction |
| `screenshot` | Capture page screenshot |
| `extract_links` | Get all links from page |
| `press_key` | Press keyboard keys (Enter, Tab, etc.) |
| `wait` | Wait for specified duration |
| `go_back` | Navigate back in history |
| `get_page_info` | Get current URL and title |
| `think` | Plan next steps |
| `terminate` | End task with result |

## 🧩 Adding Custom Tools

See `custom_tools_example.py` for a complete example:

```python
from tools import ToolRegistry

class MyTools(ToolRegistry):
    def __init__(self):
        super().__init__()
        
        # Register custom tool
        self.register(
            name="extract_images",
            description="Extract all images from the page",
            parameters={...},
            function=self._extract_images
        )
    
    async def _extract_images(self, browser, min_width=100):
        # Your custom logic here
        return "Images extracted"
```

## 💡 Example Tasks

```python
# News extraction
"Go to bbc.com and get the top 5 headlines"

# Form filling
"Go to forms.example.com and fill the contact form with name John, email john@example.com"

# Data extraction
"Go to github.com/trending and list the top 3 repositories with their star counts"

# Shopping
"Go to amazon.com and find the price of 'wireless headphones'"

# Research
"Search for the latest AI news on techcrunch.com"
```

## 🔐 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key |
| `DEFAULT_PROVIDER` | No | Default provider (openai/anthropic) |

*At least one API key is required

## ⚙️ Configuration

Edit constants in `agent.py`:

```python
self.max_steps = 20  # Maximum steps per task
self.viewport = {"width": 1280, "height": 800}  # Browser window size
```

## 🐛 Debugging

```bash
# Run with visible browser to watch actions
python main.py -t "your task" 

# Check console logs in browser
# Add to browser.py:
page.on("console", lambda msg: print(f"Console: {msg.text}"))
```

## 📦 Dependencies

- **playwright**: Browser automation
- **pydantic**: Data validation
- **httpx**: Async HTTP client for LLM APIs
- **rich**: Terminal formatting
- **pillow**: Image processing

## 🔮 Future Enhancements

- [ ] Vision capabilities (analyze screenshots with GPT-4V)
- [ ] Memory/persistence across sessions
- [ ] Concurrent tab management
- [ ] Custom skill system
- [ ] WebSocket server for external control
- [ ] Built-in retry and error recovery

## 📄 License

MIT License - Feel free to use and modify!

## 🙏 Credits

Inspired by:
- [BrowserOS](https://github.com/browser-use/browser-use)
- [Anthropic Computer Use](https://github.com/anthropics/anthropic-quickstarts)
- [Playwright](https://playwright.dev/python/)

---

Built with ❤️ using Python + Playwright + LLMs
