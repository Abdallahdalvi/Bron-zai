import initSqlJs, { Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { app, safeStorage } from 'electron';
import {
  Memory,
  Settings,
  DEFAULT_SETTINGS,
  ChatMessage,
  ChatSession,
  CreditUsageRecord,
  BookmarkEntry,
  HistoryEntry,
  WorkflowRecord,
  WorkflowScheduleRecord,
  WorkflowRunRecord,
  BrowserExtensionRecord,
  SavedCredentialRecord,
  AutofillProfileRecord,
} from '../shared/types';

let db: Database;
let dbPath: string;

function saveDb(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function encryptSecret(value: string): string {
  const text = String(value || '');
  if (!text) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(text).toString('base64')}`;
    }
  } catch {
    // Fall through to local-only obfuscation.
  }
  return `plain:${Buffer.from(text, 'utf8').toString('base64')}`;
}

function decryptSecret(value: string): string {
  const text = String(value || '');
  if (!text) return '';
  try {
    if (text.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
      const payload = Buffer.from(text.slice(4), 'base64');
      return safeStorage.decryptString(payload);
    }
    if (text.startsWith('plain:')) {
      return Buffer.from(text.slice(6), 'base64').toString('utf8');
    }
  } catch {
    return '';
  }
  return '';
}

/** Initialise SQLite database in the app's userData folder. */
export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();
  dbPath = path.join(app.getPath('userData'), 'bron.db');

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key        TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      source     TEXT    NOT NULL DEFAULT '',
      session_id INTEGER,
      task_id    INTEGER,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task       TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'running',
      started_at TEXT    NOT NULL DEFAULT (datetime('now')),
      ended_at   TEXT
    );
    CREATE TABLE IF NOT EXISTS steps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL,
      step_number INTEGER NOT NULL,
      action      TEXT    NOT NULL,
      target      TEXT    NOT NULL DEFAULT '',
      value       TEXT    NOT NULL DEFAULT '',
      result      TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL DEFAULT 'New Chat',
      messages   TEXT    NOT NULL DEFAULT '[]',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workflows (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      task_prompt TEXT    NOT NULL DEFAULT '',
      notes       TEXT    NOT NULL DEFAULT '',
      last_run_at TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workflow_schedules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      rrule       TEXT    NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_run_at TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id    INTEGER NOT NULL,
      origin         TEXT    NOT NULL DEFAULT 'manual',
      status         TEXT    NOT NULL DEFAULT 'running',
      task_snapshot  TEXT    NOT NULL DEFAULT '',
      result_summary TEXT    NOT NULL DEFAULT '',
      step_count     INTEGER NOT NULL DEFAULT 0,
      error_message  TEXT    NOT NULL DEFAULT '',
      started_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      ended_at       TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS browser_extensions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL DEFAULT '',
      source_path TEXT    NOT NULL UNIQUE,
      extension_id TEXT   NOT NULL DEFAULT '',
      version     TEXT    NOT NULL DEFAULT '',
      enabled     INTEGER NOT NULL DEFAULT 1,
      last_error  TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS saved_credentials (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      domain             TEXT    NOT NULL,
      username           TEXT    NOT NULL DEFAULT '',
      password_encrypted TEXT    NOT NULL DEFAULT '',
      notes              TEXT    NOT NULL DEFAULT '',
      last_used_at       TEXT,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS autofill_profiles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      label         TEXT    NOT NULL DEFAULT 'Default',
      full_name     TEXT    NOT NULL DEFAULT '',
      email         TEXT    NOT NULL DEFAULT '',
      phone         TEXT    NOT NULL DEFAULT '',
      company       TEXT    NOT NULL DEFAULT '',
      address_line1 TEXT    NOT NULL DEFAULT '',
      address_line2 TEXT    NOT NULL DEFAULT '',
      city          TEXT    NOT NULL DEFAULT '',
      state         TEXT    NOT NULL DEFAULT '',
      postal_code   TEXT    NOT NULL DEFAULT '',
      country       TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS credit_usage (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id            INTEGER,
      session_id         INTEGER,
      model              TEXT    NOT NULL DEFAULT '',
      prompt_tokens      INTEGER NOT NULL DEFAULT 0,
      completion_tokens  INTEGER NOT NULL DEFAULT 0,
      total_tokens       INTEGER NOT NULL DEFAULT 0,
      cost               REAL    NOT NULL DEFAULT 0,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      url        TEXT    NOT NULL,
      title      TEXT    NOT NULL DEFAULT '',
      visited_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL DEFAULT '',
      url        TEXT    NOT NULL,
      folder     TEXT    NOT NULL DEFAULT 'Bookmarks',
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: Add session_id and task_id to memories if they don't exist
  try {
    const tableInfo = db.exec("PRAGMA table_info(memories)");
    if (tableInfo.length > 0) {
      const columns = tableInfo[0].values.map(v => v[1] as string);
      if (!columns.includes('session_id')) {
        db.run("ALTER TABLE memories ADD COLUMN session_id INTEGER");
      }
      if (!columns.includes('task_id')) {
        db.run("ALTER TABLE memories ADD COLUMN task_id INTEGER");
      }
    }
  } catch (e) {
    console.error('Migration failed:', e);
  }

  // Seed default settings if empty
  const res = db.exec('SELECT COUNT(*) as c FROM settings');
  const count = res.length > 0 ? (res[0].values[0][0] as number) : 0;
  if (count === 0) {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, String(v)]);
    }
  }

  saveDb();

  // Auto-save every 30 seconds
  setInterval(saveDb, 30000);
}

// ── Chat Sessions ──────────────────────────────────────────────────────

export function getChatSessions(): ChatSession[] {
  const res = db.exec('SELECT id, title, messages, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 50');
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    title: row[1] as string,
    messages: JSON.parse(row[2] as string) as ChatMessage[],
    created_at: row[3] as string,
    updated_at: row[4] as string,
  }));
}

export function getChatSession(id: number): ChatSession | null {
  const res = db.exec('SELECT id, title, messages, created_at, updated_at FROM chat_sessions WHERE id = ?', [id]);
  if (res.length === 0 || res[0].values.length === 0) return null;
  const row = res[0].values[0];
  return {
    id: row[0] as number,
    title: row[1] as string,
    messages: JSON.parse(row[2] as string) as ChatMessage[],
    created_at: row[3] as string,
    updated_at: row[4] as string,
  };
}

export function saveChatSession(title: string, messages: ChatMessage[], id?: number): number {
  const msgJson = JSON.stringify(messages);
  if (id) {
    db.run("UPDATE chat_sessions SET title = ?, messages = ?, updated_at = datetime('now') WHERE id = ?", [title, msgJson, id]);
    saveDb();
    return id;
  } else {
    db.run('INSERT INTO chat_sessions (title, messages) VALUES (?, ?)', [title, msgJson]);
    const res = db.exec('SELECT last_insert_rowid()');
    saveDb();
    return res[0].values[0][0] as number;
  }
}

export function deleteChatSession(id: number): void {
  db.run('DELETE FROM chat_sessions WHERE id = ?', [id]);
  saveDb();
}

export function getWorkflows(): WorkflowRecord[] {
  const res = db.exec(`
    SELECT id, title, task_prompt, notes, created_at, updated_at, last_run_at
    FROM workflows
    ORDER BY updated_at DESC, id DESC
  `);
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    title: row[1] as string,
    task_prompt: row[2] as string,
    notes: row[3] as string,
    created_at: row[4] as string,
    updated_at: row[5] as string,
    last_run_at: (row[6] as string) || undefined,
  }));
}

export function getWorkflowById(id: number): WorkflowRecord | null {
  const res = db.exec(
    'SELECT id, title, task_prompt, notes, created_at, updated_at, last_run_at FROM workflows WHERE id = ?',
    [id],
  );
  if (res.length === 0 || res[0].values.length === 0) return null;
  const row = res[0].values[0];
  return {
    id: row[0] as number,
    title: row[1] as string,
    task_prompt: row[2] as string,
    notes: row[3] as string,
    created_at: row[4] as string,
    updated_at: row[5] as string,
    last_run_at: (row[6] as string) || undefined,
  };
}

export function saveWorkflow(workflow: Partial<WorkflowRecord>): number {
  const title = String(workflow.title || '').trim() || 'Untitled Workflow';
  const taskPrompt = String(workflow.task_prompt || '').trim();
  const notes = String(workflow.notes || '').trim();
  const id = Number(workflow.id || 0);

  if (id > 0) {
    db.run(
      "UPDATE workflows SET title = ?, task_prompt = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
      [title, taskPrompt, notes, id],
    );
    saveDb();
    return id;
  }

  db.run(
    'INSERT INTO workflows (title, task_prompt, notes) VALUES (?, ?, ?)',
    [title, taskPrompt, notes],
  );
  const res = db.exec('SELECT last_insert_rowid()');
  saveDb();
  return res[0].values[0][0] as number;
}

export function getWorkflowRuns(workflowId?: number): WorkflowRunRecord[] {
  const params: Array<number> = [];
  const where = workflowId ? 'WHERE workflow_id = ?' : '';
  if (workflowId) params.push(workflowId);
  const res = db.exec(
    `
    SELECT id, workflow_id, origin, status, task_snapshot, result_summary, step_count, error_message, started_at, ended_at
    FROM workflow_runs
    ${where}
    ORDER BY id DESC
    LIMIT 200
  `,
    params,
  );
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    workflow_id: row[1] as number,
    origin: (row[2] as WorkflowRunRecord['origin']) || 'manual',
    status: (row[3] as WorkflowRunRecord['status']) || 'running',
    task_snapshot: row[4] as string,
    result_summary: row[5] as string,
    step_count: Number(row[6] || 0),
    error_message: (row[7] as string) || undefined,
    started_at: row[8] as string,
    ended_at: (row[9] as string) || undefined,
  }));
}

export function createWorkflowRun(input: {
  workflow_id: number;
  origin?: WorkflowRunRecord['origin'];
  task_snapshot?: string;
}): number {
  const workflowId = Number(input.workflow_id || 0);
  if (!(workflowId > 0)) throw new Error('workflow_id is required');
  db.run(
    `INSERT INTO workflow_runs (workflow_id, origin, status, task_snapshot)
     VALUES (?, ?, 'running', ?)`,
    [workflowId, String(input.origin || 'manual'), String(input.task_snapshot || '')],
  );
  saveDb();
  const res = db.exec('SELECT last_insert_rowid()');
  return Number(res[0].values[0][0] || 0);
}

export function updateWorkflowRun(
  id: number,
  updates: Partial<Pick<WorkflowRunRecord, 'status' | 'result_summary' | 'step_count' | 'error_message' | 'ended_at'>>,
): void {
  if (!(Number(id) > 0)) return;
  const current = db.exec(
    'SELECT status, result_summary, step_count, error_message, ended_at FROM workflow_runs WHERE id = ?',
    [id],
  );
  if (current.length === 0 || current[0].values.length === 0) return;
  const row = current[0].values[0];
  db.run(
    `UPDATE workflow_runs
     SET status = ?, result_summary = ?, step_count = ?, error_message = ?, ended_at = ?
     WHERE id = ?`,
    [
      String(updates.status || row[0] || 'running'),
      String(updates.result_summary ?? row[1] ?? ''),
      Number.isFinite(Number(updates.step_count)) ? Number(updates.step_count) : Number(row[2] || 0),
      String(updates.error_message ?? row[3] ?? ''),
      updates.ended_at ?? row[4] ?? null,
      id,
    ],
  );
  saveDb();
}

export function markWorkflowRun(workflowId: number, runAtIso: string): void {
  db.run(
    "UPDATE workflows SET last_run_at = ?, updated_at = datetime('now') WHERE id = ?",
    [runAtIso, workflowId],
  );
  saveDb();
}

export function deleteWorkflow(id: number): void {
  db.run('DELETE FROM workflow_schedules WHERE workflow_id = ?', [id]);
  db.run('DELETE FROM workflows WHERE id = ?', [id]);
  saveDb();
}

export function getWorkflowSchedules(workflowId?: number): WorkflowScheduleRecord[] {
  const params: Array<number> = [];
  const where = workflowId ? 'WHERE workflow_id = ?' : '';
  if (workflowId) params.push(workflowId);
  const res = db.exec(`
    SELECT id, workflow_id, rrule, enabled, next_run_at, last_run_at, created_at, updated_at
    FROM workflow_schedules
    ${where}
    ORDER BY updated_at DESC, id DESC
  `, params);
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    workflow_id: row[1] as number,
    rrule: row[2] as string,
    enabled: Number(row[3]) === 1,
    next_run_at: (row[4] as string) || undefined,
    last_run_at: (row[5] as string) || undefined,
    created_at: row[6] as string,
    updated_at: row[7] as string,
  }));
}

export function saveWorkflowSchedule(schedule: Partial<WorkflowScheduleRecord>): number {
  const workflowId = Number(schedule.workflow_id || 0);
  if (!(workflowId > 0)) {
    throw new Error('workflow_id is required');
  }
  const rrule = String(schedule.rrule || '').trim();
  if (!rrule) {
    throw new Error('rrule is required');
  }
  const enabled = schedule.enabled === false ? 0 : 1;
  const nextRunAt = schedule.next_run_at || null;
  const lastRunAt = schedule.last_run_at || null;
  const id = Number(schedule.id || 0);

  if (id > 0) {
    db.run(
      `UPDATE workflow_schedules
       SET workflow_id = ?, rrule = ?, enabled = ?, next_run_at = ?, last_run_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [workflowId, rrule, enabled, nextRunAt, lastRunAt, id],
    );
    saveDb();
    return id;
  }

  db.run(
    'INSERT INTO workflow_schedules (workflow_id, rrule, enabled, next_run_at, last_run_at) VALUES (?, ?, ?, ?, ?)',
    [workflowId, rrule, enabled, nextRunAt, lastRunAt],
  );
  const res = db.exec('SELECT last_insert_rowid()');
  saveDb();
  return res[0].values[0][0] as number;
}

