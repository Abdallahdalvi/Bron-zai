# Agentic Browser V2 - Feature Documentation

## 🚀 Quick Feature Comparison

| Feature | V1 (Basic) | V2 (Enhanced) |
|---------|-----------|---------------|
| Browser Control | ✅ | ✅ |
| LLM Integration | ✅ | ✅ |
| Screenshots | ✅ | ✅ + Vision Analysis |
| Tools | 14 tools | 14 tools + Custom |
| Tabs | Single | Multi-Tab (Parallel) |
| Memory | Session-only | Persistent Storage |
| Error Handling | Basic | Auto-Retry + Recovery |
| Vision | ❌ | ✅ Multimodal LLM |
| Session Reports | ❌ | ✅ Detailed Export |

---

## 🌟 V2 Feature Details

### 1. Vision Analysis (`vision.py`)

**What it does:**
- Captures and analyzes screenshots using GPT-4 Vision or Claude Vision
- Understands visual layout, UI elements, and page state
- Provides suggestions for next actions based on visual cues

**Usage:**
```python
from agent_v2 import AgenticAgentV2

agent = AgenticAgentV2(
    task="Find the red 'Submit' button",
    use_vision=True  # Enable vision!
)
```

**Vision Output Example:**
```json
{
  "description": "Login page with email/password fields",
  "page_state": "interactive",
  "ui_elements": [
    {"type": "input", "location": "center", "text": "email"},
    {"type": "button", "location": "bottom", "text": "Sign In"}
  ],
  "suggested_action": "Click the Sign In button",
  "confidence": 0.92,
  "task_progress": "in progress"
}
```

---

### 2. Persistent Memory (`memory.py`)

**What it does:**
- Stores session history locally (`agent_memory/sessions/`)
- Remembers learned behaviors and patterns
- Suggests similar completed tasks
- Exports detailed session reports

**Storage Structure:**
```
agent_memory/
├── sessions/
│   ├── a1b2c3d4.json     # Session records
│   └── e5f6g7h8.json
└── knowledge/
    ├── user_preference_xxx.json
    └── site_behavior_yyy.json
```

**Usage:**
```python
agent = AgenticAgentV2(
    task="Go to example.com",
    use_memory=True  # Enable memory!
)

# After completion
report = agent.get_session_report()
```

---

### 3. Multi-Tab Management (`tab_manager.py`)

**What it does:**
- Opens multiple pages simultaneously
- Parallel data extraction across sites
- Tab grouping for organization
- Background task execution

**Usage:**
```python
from agent_v2 import AgenticAgentV2

agent = AgenticAgentV2(
    task="Compare prices",
    enable_multi_tab=True
)

# Start parallel search
results = await agent.parallel_search(
    query="laptop",
    sites=[
        "https://amazon.com",
        "https://ebay.com",
        "https://bestbuy.com"
    ]
)
```

**Visual Tab Status:**
```
Tabs: [tab_1: amazon.com ACTIVE] [tab_2: ebay.com LOADING] [tab_3: bestbuy.com IDLE]
```

---

### 4. Auto-Retry & Recovery (`retry_handler.py`)

**What it does:**
- Automatic retry on failures
- Exponential backoff with jitter
- Classification-based recovery strategies
- Circuit breaker pattern for cascading failures

**Error Types & Strategies:**

| Error Type | Recovery Actions |
|------------|-----------------|
| Network | Wait → Refresh → Restart Browser |
| Element | Scroll → Wait → Refresh |
| Navigation | Go Back → Retry URL → Fallback URL |
| Rate Limit | Long Wait → Switch Proxy → Exponential Backoff |

**Usage:**
```python
# Automatic - no code changes needed!
agent = AgenticAgentV2(
    task="Unreliable site",
    # Retries happen automatically
)

# Or manual retry on any function:
from retry_handler import with_retry

@with_retry(max_retries=3, base_delay=1.0)
async def my_function():
    # Will retry 3 times on failure
    pass
```

**Retry Console Output:**
```
⚠ Attempt 1 failed: Timeout error
  Error type: network
  Retrying in 2.5s...
→ Retry 1 (network)
⚠ Attempt 2 failed: Connection refused
  Error type: network
  Retrying in 5.1s...
→ Retry 2 (network)
✓ Success on attempt 3
```

