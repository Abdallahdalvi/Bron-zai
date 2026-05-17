import { ipcMain, BrowserWindow, shell, app, session, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { AgentAutomationController } from './agentAutomation';
import { isAgentRunning, runAgent, stopAgent } from './agent';
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
  deleteHistoryEntry,
  deleteHistoryUrl,
  deleteHistoryRange,
  clearHistory,
  getBookmarks,
  createBookmark,
  updateBookmark,
  removeBookmark,
  searchBookmarks,
  getWorkflows,
  getWorkflowById,
  getWorkflowRuns,
  createWorkflowRun,
  updateWorkflowRun,
  saveWorkflow,
  deleteWorkflow,
  getWorkflowSchedules,
  saveWorkflowSchedule,
  deleteWorkflowSchedule,
  getBrowserExtensions,
  saveBrowserExtension,
  deleteBrowserExtension,
  getSavedCredentials,
  saveSavedCredential,
  deleteSavedCredential,
  getAutofillProfiles,
  saveAutofillProfile,
  deleteAutofillProfile,
  getAutofillContextForUrl,
  exportSyncSnapshot,
  importSyncSnapshot,
} from './memory';
import {
  searchMemory as searchMarkdownMemory,
  writeDailyMemory,
  readCore,
  updateCore,
  readSoul,
  updateSoul,
} from '../memory';
import { semanticMemory } from './semanticMemory';
import { getCostStats, resetCostTracking, resetCircuitBreaker } from './costGuard';
import { strataMcp } from './strataMcp';
import { listSkills, findSkill } from './skills';
import { IPC, ChatMessage, AgentRunRequest } from '../shared/types';
import type { BrowserHostCoordinator } from './browserHost';

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

function encryptSyncPayload(passphrase: string, payload: string): Record<string, string | number> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