export function updateWorkflowScheduleRunState(
  id: number,
  updates: { next_run_at?: string | null; last_run_at?: string | null; enabled?: boolean },
): void {
  const existing = db.exec(
    'SELECT next_run_at, last_run_at, enabled FROM workflow_schedules WHERE id = ?',
    [id],
  );
  if (existing.length === 0 || existing[0].values.length === 0) return;
  const row = existing[0].values[0];
  const nextRunAt = Object.prototype.hasOwnProperty.call(updates, 'next_run_at')
    ? (updates.next_run_at ?? null)
    : (row[0] as string | null);
  const lastRunAt = Object.prototype.hasOwnProperty.call(updates, 'last_run_at')
    ? (updates.last_run_at ?? null)
    : (row[1] as string | null);
  const enabled = typeof updates.enabled === 'boolean'
    ? (updates.enabled ? 1 : 0)
    : Number(row[2] || 0);
  db.run(
    `UPDATE workflow_schedules
     SET next_run_at = ?, last_run_at = ?, enabled = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [nextRunAt, lastRunAt, enabled, id],
  );
  saveDb();
}

export function deleteWorkflowSchedule(id: number): void {
  db.run('DELETE FROM workflow_schedules WHERE id = ?', [id]);
  saveDb();
}

export function getBrowserExtensions(): BrowserExtensionRecord[] {
  const res = db.exec(`
    SELECT id, name, source_path, extension_id, version, enabled, last_error, created_at, updated_at
    FROM browser_extensions
    ORDER BY updated_at DESC, id DESC
  `);
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    name: row[1] as string,
    source_path: row[2] as string,
    extension_id: row[3] as string,
    version: row[4] as string,
    enabled: Number(row[5]) === 1,
    last_error: (row[6] as string) || undefined,
    created_at: row[7] as string,
    updated_at: row[8] as string,
  }));
}

export function saveBrowserExtension(extension: Partial<BrowserExtensionRecord> & { source_path: string }): BrowserExtensionRecord {
  const sourcePath = String(extension.source_path || '').trim();
  if (!sourcePath) {
    throw new Error('source_path is required');
  }
  const name = String(extension.name || path.basename(sourcePath)).trim();
  const extensionId = String(extension.extension_id || '').trim();
  const version = String(extension.version || '').trim();
  const enabled = extension.enabled === false ? 0 : 1;
  const lastError = String(extension.last_error || '').trim();
  const id = Number(extension.id || 0);

  if (id > 0) {
    db.run(
      `UPDATE browser_extensions
       SET name = ?, source_path = ?, extension_id = ?, version = ?, enabled = ?, last_error = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [name, sourcePath, extensionId, version, enabled, lastError, id],
    );
  } else {
    db.run(
      `INSERT INTO browser_extensions (name, source_path, extension_id, version, enabled, last_error)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_path) DO UPDATE SET
         name = excluded.name,
         extension_id = excluded.extension_id,
         version = excluded.version,
         enabled = excluded.enabled,
         last_error = excluded.last_error,
         updated_at = datetime('now')`,
      [name, sourcePath, extensionId, version, enabled, lastError],
    );
  }

  saveDb();
  const match = db.exec(
    'SELECT id, name, source_path, extension_id, version, enabled, last_error, created_at, updated_at FROM browser_extensions WHERE source_path = ?',
    [sourcePath],
  );
  const row = match[0].values[0];
  return {
    id: row[0] as number,
    name: row[1] as string,
    source_path: row[2] as string,
    extension_id: row[3] as string,
    version: row[4] as string,
    enabled: Number(row[5]) === 1,
    last_error: (row[6] as string) || undefined,
    created_at: row[7] as string,
    updated_at: row[8] as string,
  };
}