---

## 📊 Architecture Overview

### V2 Full Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AgenticAgentV2                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Vision       │  │ LLM Client   │  │ Memory Manager   │  │
│  │ Analyzer     │  │ (Multi-LLM)  │  │ (Persistent)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Tab Manager  │  │ Tool Registry│  │ Retry Handler    │  │
│  │ (Parallel)   │  │ (14+ tools)  │  │ (Auto-Recovery)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                    ┌───────┴───────┐
                    │  Playwright   │
                    └───────┬───────┘
                            │
                   ┌────────┴────────┐
                   │ Chromium (CDP)  │
                   └─────────────────┘
```

---

## 🎯 Example Workflows

### Workflow 1: Vision-Assisted Navigation
```
User: "Find the blue 'Download' button on example.com"

1. Agent navigates to site
2. Takes screenshot
3. Vision API analyzes: "Blue button at bottom right, text: Download"
4. Agent clicks at coordinates (inferred from vision)
5. Task complete!
```

### Workflow 2: Parallel Price Comparison
```
User: "Find the best price for iPhone 15"

1. Agent opens 3 tabs: Amazon, Best Buy, Apple
2. Parallel search on all sites
3. Extract prices simultaneously
4. Compare and return best deal
5. Close all tabs
```

### Workflow 3: Memory-Assisted Repeat Task
```
User: "Check my GitHub notifications"
(Previously completed similar task)

1. Memory recalls: "github.com -> click bell icon -> extract notifications"
2. Agent follows learned pattern
3. Faster completion with known selectors
4. Saves new lessons learned
```

### Workflow 4: Resilient Scraping
```
User: "Extract data from flaky-site.com"

1. Request fails (network error)
2. Auto-retry with 2s delay
3. Fails again → refresh page
4. Fails again → restart browser
5. Succeeds on 4th attempt!
6. Returns data
```

---

## 🔧 Configuration Options

### Agent Instantiation Options

```python
AgenticAgentV2(
    # Required
    task="Your task here",
    llm_provider="openai",  # or "anthropic"
    llm_api_key="your-key",
    
    # Optional Features
    use_vision=True,         # Enable screenshot analysis
    use_memory=True,         # Enable session persistence
    enable_multi_tab=True,   # Enable parallel tabs
    
    # Behavior
    headless=False,          # Show/hide browser window
    max_steps=25,           # Step limit per task
    viewport={"width": 1280, "height": 800},
)
```

### CLI Usage

```bash
# V2 with all features
python main_v2.py

# V1 simple mode (backwards compatible)
python main.py

# Specific feature flags
python main_v2.py -t "Task" --vision --memory --multi-tab
python main_v2.py -t "Task" --headless --max-steps 50
```

---

## 📈 Performance Impact

| Feature | Latency | Resource Usage | Recommendation |
|---------|---------|----------------|----------------|
| Vision | +2-5s per step | Medium | Use for complex UI tasks |
| Memory | +50ms | Low | Always enable |
| Multi-Tab | Parallel (faster overall) | Higher RAM | Use for comparisons |
| Retry | +1-30s on failure | Low | Always enable |

---

## 💡 Best Practices

1. **Vision**: Enable when:
   - Task involves visual elements (colors, positions)
   - Site layout changes frequently
   - Need to understand complex UIs

2. **Memory**: Enable when:
   - Running similar tasks repeatedly
   - Want session history
   - Building up domain knowledge

3. **Multi-Tab**: Enable when:
   - Comparing multiple sites
   - Gathering data from various sources
   - Task benefits from parallel work

4. **Retry**: Always keep enabled for production reliability

---

## 🎓 Migration from V1

V1 code is fully compatible:

```python
# V1 (still works)
from agent import AgenticAgent
agent = AgenticAgent(task="...", llm_provider="...")

# V2 (enhanced)
from agent_v2 import AgenticAgentV2
agent = AgenticAgentV2(
    task="...",
    llm_provider="...",
    use_vision=True,
    use_memory=True,
    enable_multi_tab=True
)
```

Alias provided for backwards compatibility:
```python
from agent_v2 import AgenticAgent  # Actually AgenticAgentV2
```
