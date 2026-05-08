"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupIPC = setupIPC;
const electron_1 = require("electron");
const agent_1 = require("./agent");
const attachments_1 = require("./attachments");
const openrouter_1 = require("./openrouter");
const memory_1 = require("./memory");
const types_1 = require("../shared/types");
function parseDomainProfileMap(raw) {
    if (typeof raw !== 'string')
        return {};
    const text = raw.trim();
    if (!text)
        return {};
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        const map = {};
        for (const [domain, profile] of Object.entries(parsed)) {
            const d = domain.trim().toLowerCase();
            const p = String(profile || '').trim();
            if (!d || !p)
                continue;
            map[d] = p;
        }
        return map;
    }
    catch {
        return {};
    }
}
/**
 * Register all IPC handlers that the renderer calls via bronAPI.
 */
function setupIPC(getWindow, browserController, agentController) {
    // ── Browser ──────────────────────────────────────────────────────
    electron_1.ipcMain.handle(types_1.IPC.NAVIGATE, async (_e, url) => {
        await browserController.navigate(url);
        return await browserController.getTabs();
    });
    electron_1.ipcMain.handle(types_1.IPC.GO_BACK, async () => {
        await browserController.goBack();
    });
    electron_1.ipcMain.handle(types_1.IPC.GO_FORWARD, async () => {
        await browserController.goForward();
    });
    electron_1.ipcMain.handle(types_1.IPC.REFRESH, async () => {
        await browserController.refresh();
    });
    electron_1.ipcMain.handle(types_1.IPC.NEW_TAB, async (_e, url) => {
        return await browserController.newTab(url);
    });
    electron_1.ipcMain.handle(types_1.IPC.CLOSE_TAB, async (_e, tabId) => {
        await browserController.closeTab(tabId);
        return await browserController.getTabs();
    });
    electron_1.ipcMain.handle(types_1.IPC.SWITCH_TAB, async (_e, tabId) => {
        await browserController.switchTab(tabId);
        return await browserController.getTabs();
    });
    electron_1.ipcMain.handle(types_1.IPC.GET_STATE, async () => {
        return await browserController.getBrowserState();
    });
    electron_1.ipcMain.handle(types_1.IPC.GET_SCREENSHOT, async () => {
        return await browserController.getScreenshot();
    });
    electron_1.ipcMain.handle(types_1.IPC.GET_TABS, async () => {
        return await browserController.getTabs();
    });
    electron_1.ipcMain.handle(types_1.IPC.OPEN_EXTERNAL_URL, async (_e, rawUrl) => {
        const url = String(rawUrl || '').trim();
        if (!url)
            return { opened: false, reason: 'Empty URL' };
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            return { opened: false, reason: 'Invalid URL' };
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { opened: false, reason: 'Unsupported URL protocol' };
        }
        await electron_1.shell.openExternal(parsed.toString());
        return { opened: true };
    });
    // ── Agent ────────────────────────────────────────────────────────
    electron_1.ipcMain.handle(types_1.IPC.RUN_AGENT, async (_e, taskInput) => {
        // Run in background — don't await (the renderer listens for events)
        (0, agent_1.runAgent)(taskInput, agentController || browserController, getWindow).catch((err) => {
            const win = getWindow();
            win?.webContents.send(types_1.IPC.AGENT_ERROR, String(err));
        });
        return { started: true };
    });
    electron_1.ipcMain.handle(types_1.IPC.STOP_AGENT, async () => {
        (0, agent_1.stopAgent)();
        return { stopped: true };
    });
    electron_1.ipcMain.handle(types_1.IPC.PICK_ATTACHMENTS, async () => {
        return await (0, attachments_1.pickAndPrepareAgentAttachments)(getWindow());
    });
    // ── Memory ───────────────────────────────────────────────────────
    electron_1.ipcMain.handle(types_1.IPC.GET_MEMORIES, async () => {
        return (0, memory_1.getAllMemories)();
    });
    electron_1.ipcMain.handle(types_1.IPC.SAVE_MEMORY, async (_e, key, value, source) => {
        (0, memory_1.addMemory)(key, value, source);
        return { saved: true };
    });
    electron_1.ipcMain.handle(types_1.IPC.GET_CREDIT_USAGE_HISTORY, async (_e, limit) => {
        return (0, memory_1.getCreditUsageHistory)(limit);
    });
    electron_1.ipcMain.handle(types_1.IPC.CLEAR_MEMORIES, async () => {
        (0, memory_1.clearAllMemories)();
        return { cleared: true };
    });
    // ── Chat History ─────────────────────────────────────────────────
    electron_1.ipcMain.handle(types_1.IPC.GET_CHAT_SESSIONS, async () => {
        return (0, memory_1.getChatSessions)();
    });
    electron_1.ipcMain.handle(types_1.IPC.GET_CHAT_SESSION, async (_e, id) => {
        return (0, memory_1.getChatSession)(id);
    });
    electron_1.ipcMain.handle(types_1.IPC.SAVE_CHAT_SESSION, async (_e, title, messages, id) => {
        return (0, memory_1.saveChatSession)(title, messages, id);
    });
    electron_1.ipcMain.handle(types_1.IPC.DELETE_CHAT_SESSION, async (_e, id) => {
        (0, memory_1.deleteChatSession)(id);
        return { deleted: true };
    });
    // ── Browser Highlight ────────────────────────────────────────────
    electron_1.ipcMain.handle(types_1.IPC.HIGHLIGHT_ELEMENT, async (_e, selector) => {
        await browserController.highlightElement(selector);
        return { highlighted: true };
    });
    // ── Settings ─────────────────────────────────────────────────────
    electron_1.ipcMain.handle(types_1.IPC.GET_SETTINGS, async () => {
        return (0, memory_1.getSettings)();
    });
    electron_1.ipcMain.handle(types_1.IPC.GET_MODELS, async () => {
        const settings = (0, memory_1.getSettings)();
        const models = await (0, openrouter_1.fetchOpenRouterModels)(settings.apiKey, 60);
        return models;
    });
    electron_1.ipcMain.handle(types_1.IPC.SAVE_SETTINGS, async (_e, settings) => {
        (0, memory_1.saveSettings)(settings);
        // Apply runtime settings
        if ('headless' in settings) {
            browserController.setHeadless(settings.headless);
        }
        if (typeof settings.browserProfile === 'string') {
            await browserController.setProfile(settings.browserProfile);
        }
        if ('domainProfiles' in settings) {
            browserController.setDomainProfileMap(parseDomainProfileMap(settings.domainProfiles));
        }
        return { saved: true };
    });
}
//# sourceMappingURL=ipc.js.map