export function deleteBrowserExtension(id: number): void {
  db.run('DELETE FROM browser_extensions WHERE id = ?', [id]);
  saveDb();
}

export function getSavedCredentials(): SavedCredentialRecord[] {
  const res = db.exec(`
    SELECT id, domain, username, notes, password_encrypted, created_at, updated_at, last_used_at
    FROM saved_credentials
    ORDER BY updated_at DESC, id DESC
  `);
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    domain: row[1] as string,
    username: row[2] as string,
    notes: row[3] as string,
    has_password: String(row[4] || '').length > 0,
    created_at: row[5] as string,
    updated_at: row[6] as string,
    last_used_at: (row[7] as string) || undefined,
  }));
}

export function saveSavedCredential(input: Partial<SavedCredentialRecord> & { domain: string; username?: string; password?: string; notes?: string }): SavedCredentialRecord {
  const domain = String(input.domain || '').trim();
  if (!domain) {
    throw new Error('domain is required');
  }
  const username = String(input.username || '').trim();
  const notes = String(input.notes || '').trim();
  let id = Number(input.id || 0);

  if (!(id > 0)) {
    const existing = db.exec(
      'SELECT id FROM saved_credentials WHERE lower(domain) = lower(?) AND lower(username) = lower(?) ORDER BY id DESC LIMIT 1',
      [domain, username],
    );
    if (existing.length > 0 && existing[0].values.length > 0) {
      id = Number(existing[0].values[0][0] || 0);
    }
  }

  if (id > 0) {
    const existing = db.exec('SELECT password_encrypted FROM saved_credentials WHERE id = ?', [id]);
    const existingPassword = existing.length > 0 && existing[0].values.length > 0
      ? String(existing[0].values[0][0] || '')
      : '';
    const nextPassword = Object.prototype.hasOwnProperty.call(input, 'password')
      ? encryptSecret(String((input as any).password || ''))
      : existingPassword;
    db.run(
      `UPDATE saved_credentials
       SET domain = ?, username = ?, password_encrypted = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [domain, username, nextPassword, notes, id],
    );
  } else {
    db.run(
      `INSERT INTO saved_credentials (domain, username, password_encrypted, notes)
       VALUES (?, ?, ?, ?)`,
      [domain, username, encryptSecret(String((input as any).password || '')), notes],
    );
  }

  saveDb();
  const query = id > 0
    ? db.exec('SELECT id, domain, username, notes, password_encrypted, created_at, updated_at, last_used_at FROM saved_credentials WHERE id = ?', [id])
    : db.exec('SELECT id, domain, username, notes, password_encrypted, created_at, updated_at, last_used_at FROM saved_credentials ORDER BY id DESC LIMIT 1');
  const row = query[0].values[0];
  return {
    id: row[0] as number,
    domain: row[1] as string,
    username: row[2] as string,
    notes: row[3] as string,
    has_password: String(row[4] || '').length > 0,
    created_at: row[5] as string,
    updated_at: row[6] as string,
    last_used_at: (row[7] as string) || undefined,
  };
}

export function deleteSavedCredential(id: number): void {
  db.run('DELETE FROM saved_credentials WHERE id = ?', [id]);
  saveDb();
}

export function touchSavedCredential(id: number): void {
  if (!(Number(id) > 0)) return;
  db.run(
    "UPDATE saved_credentials SET last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  saveDb();
}

export function getAutofillProfiles(): AutofillProfileRecord[] {
  const res = db.exec(`
    SELECT id, label, full_name, email, phone, company, address_line1, address_line2, city, state, postal_code, country, created_at, updated_at
    FROM autofill_profiles
    ORDER BY updated_at DESC, id DESC
  `);
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    label: row[1] as string,
    full_name: row[2] as string,
    email: row[3] as string,
    phone: row[4] as string,
    company: row[5] as string,
    address_line1: row[6] as string,
    address_line2: row[7] as string,
    city: row[8] as string,
    state: row[9] as string,
    postal_code: row[10] as string,
    country: row[11] as string,
    created_at: row[12] as string,
    updated_at: row[13] as string,
  }));
}

export function saveAutofillProfile(profile: Partial<AutofillProfileRecord> & { label: string }): AutofillProfileRecord {
  const label = String(profile.label || '').trim() || 'Default';
  const fullName = String(profile.full_name || '').trim();
  const email = String(profile.email || '').trim();
  const phone = String(profile.phone || '').trim();
  const company = String(profile.company || '').trim();
  const address1 = String(profile.address_line1 || '').trim();
  const address2 = String(profile.address_line2 || '').trim();
  const city = String(profile.city || '').trim();
  const state = String(profile.state || '').trim();
  const postal = String(profile.postal_code || '').trim();
  const country = String(profile.country || '').trim();
  const id = Number(profile.id || 0);

  if (id > 0) {
    db.run(
      `UPDATE autofill_profiles
       SET label = ?, full_name = ?, email = ?, phone = ?, company = ?, address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?, country = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [label, fullName, email, phone, company, address1, address2, city, state, postal, country, id],
    );
    saveDb();
    const query = db.exec(
      'SELECT id, label, full_name, email, phone, company, address_line1, address_line2, city, state, postal_code, country, created_at, updated_at FROM autofill_profiles WHERE id = ?',
      [id],
    );
    const row = query[0].values[0];
    return {
      id: row[0] as number,
      label: row[1] as string,
      full_name: row[2] as string,
      email: row[3] as string,
      phone: row[4] as string,
      company: row[5] as string,
      address_line1: row[6] as string,
      address_line2: row[7] as string,
      city: row[8] as string,
      state: row[9] as string,
      postal_code: row[10] as string,
      country: row[11] as string,
      created_at: row[12] as string,
      updated_at: row[13] as string,
    };
  }

  db.run(
    `INSERT INTO autofill_profiles (label, full_name, email, phone, company, address_line1, address_line2, city, state, postal_code, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [label, fullName, email, phone, company, address1, address2, city, state, postal, country],
  );
  saveDb();
  const query = db.exec(
    'SELECT id, label, full_name, email, phone, company, address_line1, address_line2, city, state, postal_code, country, created_at, updated_at FROM autofill_profiles ORDER BY id DESC LIMIT 1',
  );
  const row = query[0].values[0];
  return {
    id: row[0] as number,
    label: row[1] as string,
    full_name: row[2] as string,
    email: row[3] as string,
    phone: row[4] as string,
    company: row[5] as string,
    address_line1: row[6] as string,
    address_line2: row[7] as string,
    city: row[8] as string,
    state: row[9] as string,
    postal_code: row[10] as string,
    country: row[11] as string,
    created_at: row[12] as string,
    updated_at: row[13] as string,
  };
}

export function deleteAutofillProfile(id: number): void {
  db.run('DELETE FROM autofill_profiles WHERE id = ?', [id]);
  saveDb();
}

export function getAutofillContextForUrl(rawUrl: string): {
  credential?: { domain: string; username: string; password: string };
  profile?: AutofillProfileRecord;
} {
  let host = '';
  try {
    host = new URL(String(rawUrl || '').trim()).hostname.toLowerCase();
  } catch {
    host = '';
  }

  const credentials = getSavedCredentials();
  const matchingCredential = host
    ? credentials.find((entry) => {
        const domain = String(entry.domain || '').trim().toLowerCase();
        return domain && (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(host));
      })
    : undefined;

  let password = '';
  if (matchingCredential) {
    const res = db.exec(
      'SELECT password_encrypted FROM saved_credentials WHERE id = ?',
      [matchingCredential.id],
    );
    if (res.length > 0 && res[0].values.length > 0) {
      password = decryptSecret(String(res[0].values[0][0] || ''));
    }
  }

  const profile = getAutofillProfiles()[0];
  return {
    credential: matchingCredential
      ? {
          domain: matchingCredential.domain,
          username: matchingCredential.username,
          password,
        }
      : undefined,
    profile: profile || undefined,
  };
}

export function exportSyncSnapshot(): Record<string, unknown> {
  const credentials = getSavedCredentials().map((entry) => {
    const res = db.exec(
      'SELECT password_encrypted FROM saved_credentials WHERE id = ?',
      [entry.id],
    );
    const encrypted = res.length > 0 && res[0].values.length > 0
      ? String(res[0].values[0][0] || '')
      : '';
    return {
      domain: entry.domain,
      username: entry.username,
      password: decryptSecret(encrypted),
      notes: entry.notes,
      last_used_at: entry.last_used_at || null,
    };
  });

  const settings = getSettings();
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    settings: {
      agentFullAccess: settings.agentFullAccess,
      agentToolHints: settings.agentToolHints,
      autoSaveSignIns: settings.autoSaveSignIns,
      workflowSchedulerEnabled: settings.workflowSchedulerEnabled,
      browserProfile: settings.browserProfile,
      domainProfiles: settings.domainProfiles,
      theme: settings.theme,
      syncAccountName: settings.syncAccountName,
    },
    bookmarks: getBookmarks(),
    workflows: getWorkflows(),
    workflow_schedules: getWorkflowSchedules(),
    workflow_runs: getWorkflowRuns(),
    extensions: getBrowserExtensions(),
    saved_credentials: credentials,
    autofill_profiles: getAutofillProfiles(),
    history: getHistory(500),
  };
}

export function importSyncSnapshot(snapshot: any): void {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid sync snapshot.');
  }

  const settingsBlock = snapshot.settings && typeof snapshot.settings === 'object'
    ? snapshot.settings
    : {};
  saveSettings({
    agentFullAccess: (settingsBlock as any).agentFullAccess,
    agentToolHints: (settingsBlock as any).agentToolHints,
    autoSaveSignIns: (settingsBlock as any).autoSaveSignIns,
    workflowSchedulerEnabled: (settingsBlock as any).workflowSchedulerEnabled,
    browserProfile: (settingsBlock as any).browserProfile,
    domainProfiles: (settingsBlock as any).domainProfiles,
    theme: (settingsBlock as any).theme,
    syncAccountName: (settingsBlock as any).syncAccountName,
  } as Partial<Settings>);

  db.run('DELETE FROM bookmarks');
  for (const entry of Array.isArray(snapshot.bookmarks) ? snapshot.bookmarks : []) {
    db.run(
      `INSERT INTO bookmarks (title, url, folder, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(entry?.title || ''),
        String(entry?.url || ''),
        String(entry?.folder || 'Bookmarks'),
        Number(entry?.position || 0),
        String(entry?.created_at || new Date().toISOString()),
        String(entry?.updated_at || new Date().toISOString()),
      ],
    );
  }

  db.run('DELETE FROM workflow_runs');
  db.run('DELETE FROM workflow_schedules');
  db.run('DELETE FROM workflows');
  for (const workflow of Array.isArray(snapshot.workflows) ? snapshot.workflows : []) {
    db.run(
      `INSERT INTO workflows (id, title, task_prompt, notes, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(workflow?.id || 0) || null,
        String(workflow?.title || ''),
        String(workflow?.task_prompt || ''),
        String(workflow?.notes || ''),
        workflow?.last_run_at ? String(workflow.last_run_at) : null,
        String(workflow?.created_at || new Date().toISOString()),
        String(workflow?.updated_at || new Date().toISOString()),
      ],
    );
  }
  for (const schedule of Array.isArray(snapshot.workflow_schedules) ? snapshot.workflow_schedules : []) {
    db.run(
      `INSERT INTO workflow_schedules (id, workflow_id, rrule, enabled, next_run_at, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(schedule?.id || 0) || null,
        Number(schedule?.workflow_id || 0),
        String(schedule?.rrule || ''),
        schedule?.enabled === false ? 0 : 1,
        schedule?.next_run_at ? String(schedule.next_run_at) : null,
        schedule?.last_run_at ? String(schedule.last_run_at) : null,
        String(schedule?.created_at || new Date().toISOString()),
        String(schedule?.updated_at || new Date().toISOString()),
      ],
    );
  }
  for (const run of Array.isArray(snapshot.workflow_runs) ? snapshot.workflow_runs : []) {
    db.run(
      `INSERT INTO workflow_runs (id, workflow_id, origin, status, task_snapshot, result_summary, step_count, error_message, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(run?.id || 0) || null,
        Number(run?.workflow_id || 0),
        String(run?.origin || 'manual'),
        String(run?.status || 'completed'),
        String(run?.task_snapshot || ''),
        String(run?.result_summary || ''),
        Number(run?.step_count || 0),
        String(run?.error_message || ''),
        String(run?.started_at || new Date().toISOString()),
        run?.ended_at ? String(run.ended_at) : null,
      ],
    );
  }

  db.run('DELETE FROM saved_credentials');
  for (const entry of Array.isArray(snapshot.saved_credentials) ? snapshot.saved_credentials : []) {
    db.run(
      `INSERT INTO saved_credentials (domain, username, password_encrypted, notes, last_used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        String(entry?.domain || ''),
        String(entry?.username || ''),
        encryptSecret(String(entry?.password || '')),
        String(entry?.notes || ''),
        entry?.last_used_at ? String(entry.last_used_at) : null,
      ],
    );
  }

  db.run('DELETE FROM autofill_profiles');
  for (const profile of Array.isArray(snapshot.autofill_profiles) ? snapshot.autofill_profiles : []) {
    db.run(
      `INSERT INTO autofill_profiles (label, full_name, email, phone, company, address_line1, address_line2, city, state, postal_code, country, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(profile?.label || 'Default'),
        String(profile?.full_name || ''),
        String(profile?.email || ''),
        String(profile?.phone || ''),
        String(profile?.company || ''),
        String(profile?.address_line1 || ''),
        String(profile?.address_line2 || ''),
        String(profile?.city || ''),
        String(profile?.state || ''),
        String(profile?.postal_code || ''),
        String(profile?.country || ''),
        String(profile?.created_at || new Date().toISOString()),
        String(profile?.updated_at || new Date().toISOString()),
      ],
    );
  }

  db.run('DELETE FROM browser_extensions');
  for (const extension of Array.isArray(snapshot.extensions) ? snapshot.extensions : []) {
    db.run(
      `INSERT INTO browser_extensions (name, source_path, extension_id, version, enabled, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(extension?.name || ''),
        String(extension?.source_path || ''),
        String(extension?.extension_id || ''),
        String(extension?.version || ''),
        extension?.enabled === false ? 0 : 1,
        String(extension?.last_error || ''),
        String(extension?.created_at || new Date().toISOString()),
        String(extension?.updated_at || new Date().toISOString()),
      ],
    );
  }

  db.run('DELETE FROM history');
  for (const entry of Array.isArray(snapshot.history) ? snapshot.history : []) {
    db.run(
      `INSERT INTO history (url, title, visited_at)
       VALUES (?, ?, ?)`,
      [
        String(entry?.url || ''),
        String(entry?.title || ''),
        String(entry?.visited_at || new Date().toISOString()),
      ],
    );
  }

  saveDb();
}

