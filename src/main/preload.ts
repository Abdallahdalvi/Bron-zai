import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

/**
 * Preload script — exposes a safe `bronAPI` object on window
 * so the React renderer can call main-process functions via IPC.
 */
contextBridge.exposeInMainWorld('bronAPI', {
  // ── Browser ──────────────────────────────────────────────────────
  navigate: (url: string) => ipcRenderer.invoke(IPC.NAVIGATE, url),
  goBack: () => ipcRenderer.invoke(IPC.GO_BACK),
  goForward: () => ipcRenderer.invoke(IPC.GO_FORWARD),
  refresh: () => ipcRenderer.invoke(IPC.REFRESH),
  newTab: (url?: string) => ipcRenderer.invoke(IPC.NEW_TAB, url),
  closeTab: (tabId: string) => ipcRenderer.invoke(IPC.CLOSE_TAB, tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke(IPC.SWITCH_TAB, tabId),
  getState: () => ipcRenderer.invoke(IPC.GET_STATE),
  getScreenshot: () => ipcRenderer.invoke(IPC.GET_SCREENSHOT),
  getTabs: () => ipcRenderer.invoke(IPC.GET_TABS),
  openExternalUrl: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL_URL, url),

  // ── Agent ────────────────────────────────────────────────────────
  runAgent: (taskInput: string | { task: string; attachments?: any[]; contextMessages?: string[] }) =>
    ipcRenderer.invoke(IPC.RUN_AGENT, taskInput),
  stopAgent: () => ipcRenderer.invoke(IPC.STOP_AGENT),
  pickAgentAttachments: () => ipcRenderer.invoke(IPC.PICK_ATTACHMENTS),

  // ── Memory ───────────────────────────────────────────────────────
  getMemories: () => ipcRenderer.invoke(IPC.GET_MEMORIES),
  clearMemories: () => ipcRenderer.invoke(IPC.CLEAR_MEMORIES),
  saveMemory: (key: string, value: string, source: string) => ipcRenderer.invoke(IPC.SAVE_MEMORY, key, value, source),
  searchMemory: (query: string | string[]) => ipcRenderer.invoke(IPC.MEMORY_SEARCH, query),
  writeDailyMemory: (content: string, title?: string) =>
    ipcRenderer.invoke(IPC.MEMORY_WRITE_DAILY, content, title),
  readCoreMemory: () => ipcRenderer.invoke(IPC.MEMORY_READ_CORE),
  updateCoreMemory: (additions: string[], removals: string[]) =>
    ipcRenderer.invoke(IPC.MEMORY_UPDATE_CORE, additions, removals),
  readSoul: () => ipcRenderer.invoke(IPC.SOUL_READ),
  updateSoul: (content: string) => ipcRenderer.invoke(IPC.SOUL_UPDATE, content),
  getCreditUsageHistory: (limit?: number) => ipcRenderer.invoke(IPC.GET_CREDIT_USAGE_HISTORY, limit),
  getHistory: () => ipcRenderer.invoke(IPC.GET_HISTORY),
  addHistoryEntry: (url: string, title: string) => ipcRenderer.invoke(IPC.ADD_HISTORY_ENTRY, url, title),

  // ── Settings ─────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  getModels: () => ipcRenderer.invoke(IPC.GET_MODELS),
  getProfiles: () => ipcRenderer.invoke(IPC.GET_PROFILES),
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),
  getSkills: () => ipcRenderer.invoke(IPC.GET_SKILLS),
  findSkill: (query: string) => ipcRenderer.invoke(IPC.FIND_SKILL, query),

  // ── Chat History ────────────────────────────────────────────────
  getChatSessions: () => ipcRenderer.invoke(IPC.GET_CHAT_SESSIONS),
  getChatSession: (id: number) => ipcRenderer.invoke(IPC.GET_CHAT_SESSION, id),
  saveChatSession: (title: string, messages: any[], id?: number) =>
    ipcRenderer.invoke(IPC.SAVE_CHAT_SESSION, title, messages, id),
  deleteChatSession: (id: number) => ipcRenderer.invoke(IPC.DELETE_CHAT_SESSION, id),
  openReportWindow: (html: string) => ipcRenderer.invoke(IPC.OPEN_REPORT_WINDOW, html),
  exitApp: () => ipcRenderer.invoke(IPC.EXIT_APP),
  clearData: () => ipcRenderer.invoke(IPC.CLEAR_DATA),
  openDownloads: () => ipcRenderer.invoke(IPC.OPEN_DOWNLOADS),
  openHistory: () => ipcRenderer.invoke(IPC.OPEN_HISTORY),
  newWindow: () => ipcRenderer.invoke(IPC.NEW_WINDOW),
  newIncognitoWindow: () => ipcRenderer.invoke(IPC.NEW_INCOGNITO_WINDOW),

  // ── Browser Highlight ──────────────────────────────────────────
  highlightElement: (selector: string) => ipcRenderer.invoke(IPC.HIGHLIGHT_ELEMENT, selector),

  // ── Event listeners (main → renderer) ────────────────────────────
  onAgentStep: (cb: (_e: unknown, data: unknown) => void) => {
    ipcRenderer.on(IPC.AGENT_STEP, cb);
    return () => ipcRenderer.removeListener(IPC.AGENT_STEP, cb);
  },
  onAgentDone: (cb: (_e: unknown, data: unknown) => void) => {
    ipcRenderer.on(IPC.AGENT_DONE, cb);
    return () => ipcRenderer.removeListener(IPC.AGENT_DONE, cb);
  },
  onAgentError: (cb: (_e: unknown, data: unknown) => void) => {
    ipcRenderer.on(IPC.AGENT_ERROR, cb);
    return () => ipcRenderer.removeListener(IPC.AGENT_ERROR, cb);
  },
  onAgentScreenshot: (cb: (_e: unknown, data: string) => void) => {
    ipcRenderer.on(IPC.AGENT_SCREENSHOT, cb);
    return () => ipcRenderer.removeListener(IPC.AGENT_SCREENSHOT, cb);
  },
  onBrowserReady: (cb: (_e: unknown) => void) => {
    ipcRenderer.on(IPC.BROWSER_READY, cb);
    return () => ipcRenderer.removeListener(IPC.BROWSER_READY, cb);
  },
  onBrowserError: (cb: (_e: unknown, data: unknown) => void) => {
    ipcRenderer.on(IPC.BROWSER_ERROR, cb);
    return () => ipcRenderer.removeListener(IPC.BROWSER_ERROR, cb);
  },
  onTabUpdated: (cb: (_e: unknown, data: unknown) => void) => {
    ipcRenderer.on(IPC.TAB_UPDATED, cb);
    return () => ipcRenderer.removeListener(IPC.TAB_UPDATED, cb);
  },
  onNewTabRequest: (cb: (_e: unknown, url: string) => void) => {
    ipcRenderer.on('BROWSER_NEW_TAB_REQUEST', cb);
    return () => ipcRenderer.removeListener('BROWSER_NEW_TAB_REQUEST', cb);
  },
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
});