function decryptSyncPayload(passphrase: string, envelope: any): string {
  const salt = Buffer.from(String(envelope?.salt || ''), 'base64');
  const iv = Buffer.from(String(envelope?.iv || ''), 'base64');
  const tag = Buffer.from(String(envelope?.tag || ''), 'base64');
  const data = Buffer.from(String(envelope?.data || ''), 'base64');
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Register all IPC handlers that the renderer calls via bronAPI.
 */
export function setupIPC(
  getWindow: () => BrowserWindow | null,
  browserController: AgentAutomationController,
  runtimeHooks?: {
    installExtension?: (record: ReturnType<typeof saveBrowserExtension>) => Promise<ReturnType<typeof saveBrowserExtension>>;
    removeExtension?: (record: ReturnType<typeof saveBrowserExtension>) => Promise<void>;
    browserHost?: BrowserHostCoordinator;
  },
): void {
  // ── Browser ──────────────────────────────────────────────────────
  const browser = browserController;

  ipcMain.handle(IPC.NAVIGATE, async (_e, url: string) => {
    await browser!.navigate(url);
    return await browser!.getTabs();
  });

  ipcMain.handle(IPC.GO_BACK, async () => {
    await browser!.goBack();
  });

  ipcMain.handle(IPC.GO_FORWARD, async () => {
    await browser!.goForward();
  });

  ipcMain.handle(IPC.REFRESH, async () => {
    await browser!.refresh();
  });

  ipcMain.handle(IPC.NEW_TAB, async (_e, url?: string) => {
    return await browser!.newTab(url);
  });

  ipcMain.handle(IPC.CLOSE_TAB, async (_e, tabId: string) => {
    await browser!.closeTab(tabId);
    return await browser!.getTabs();
  });

  ipcMain.handle(IPC.SWITCH_TAB, async (_e, tabId: string) => {
    await browser!.switchTab(tabId);
    return await browser!.getTabs();
  });

  ipcMain.handle(IPC.GET_STATE, async () => {
    return await browser!.getBrowserState();
  });

  ipcMain.handle(IPC.GET_SCREENSHOT, async () => {
    return await browser!.getScreenshot();
  });

  ipcMain.handle(IPC.GET_TABS, async () => {
    return await browser!.getTabs();
  });

  ipcMain.handle(IPC.SET_BROWSER_VIEWPORT, async (event, viewport: any) => {
    if (!runtimeHooks?.browserHost) {
      return { applied: false };
    }
    return runtimeHooks.browserHost.setViewport(event.sender.id, viewport);
  });

  ipcMain.handle(IPC.ADJUST_BROWSER_ZOOM, async (_event, delta: number) => {
    return await browser.adjustZoom(delta);
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
    // The runtime uses the live visible browser controller for both agent and UI coordination.
    runAgent(taskInput, browserController, getWindow).catch((err) => {
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
  
  ipcMain.handle(IPC.GET_HISTORY, async (_e, limit?: number) => {
    return getHistory(limit);
  });

  ipcMain.handle(IPC.ADD_HISTORY_ENTRY, async (_e, url: string, title: string) => {
    addHistoryEntry(url, title);
  });

  ipcMain.handle(IPC.DELETE_HISTORY_ENTRY, async (_e, id: number) => {
    deleteHistoryEntry(id);
    return { deleted: true };
  });

  ipcMain.handle(IPC.DELETE_HISTORY_URL, async (_e, url: string) => {
    deleteHistoryUrl(url);
    return { deleted: true };
  });

  ipcMain.handle(IPC.DELETE_HISTORY_RANGE, async (_e, start?: string, end?: string) => {
    deleteHistoryRange(start, end);
    return { deleted: true };
  });

  ipcMain.handle(IPC.CLEAR_HISTORY, async () => {
    clearHistory();
    return { cleared: true };
  });

  ipcMain.handle(IPC.GET_BOOKMARKS, async () => {
    return getBookmarks();
  });

  ipcMain.handle(IPC.CREATE_BOOKMARK, async (_e, bookmark: Record<string, unknown>) => {
    return createBookmark(bookmark as any);
  });

  ipcMain.handle(IPC.UPDATE_BOOKMARK, async (_e, id: number, updates: Record<string, unknown>) => {
    return updateBookmark(id, updates as any);
  });

  ipcMain.handle(IPC.REMOVE_BOOKMARK, async (_e, id: number) => {
    removeBookmark(id);
    return { deleted: true };
  });

  ipcMain.handle(IPC.SEARCH_BOOKMARKS, async (_e, query: string) => {
    return searchBookmarks(query);
  });

  // ── Semantic Memory (Vector Search) ──────────────────────────────

  ipcMain.handle('semantic-memory:search', async (_e, query: string, limit?: number) => {
    return await semanticMemory.hybridSearch(query, { limit: limit || 5 });
  });

  ipcMain.handle('semantic-memory:add', async (_e, content: string, metadata: any) => {
    const result = await semanticMemory.addMemory(content, metadata);
    return { success: !!result, id: result?.id };
  });

  ipcMain.handle('semantic-memory:stats', async () => {
    return semanticMemory.getStats();
  });

  // ── Cost Guard ───────────────────────────────────────────────────

  ipcMain.handle('cost-guard:stats', async () => {
    return getCostStats();
  });

  ipcMain.handle('cost-guard:reset', async () => {
    resetCostTracking();
    return { reset: true };
  });

  ipcMain.handle('cost-guard:reset-circuit', async () => {
    resetCircuitBreaker();
    return { reset: true };
  });

  // ── Strata MCP Integration ───────────────────────────────────────

  ipcMain.handle('strata:list-apps', async () => {
    return strataMcp.listAvailableApps();
  });

  ipcMain.handle('strata:get-connections', async () => {
    return strataMcp.getAllConnections();
  });

  ipcMain.handle('strata:connect', async (_e, appName: string, apiKey: string) => {
    return strataMcp.connect(appName, { apiKey });
  });

  ipcMain.handle('strata:disconnect', async (_e, appName: string) => {
    await strataMcp.disconnect(appName);
    return { disconnected: true };
  });

  ipcMain.handle('strata:discover', async (_e, appName: string) => {
    return strataMcp.discoverTools(appName);
  });

  ipcMain.handle('strata:execute', async (_e, appName: string, action: string, params: Record<string, unknown>) => {
    return strataMcp.executeAction(appName, action, params);
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
    await browser!.highlightElement(selector);
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
    saveSettings(settings as Record<string, string>);
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
    const knownPartitions = ['persist:bron-session'];
    const profilesDir = path.join(app.getPath('userData'), 'profiles');
    if (fs.existsSync(profilesDir)) {
      try {
        const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          knownPartitions.push(`persist:bron-profile-${entry.name}`);
        }
      } catch {
        // Ignore profile enumeration errors.
      }
    }

    await session.defaultSession.clearStorageData();
    for (const partition of knownPartitions) {
      await session.fromPartition(partition).clearStorageData().catch(() => {});
      await session.fromPartition(partition).clearCache().catch(() => {});
    }
    clearHistory();
    return { cleared: true };
  });

  ipcMain.handle(IPC.OPEN_DOWNLOADS, async () => {
    shell.openPath(app.getPath('downloads'));
  });

  ipcMain.handle(IPC.OPEN_HISTORY, async () => {
    const win = getWindow();
    win?.webContents.send(IPC.SHOW_HISTORY_PANEL);
    return { opened: true };
  });

  ipcMain.handle(IPC.GET_WORKFLOWS, async () => {
    return getWorkflows();
  });

  ipcMain.handle(IPC.SAVE_WORKFLOW, async (_e, workflow: Record<string, unknown>) => {
    return saveWorkflow(workflow as any);
  });

  ipcMain.handle(IPC.DELETE_WORKFLOW, async (_e, id: number) => {
    deleteWorkflow(id);
    return { deleted: true };
  });

  ipcMain.handle(IPC.RUN_WORKFLOW_NOW, async (_e, id: number) => {
    const workflow = getWorkflowById(Number(id));
    if (!workflow || !workflow.task_prompt.trim()) {
      return { started: false, reason: 'Workflow not found or empty.' };
    }
    if (isAgentRunning()) {
      return { started: false, reason: 'Agent is already running.' };
    }
    const workflowRunId = createWorkflowRun({
      workflow_id: workflow.id,
      origin: 'manual',
      task_snapshot: workflow.task_prompt,
    });
    void runAgent(
      {
        task: workflow.task_prompt,
        contextMessages: [
          `Manual workflow run: ${workflow.title}`,
          workflow.notes ? `Workflow notes: ${workflow.notes}` : '',
        ].filter(Boolean),
        workflowId: workflow.id,
        workflowRunId,
        workflowOrigin: 'manual',
      },
      browserController,
      getWindow,
    );
    return { started: true };
  });

  ipcMain.handle(IPC.GET_WORKFLOW_RUNS, async (_e, workflowId?: number) => {
    return getWorkflowRuns(workflowId);
  });

  ipcMain.handle(IPC.GET_WORKFLOW_SCHEDULES, async (_e, workflowId?: number) => {
    return getWorkflowSchedules(workflowId);
  });

  ipcMain.handle(IPC.SAVE_WORKFLOW_SCHEDULE, async (_e, schedule: Record<string, unknown>) => {
    return saveWorkflowSchedule(schedule as any);
  });

  ipcMain.handle(IPC.DELETE_WORKFLOW_SCHEDULE, async (_e, id: number) => {
    deleteWorkflowSchedule(id);
    return { deleted: true };
  });

  ipcMain.handle(IPC.PICK_EXTENSION_DIRECTORY, async () => {
    const parent = getWindow() || undefined;
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.GET_BROWSER_EXTENSIONS, async () => {
    return getBrowserExtensions();
  });

  ipcMain.handle(IPC.SAVE_BROWSER_EXTENSION, async (_e, extension: Record<string, unknown>) => {
    let record = saveBrowserExtension(extension as any);
    if (record.enabled && runtimeHooks?.installExtension) {
      record = await runtimeHooks.installExtension(record);
    } else if (!record.enabled && runtimeHooks?.removeExtension) {
      await runtimeHooks.removeExtension(record as any);
    }
    return record;
  });

  ipcMain.handle(IPC.DELETE_BROWSER_EXTENSION, async (_e, id: number) => {
    const record = getBrowserExtensions().find((entry) => entry.id === id);
    if (record && runtimeHooks?.removeExtension) {
      await runtimeHooks.removeExtension(record as any);
    }
    deleteBrowserExtension(id);
    return { deleted: true };
  });

  ipcMain.handle(IPC.GET_SAVED_CREDENTIALS, async () => {
    return getSavedCredentials();
  });

  ipcMain.handle(IPC.SAVE_SAVED_CREDENTIAL, async (_e, credential: Record<string, unknown>) => {
    return saveSavedCredential(credential as any);
  });

  ipcMain.handle(IPC.DELETE_SAVED_CREDENTIAL, async (_e, id: number) => {
    deleteSavedCredential(id);
    return { deleted: true };
  });

  ipcMain.handle(IPC.GET_AUTOFILL_PROFILES, async () => {
    return getAutofillProfiles();
  });

  ipcMain.handle(IPC.SAVE_AUTOFILL_PROFILE, async (_e, profile: Record<string, unknown>) => {
    return saveAutofillProfile(profile as any);
  });

  ipcMain.handle(IPC.DELETE_AUTOFILL_PROFILE, async (_e, id: number) => {
    deleteAutofillProfile(id);
    return { deleted: true };
  });

  ipcMain.handle(IPC.GET_AUTOFILL_CONTEXT, async (_e, url: string) => {
    return getAutofillContextForUrl(url);
  });

  ipcMain.handle(IPC.EXPORT_SYNC_BUNDLE, async () => {
    const settings = getSettings();
    const passphrase = String(settings.syncPassphrase || '').trim();
    if (!passphrase) {
      return { saved: false, reason: 'Add a sync passphrase in Settings first.' };
    }
    const parent = getWindow() || undefined;
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          defaultPath: settings.syncBundlePath || path.join(app.getPath('documents'), 'bron-sync.bronsync'),
          filters: [{ name: 'Bron Sync Bundle', extensions: ['bronsync'] }],
        })
      : await dialog.showSaveDialog({
          defaultPath: settings.syncBundlePath || path.join(app.getPath('documents'), 'bron-sync.bronsync'),
          filters: [{ name: 'Bron Sync Bundle', extensions: ['bronsync'] }],
        });
    if (result.canceled || !result.filePath) {
      return { saved: false, reason: 'Export canceled.' };
    }
    const payload = exportSyncSnapshot();
    const envelope = encryptSyncPayload(passphrase, JSON.stringify(payload));
    fs.writeFileSync(result.filePath, JSON.stringify({
      accountName: settings.syncAccountName || 'Local Browser',
      exportedAt: new Date().toISOString(),
      ...envelope,
    }, null, 2), 'utf8');
    saveSettings({ syncBundlePath: result.filePath } as any);
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle(IPC.IMPORT_SYNC_BUNDLE, async () => {
    const settings = getSettings();
    const passphrase = String(settings.syncPassphrase || '').trim();
    if (!passphrase) {
      return { imported: false, reason: 'Add the matching sync passphrase in Settings first.' };
    }
    const parent = getWindow() || undefined;
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          properties: ['openFile'],
          filters: [{ name: 'Bron Sync Bundle', extensions: ['bronsync'] }],
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Bron Sync Bundle', extensions: ['bronsync'] }],
        });
    if (result.canceled || result.filePaths.length === 0) {
      return { imported: false, reason: 'Import canceled.' };
    }
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const envelope = JSON.parse(raw || '{}');
    const decoded = decryptSyncPayload(passphrase, envelope);
    importSyncSnapshot(JSON.parse(decoded || '{}'));
    saveSettings({ syncBundlePath: result.filePaths[0] } as any);
    return { imported: true };
  });
}