// ── Memories ───────────────────────────────────────────────────────────

export function getAllMemories(): Memory[] {
  const res = db.exec('SELECT id, key, value, source, session_id, task_id, created_at, updated_at FROM memories ORDER BY updated_at DESC');
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    key: row[1] as string,
    value: row[2] as string,
    source: row[3] as string,
    session_id: row[4] as number,
    task_id: row[5] as number,
    created_at: row[6] as string,
    updated_at: row[7] as string,
  }));
}

export function addMemory(key: string, value: string, source: string, sessionId?: number, taskId?: number): void {
  const existing = db.exec('SELECT id FROM memories WHERE key = ?', [key]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    const id = existing[0].values[0][0];
    db.run("UPDATE memories SET value = ?, source = ?, session_id = ?, task_id = ?, updated_at = datetime('now') WHERE id = ?", [value, source, sessionId || null, taskId || null, id]);
  } else {
    db.run('INSERT INTO memories (key, value, source, session_id, task_id) VALUES (?, ?, ?, ?, ?)', [key, value, source, sessionId || null, taskId || null]);
  }
  saveDb();
}

export function clearAllMemories(): void {
  db.run('DELETE FROM memories');
  saveDb();
}

export function getRelevantMemories(query: string, limit = 5): Memory[] {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'be', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or',
    'that', 'the', 'their', 'them', 'then', 'they', 'this', 'to', 'was', 'what', 'when', 'where',
    'who', 'why', 'will', 'with', 'you', 'your',
  ]);

  const words = Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stopWords.has(w)),
    ),
  ).slice(0, 10);
  if (words.length === 0) return [];

  const relevance = words
    .map(() => "(CASE WHEN LOWER(key) LIKE ? THEN 3 ELSE 0 END + CASE WHEN LOWER(value) LIKE ? THEN 1 ELSE 0 END)")
    .join(' + ');
  const conditions = words.map(() => '(LOWER(key) LIKE ? OR LOWER(value) LIKE ?)').join(' OR ');
  const relevanceParams: string[] = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
  const whereParams: string[] = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
  const params: string[] = [...relevanceParams, ...whereParams, String(limit)];

  const res = db.exec(
    `
      SELECT id, key, value, source, created_at, updated_at, (${relevance}) AS score
      FROM memories
      WHERE key NOT LIKE 'task_pattern_%'
        AND source <> 'user_feedback'
        AND (${conditions})
      ORDER BY score DESC, updated_at DESC
      LIMIT ?
    `,
    params,
  );
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    key: row[1] as string,
    value: row[2] as string,
    source: row[3] as string,
    created_at: row[4] as string,
    updated_at: row[5] as string,
  }));
}

