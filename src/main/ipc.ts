import { ipcMain, BrowserWindow, shell, app, session } from 'electron';
import fs from 'fs';
import path from 'path';
import { BrowserController } from './browserController';
import type { AgentAutomationController } from './automationController';
import { runAgent, stopAgent } from './agent';
import { pickAndPrepareAgentAttachments } from './attachments';
import { fetchOpenRouterModels } from './openrouter';
import {
  getAllMemories,
  clearAllMemories,
  getSettings,
  saveSettings,
  getChatSessions,
  getChatSession,
  saveChatSession,
  deleteChatSession,
  addMemory,
  getCreditUsageHistory,
  getHistory,
  addHistoryEntry,
} from './memory';
import {
  searchMemory as searchMarkdownMemory,
  writeDailyMemory,
  readCore,
  updateCore,
  readSoul,
  updateSoul,
} from '../memory';
import { listSkills, findSkill } from './skills';
import { IPC, ChatMessage, AgentRunRequest } from '../shared/types';

export function parseDomainProfileMap(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') return {};
  const text = raw.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const [domain, profile] of Object.entries(parsed as Record<string, unknown>)) {
      const d = domain.trim().toLowerCase();
      const p = String(profile || '').trim();
      if (!d || !p) continue;
      map[d] = p;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Register all IPC handlers that the renderer calls via bronAPI.
 */
export function setupIPC(
  getWindow: () => BrowserWindow | null,
  browserController: BrowserController,
  agentController?: AgentAutomationController,
): void {
  // ── Browser ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.NAVIGATE, async (_e, url: string) => {
    await browserController.navigate(url);
    return await browserController.getTabs();
  });

  ipcMain.handle(IPC.GO_BACK, async () => {
    await browserController.goBack();
  });

  ipcMain.handle(IPC.GO_FORWARD, async () => {
    await browserController.goForward();
  });

  ipcMain.handle(IPC.REFRESH, async () => {
    await browserController.refresh();
  });

  ipcMain.handle(IPC.NEW_TAB, async (_e, url?: string) => {
    return await browserController.newTab(url);
  });

  ipcMain.handle(IPC.CLOSE_TAB, async (_e, tabId: string) => {
    await browserController.closeTab(tabId);
    return await browserController.getTabs();
  });

  ipcMain.handle(IPC.SWITCH_TAB, async (_e, tabId: string) => {
    await browserController.switchTab(tabId);
    return await browserController.getTabs();
  });

  ipcMain.handle(IPC.GET_STATE, async () => {
    return await browserController.getBrowserState();
  });

  ipcMain.handle(IPC.GET_SCREENSHOT, async () => {
    return await browserController.getScreenshot();
  });

  ipcMain.handle(IPC.GET_TABS, async () => {
    return await browserController.getTabs();
  });

  ipcMain.handle(IPC.OPEN_EXTERNAL_URL, async (_e, rawUrl: string) => {
    const url = String(rawUrl || '').trim();
    if (!url) return { opened: false, reason: 'Empty URL' };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { opened: false, reason: 'Invalid URL' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { opened: false, reason: 'Unsupported URL protocol' };
    }

    await shell.openExternal(parsed.toString());
    return { opened: true };
  });

  // ── Agent ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.RUN_AGENT, async (_e, taskInput: string | AgentRunRequest) => {
    // Run in background — don't await (the renderer listens for events)
    runAgent(taskInput, agentController || browserController, getWindow).catch((err) => {
      const win = getWindow();
      win?.webContents.send(IPC.AGENT_ERROR, String(err));
    });
    return { started: true };
  });

  ipcMain.handle(IPC.STOP_AGENT, async () => {
    stopAgent();
    return { stopped: true };
  });

  ipcMain.handle(IPC.PICK_ATTACHMENTS, async () => {
    return await pickAndPrepareAgentAttachments(getWindow());
  });

  // ── Memory ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_MEMORIES, async () => {
    return getAllMemories();
  });

  ipcMain.handle(IPC.SAVE_MEMORY, async (_e, key: string, value: string, source: string) => {
    addMemory(key, value, source);
    return { saved: true };
  });

  ipcMain.handle(IPC.MEMORY_SEARCH, async (_e, query: string | string[]) => {
    return await searchMarkdownMemory(query);
  });

  ipcMain.handle(IPC.MEMORY_WRITE_DAILY, async (_e, content: string, title?: string) => {
    const targetPath = await writeDailyMemory(content, title);
    return { path: targetPath };
  });

  ipcMain.handle(IPC.MEMORY_READ_CORE, async () => {
    return await readCore();
  });

  ipcMain.handle(IPC.MEMORY_UPDATE_CORE, async (_e, additions: string[], removals: string[]) => {
    await updateCore(additions || [], removals || []);
    return { updated: true };
  });

  ipcMain.handle(IPC.SOUL_READ, async () => {
    return await readSoul();
  });

  ipcMain.handle(IPC.SOUL_UPDATE, async (_e, content: string) => {
    await updateSoul(content);
    return { updated: true };
  });

  ipcMain.handle(IPC.GET_CREDIT_USAGE_HISTORY, async (_e, limit?: number) => {
    return getCreditUsageHistory(limit);
  });

  ipcMain.handle(IPC.CLEAR_MEMORIES, async () => {
    clearAllMemories();
    return { cleared: true };
  });
  
  ipcMain.handle(IPC.GET_HISTORY, async () => {
    return getHistory();
  });

  ipcMain.handle(IPC.ADD_HISTORY_ENTRY, async (_e, url: string, title: string) => {
    addHistoryEntry(url, title);
  });

  // ── Chat History ─────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_CHAT_SESSIONS, async () => {
    return getChatSessions();
  });

  ipcMain.handle(IPC.GET_CHAT_SESSION, async (_e, id: number) => {
    return getChatSession(id);
  });

  ipcMain.handle(IPC.SAVE_CHAT_SESSION, async (_e, title: string, messages: ChatMessage[], id?: number) => {
    return saveChatSession(title, messages, id);
  });

  ipcMain.handle(IPC.DELETE_CHAT_SESSION, async (_e, id: number) => {
    deleteChatSession(id);
    return { deleted: true };
  });

  // ── Browser Highlight ────────────────────────────────────────────

  ipcMain.handle(IPC.HIGHLIGHT_ELEMENT, async (_e, selector: string) => {
    await browserController.highlightElement(selector);
    return { highlighted: true };
  });

  // ── Settings ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    return getSettings();
  });

  ipcMain.handle(IPC.GET_MODELS, async () => {
    const settings = getSettings();
    const models = await fetchOpenRouterModels(settings.apiKey, 60);
    return models;
  });

  ipcMain.handle(IPC.GET_PROFILES, async () => {
    const profilesDir = path.join(app.getPath('userData'), 'profiles');
    if (!fs.existsSync(profilesDir)) return ['default'];
    try {
      const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
      const profiles = entries
        .filter(e => e.isDirectory())
        .map(e => e.name);
      if (!profiles.includes('default')) profiles.unshift('default');
      return profiles;
    } catch {
      return ['default'];
    }
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_e, settings: Record<string, unknown>) => {
    saveSettings(settings as any);

    // Apply runtime settings
    if ('headless' in settings) {
      browserController.setHeadless(settings.headless as boolean);
    }
    if (typeof settings.browserProfile === 'string') {
      await browserController.setProfile(settings.browserProfile);
    }
    if ('domainProfiles' in settings) {
      browserController.setDomainProfileMap(parseDomainProfileMap(settings.domainProfiles));
    }

    return { saved: true };
  });

  ipcMain.handle(IPC.GET_SKILLS, async () => {
    return await listSkills();
  });

  ipcMain.handle(IPC.FIND_SKILL, async (_e, query: string) => {
    return await findSkill(query);
  });

  ipcMain.handle(IPC.EXIT_APP, async () => {
    app.quit();
  });

  ipcMain.handle(IPC.CLEAR_DATA, async () => {
    await session.defaultSession.clearStorageData();
    return { cleared: true };
  });

  ipcMain.handle(IPC.OPEN_DOWNLOADS, async () => {
    shell.openPath(app.getPath('downloads'));
  });

  ipcMain.handle(IPC.OPEN_HISTORY, async () => {
    // For now, we don't have a dedicated history page, but we could open a modal or a local file
    // Opening Google History as a fallback for demo
    await browserController.newTab('https://myactivity.google.com/myactivity');
  });
}
