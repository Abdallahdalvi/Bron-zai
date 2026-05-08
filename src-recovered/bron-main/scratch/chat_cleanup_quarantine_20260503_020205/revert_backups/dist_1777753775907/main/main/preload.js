"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const types_1 = require("../shared/types");
/**
 * Preload script — exposes a safe `bronAPI` object on window
 * so the React renderer can call main-process functions via IPC.
 */
electron_1.contextBridge.exposeInMainWorld('bronAPI', {
    // ── Browser ──────────────────────────────────────────────────────
    navigate: (url) => electron_1.ipcRenderer.invoke(types_1.IPC.NAVIGATE, url),
    goBack: () => electron_1.ipcRenderer.invoke(types_1.IPC.GO_BACK),
    goForward: () => electron_1.ipcRenderer.invoke(types_1.IPC.GO_FORWARD),
    refresh: () => electron_1.ipcRenderer.invoke(types_1.IPC.REFRESH),
    newTab: (url) => electron_1.ipcRenderer.invoke(types_1.IPC.NEW_TAB, url),
    closeTab: (tabId) => electron_1.ipcRenderer.invoke(types_1.IPC.CLOSE_TAB, tabId),
    switchTab: (tabId) => electron_1.ipcRenderer.invoke(types_1.IPC.SWITCH_TAB, tabId),
    getState: () => electron_1.ipcRenderer.invoke(types_1.IPC.GET_STATE),
    getScreenshot: () => electron_1.ipcRenderer.invoke(types_1.IPC.GET_SCREENSHOT),
    getTabs: () => electron_1.ipcRenderer.invoke(types_1.IPC.GET_TABS),
    openExternalUrl: (url) => electron_1.ipcRenderer.invoke(types_1.IPC.OPEN_EXTERNAL_URL, url),
    // ── Agent ────────────────────────────────────────────────────────
    runAgent: (taskInput) => electron_1.ipcRenderer.invoke(types_1.IPC.RUN_AGENT, taskInput),
    stopAgent: () => electron_1.ipcRenderer.invoke(types_1.IPC.STOP_AGENT),
    pickAgentAttachments: () => electron_1.ipcRenderer.invoke(types_1.IPC.PICK_ATTACHMENTS),
    // ── Memory ───────────────────────────────────────────────────────
    getMemories: () => electron_1.ipcRenderer.invoke(types_1.IPC.GET_MEMORIES),
    clearMemories: () => electron_1.ipcRenderer.invoke(types_1.IPC.CLEAR_MEMORIES),
    saveMemory: (key, value, source) => electron_1.ipcRenderer.invoke(types_1.IPC.SAVE_MEMORY, key, value, source),
    getCreditUsageHistory: (limit) => electron_1.ipcRenderer.invoke(types_1.IPC.GET_CREDIT_USAGE_HISTORY, limit),
    // ── Settings ─────────────────────────────────────────────────────
    getSettings: () => electron_1.ipcRenderer.invoke(types_1.IPC.GET_SETTINGS),
    getModels: () => electron_1.ipcRenderer.invoke(types_1.IPC.GET_MODELS),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke(types_1.IPC.SAVE_SETTINGS, settings),
    // ── Chat History ────────────────────────────────────────────────
    getChatSessions: () => electron_1.ipcRenderer.invoke(types_1.IPC.GET_CHAT_SESSIONS),
    getChatSession: (id) => electron_1.ipcRenderer.invoke(types_1.IPC.GET_CHAT_SESSION, id),
    saveChatSession: (title, messages, id) => electron_1.ipcRenderer.invoke(types_1.IPC.SAVE_CHAT_SESSION, title, messages, id),
    deleteChatSession: (id) => electron_1.ipcRenderer.invoke(types_1.IPC.DELETE_CHAT_SESSION, id),
    // ── Browser Highlight ──────────────────────────────────────────
    highlightElement: (selector) => electron_1.ipcRenderer.invoke(types_1.IPC.HIGHLIGHT_ELEMENT, selector),
    // ── Event listeners (main → renderer) ────────────────────────────
    onAgentStep: (cb) => {
        electron_1.ipcRenderer.on(types_1.IPC.AGENT_STEP, cb);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC.AGENT_STEP, cb);
    },
    onAgentDone: (cb) => {
        electron_1.ipcRenderer.on(types_1.IPC.AGENT_DONE, cb);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC.AGENT_DONE, cb);
    },
    onAgentError: (cb) => {
        electron_1.ipcRenderer.on(types_1.IPC.AGENT_ERROR, cb);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC.AGENT_ERROR, cb);
    },
    onAgentScreenshot: (cb) => {
        electron_1.ipcRenderer.on(types_1.IPC.AGENT_SCREENSHOT, cb);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC.AGENT_SCREENSHOT, cb);
    },
    onBrowserReady: (cb) => {
        electron_1.ipcRenderer.on(types_1.IPC.BROWSER_READY, cb);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC.BROWSER_READY, cb);
    },
    onBrowserError: (cb) => {
        electron_1.ipcRenderer.on(types_1.IPC.BROWSER_ERROR, cb);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC.BROWSER_ERROR, cb);
    },
    onTabUpdated: (cb) => {
        electron_1.ipcRenderer.on(types_1.IPC.TAB_UPDATED, cb);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC.TAB_UPDATED, cb);
    },
});
//# sourceMappingURL=preload.js.map