// ── Tasks ──────────────────────────────────────────────────────────────

export function createTask(task: string): number {
  db.run('INSERT INTO tasks (task) VALUES (?)', [task]);
  const res = db.exec('SELECT last_insert_rowid()');
  saveDb();
  return res[0].values[0][0] as number;
}

export function updateTaskStatus(id: number, status: string): void {
  db.run("UPDATE tasks SET status = ?, ended_at = datetime('now') WHERE id = ?", [status, id]);
  saveDb();
}

// ── Steps ──────────────────────────────────────────────────────────────

export function addStep(
  taskId: number,
  stepNumber: number,
  action: string,
  target: string,
  value: string,
  result: string,
): void {
  db.run(
    'INSERT INTO steps (task_id, step_number, action, target, value, result) VALUES (?, ?, ?, ?, ?, ?)',
    [taskId, stepNumber, action, target, value, result],
  );
  saveDb();
}

export function addCreditUsage(record: {
  taskId?: number;
  sessionId?: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
}): void {
  const model = String(record.model || '').trim();
  const promptTokens = Number(record.promptTokens || 0);
  const completionTokens = Number(record.completionTokens || 0);
  const totalTokens =
    Number(record.totalTokens || 0) ||
    Math.max(0, promptTokens) + Math.max(0, completionTokens);
  const cost = Number.isFinite(record.cost as number) ? Number(record.cost) : 0;

  db.run(
    `
      INSERT INTO credit_usage (
        task_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      record.taskId || null,
      record.sessionId || null,
      model,
      Math.max(0, Math.floor(promptTokens)),
      Math.max(0, Math.floor(completionTokens)),
      Math.max(0, Math.floor(totalTokens)),
      Number.isFinite(cost) ? cost : 0,
    ],
  );
  saveDb();
}

export function getCreditUsageHistory(limit = 120): CreditUsageRecord[] {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 120)));
  const res = db.exec(
    `
      SELECT id, task_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, cost, created_at
      FROM credit_usage
      ORDER BY id DESC
      LIMIT ?
    `,
    [safeLimit],
  );
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    task_id: row[1] as number,
    session_id: row[2] as number,
    model: (row[3] as string) || '',
    prompt_tokens: (row[4] as number) || 0,
    completion_tokens: (row[5] as number) || 0,
    total_tokens: (row[6] as number) || 0,
    cost: Number(row[7] || 0),
    created_at: row[8] as string,
  }));
}

// ── Settings ───────────────────────────────────────────────────────────

export function getSettings(): Settings {
  const res = db.exec('SELECT key, value FROM settings');
  const map: Record<string, string> = {};
  if (res.length > 0) {
    for (const row of res[0].values) {
      map[row[0] as string] = row[1] as string;
    }
  }

  const rawMaxSteps = String(map.maxSteps ?? '').trim();
  const parsedMaxSteps = parseInt(rawMaxSteps, 10);
  const parsedRuntime = parseInt(map.maxRuntimeMinutes, 10);
  const effectiveMaxSteps =
    rawMaxSteps === '50'
      ? 500
      : Number.isFinite(parsedMaxSteps) && parsedMaxSteps > 0
        ? parsedMaxSteps
        : DEFAULT_SETTINGS.maxSteps;

  return {
    apiKey: map.apiKey ?? DEFAULT_SETTINGS.apiKey,
    model: map.model ?? DEFAULT_SETTINGS.model,
    headless: map.headless === 'true',
    saveMemory: map.saveMemory !== 'false',
    agentFullAccess: map.agentFullAccess !== 'false',
    agentToolHints: map.agentToolHints !== 'false',
    agentPromptEnhancement: map.agentPromptEnhancement !== 'false',
    autoSaveSignIns: map.autoSaveSignIns !== 'false',
    workflowSchedulerEnabled: map.workflowSchedulerEnabled !== 'false',
    syncAccountName: map.syncAccountName ?? DEFAULT_SETTINGS.syncAccountName,
    syncPassphrase: map.syncPassphrase ?? DEFAULT_SETTINGS.syncPassphrase,
    syncBundlePath: map.syncBundlePath ?? DEFAULT_SETTINGS.syncBundlePath,
    maxSteps: effectiveMaxSteps,
    maxRuntimeMinutes: Number.isFinite(parsedRuntime) ? Math.max(0, parsedRuntime) : DEFAULT_SETTINGS.maxRuntimeMinutes,
    browserProfile: map.browserProfile || DEFAULT_SETTINGS.browserProfile,
    domainProfiles: map.domainProfiles || DEFAULT_SETTINGS.domainProfiles,
    theme: (map.theme as any) || DEFAULT_SETTINGS.theme,
    
    // Cost Guard settings
    costGuardMaxCostPerTask: Number(map.costGuardMaxCostPerTask ?? DEFAULT_SETTINGS.costGuardMaxCostPerTask),
    costGuardMaxCostPerDay: Number(map.costGuardMaxCostPerDay ?? DEFAULT_SETTINGS.costGuardMaxCostPerDay),
    costGuardMaxRequestsPerMinute: Number(map.costGuardMaxRequestsPerMinute ?? DEFAULT_SETTINGS.costGuardMaxRequestsPerMinute),
    costGuardMaxConsecutiveErrors: Number(map.costGuardMaxConsecutiveErrors ?? DEFAULT_SETTINGS.costGuardMaxConsecutiveErrors),
    costGuardCooldownMs: Number(map.costGuardCooldownMs ?? DEFAULT_SETTINGS.costGuardCooldownMs),
    
    // Semantic memory settings
    embeddingProvider: (map.embeddingProvider as any) || DEFAULT_SETTINGS.embeddingProvider,
    openaiApiKey: map.openaiApiKey ?? DEFAULT_SETTINGS.openaiApiKey,
    strataConnections: map.strataConnections ?? DEFAULT_SETTINGS.strataConnections,
  };
}

export function saveSettings(settings: Partial<Settings>): void {
  for (const [k, v] of Object.entries(settings)) {
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [k, String(v)],
    );
  }
  saveDb();
}
// ── History ────────────────────────────────────────────────────────────

export function addHistoryEntry(url: string, title: string): void {
  if (!url || url.startsWith('about:') || url.startsWith('data:')) return;
  db.run('INSERT INTO history (url, title) VALUES (?, ?)', [url, title]);
  saveDb();
}

export function getHistory(limit = 100): HistoryEntry[] {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
  const res = db.exec('SELECT id, url, title, visited_at FROM history ORDER BY id DESC LIMIT ?', [safeLimit]);
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    url: row[1] as string,
    title: row[2] as string,
    visited_at: row[3] as string,
  }));
}

export function deleteHistoryEntry(id: number): void {
  db.run('DELETE FROM history WHERE id = ?', [id]);
  saveDb();
}

export function deleteHistoryUrl(url: string): void {
  db.run('DELETE FROM history WHERE url = ?', [url]);
  saveDb();
}

export function deleteHistoryRange(start?: string, end?: string): void {
  const startText = String(start || '').trim();
  const endText = String(end || '').trim();

  if (startText && endText) {
    db.run('DELETE FROM history WHERE visited_at BETWEEN ? AND ?', [startText, endText]);
  } else if (startText) {
    db.run('DELETE FROM history WHERE visited_at >= ?', [startText]);
  } else if (endText) {
    db.run('DELETE FROM history WHERE visited_at <= ?', [endText]);
  } else {
    db.run('DELETE FROM history');
  }
  saveDb();
}

export function clearHistory(): void {
  db.run('DELETE FROM history');
  saveDb();
}

export function getBookmarks(): BookmarkEntry[] {
  const res = db.exec(
    `
      SELECT id, title, url, folder, position, created_at, updated_at
      FROM bookmarks
      ORDER BY LOWER(folder) ASC, position ASC, id ASC
    `,
  );
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    title: row[1] as string,
    url: row[2] as string,
    folder: row[3] as string,
    position: row[4] as number,
    created_at: row[5] as string,
    updated_at: row[6] as string,
  }));
}

export function createBookmark(bookmark: Partial<BookmarkEntry> & { url: string }): BookmarkEntry {
  const url = String(bookmark.url || '').trim();
  if (!url) {
    throw new Error('Bookmark URL is required');
  }

  const title = String(bookmark.title || url).trim() || url;
  const folder = String(bookmark.folder || 'Bookmarks').trim() || 'Bookmarks';
  const explicitPosition = Number(bookmark.position);
  let position = Number.isFinite(explicitPosition) ? explicitPosition : -1;

  if (position < 0) {
    const res = db.exec('SELECT COALESCE(MAX(position), -1) FROM bookmarks WHERE folder = ?', [folder]);
    const maxPosition = res.length > 0 ? Number(res[0].values[0][0] || -1) : -1;
    position = maxPosition + 1;
  }

  db.run(
    'INSERT INTO bookmarks (title, url, folder, position) VALUES (?, ?, ?, ?)',
    [title, url, folder, position],
  );
  const res = db.exec('SELECT last_insert_rowid()');
  saveDb();
  const id = res[0].values[0][0] as number;
  return getBookmarks().find((entry) => entry.id === id)!;
}

export function updateBookmark(
  id: number,
  updates: Partial<BookmarkEntry>,
): BookmarkEntry | null {
  const existing = getBookmarks().find((entry) => entry.id === id);
  if (!existing) return null;

  const nextTitle = String(updates.title ?? existing.title).trim() || existing.url;
  const nextUrl = String(updates.url ?? existing.url).trim() || existing.url;
  const nextFolder = String(updates.folder ?? existing.folder).trim() || 'Bookmarks';
  const nextPosition = Number.isFinite(Number(updates.position))
    ? Number(updates.position)
    : existing.position;

  db.run(
    `
      UPDATE bookmarks
      SET title = ?, url = ?, folder = ?, position = ?, updated_at = datetime('now')
      WHERE id = ?
    `,
    [nextTitle, nextUrl, nextFolder, nextPosition, id],
  );
  saveDb();
  return getBookmarks().find((entry) => entry.id === id) || null;
}

export function removeBookmark(id: number): void {
  db.run('DELETE FROM bookmarks WHERE id = ?', [id]);
  saveDb();
}

export function searchBookmarks(query: string): BookmarkEntry[] {
  const needle = `%${String(query || '').trim().toLowerCase()}%`;
  if (needle === '%%') return getBookmarks();
  const res = db.exec(
    `
      SELECT id, title, url, folder, position, created_at, updated_at
      FROM bookmarks
      WHERE LOWER(title) LIKE ? OR LOWER(url) LIKE ? OR LOWER(folder) LIKE ?
      ORDER BY LOWER(folder) ASC, position ASC, id ASC
    `,
    [needle, needle, needle],
  );
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    id: row[0] as number,
    title: row[1] as string,
    url: row[2] as string,
    folder: row[3] as string,
    position: row[4] as number,
    created_at: row[5] as string,
    updated_at: row[6] as string,
  }));
}
