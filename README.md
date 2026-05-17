# Bron — Local Agentic Browser

**Bron** is a desktop app that combines a real browser experience with an AI agent that can automate web tasks. Built with Electron, React, Playwright, and OpenRouter.

## Features

- **Real browsing** — Playwright-powered Chromium, full web compatibility
- **AI agent** — Give natural language tasks, watch the agent work step by step
- **Multiple themes** — Switch between **Dark**, **Medium**, and **Light** modes via the 3-dot menu.
- **Multiple tabs** — Open, switch, and close tabs just like a browser (tabs are positioned to the right of the URL bar).
- **Dalvi Cloud Integration** — Quick access to Abdallah Dalvi's personal cloud services.
- **Memory** — SQLite-backed memory that persists useful facts across sessions
- **Safety** — Action validation, sensitive data blocking, risky action confirmation

## Architecture

```
┌─────────────────────────────────────────────┐
│           Electron Window (UI)              │
│  ┌───────────────────┐  ┌────────────────┐  │
│  │  Browser View     │  │  AI Sidebar    │  │
│  │  (screenshots)    │  │  (chat + steps)│  │
│  │                   │  │                │  │
│  └───────────────────┘  └────────────────┘  │
└──────────────┬──────────────────────────────┘
               │ IPC
┌──────────────▼──────────────────────────────┐
│           Main Process                       │
│  ┌──────────┐ ┌────────┐ ┌───────────────┐  │
│  │Playwright│ │ Agent  │ │  OpenRouter   │  │
│  │Controller│ │ Loop   │ │  API Client   │  │
│  └──────────┘ └────────┘ └───────────────┘  │
│  ┌──────────┐ ┌────────┐                     │
│  │ SQLite   │ │ Safety │                     │
│  │ Memory   │ │ Layer  │                     │
│  └──────────┘ └────────┘                     │
└─────────────────────────────────────────────┘
```

## Quick Start

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Set your OpenRouter API key

Copy `.env.example` to `.env` and add your key:

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o-mini
```

Or set it in the app's **Settings** panel after launching.

### 3. Run in development mode

```bash
npm run dev
```

This starts Vite (renderer), tsc (main process), and Electron concurrently.

### 4. Build for production

```bash
npm run build
```

### 5. Create Windows portable exe

```bash
npm run dist
```

Output: `release/Bron-win32-x64/Bron.exe`

### 🚀 How to use the Portable EXE
1. Run `npm run dist` to generate the portable folder.
2. Navigate to `release/Bron-win32-x64/`.
3. Launch **Bron.exe**.
4. **Prerequisite**: If the browser doesn't open, run `npx playwright install chromium` in a terminal once on your system to ensure the browser engine is available.

### 6. Create Windows installer (requires admin or Developer Mode)

```bash
npm run dist:installer
```

Output: `release/Bron Setup.exe`

> **Note:** `dist:installer` uses electron-builder which requires Windows Developer Mode or admin privileges for code signing cache extraction. Use `npm run dist` (electron-packager) if you encounter symlink errors.

## Project Structure

```
bron/
├── package.json
├── electron-builder.json
├── tsconfig.json
├── tsconfig.main.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── .env.example
├── README.md
├── src/
│   ├── main/
│   │   ├── main.ts              # Electron entry point
│   │   ├── preload.ts           # Context bridge
│   │   ├── ipc.ts               # IPC handler registration
│   │   ├── openrouter.ts        # OpenRouter API client
│   │   ├── memory.ts            # SQLite (sql.js) persistence
│   │   ├── agent.ts             # Agent loop
│   │   ├── browserController.ts # Playwright browser control
│   │   └── safety.ts            # Action validation
│   ├── renderer/
│   │   ├── index.html
│   │   ├── index.tsx
│   │   ├── App.tsx
│   │   ├── styles.css
│   │   └── components/
│   │       ├── BrowserToolbar.tsx
│   │       ├── TabBar.tsx
│   │       ├── AgentSidebar.tsx
│   │       ├── MemoryPanel.tsx
│   │       └── SettingsPanel.tsx
│   └── shared/
│       └── types.ts             # Shared type definitions
└── dist/                        # Build output
    ├── main/                    # Compiled main process
    └── renderer/                # Built React app
```

## Architecture

Bron operates in **Unified Agent Mode** by default:
- The AI agent controls the same webview you browse in — no separate browser instance
- When the agent acts, you see it happen live in the browser view
- Login state, cookies, and sessions are shared between you and the agent

Legacy mode (separate Playwright browser) is available but deprecated.

## Limitations

- Memory search is keyword-based (no vector/semantic search yet).
- The agent has a max step limit (default: 20, configurable in Settings).
- NSIS installer build (`dist:installer`) requires Windows Developer Mode or admin privileges.

## Safety

- **No arbitrary code execution** from AI responses
- **Sensitive data blocked** from being stored in memory
- **Financial/legal actions** require user confirmation
- **API keys** stored locally in SQLite, never transmitted except to OpenRouter
- **No CAPTCHA bypass**, no paywall circumvention

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron |
| UI | React + TypeScript + TailwindCSS |
| Browser engine | Playwright (Chromium) |
| AI | OpenRouter API |
| Database | SQLite (sql.js / WASM) |
| Build | Vite + tsc + electron-packager |
| Icons | lucide-react |

## License

MIT
