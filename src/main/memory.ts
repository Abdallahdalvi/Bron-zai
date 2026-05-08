import initSqlJs, { Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import {
  Memory,
  Settings,
  DEFAULT_SETTINGS,
  ChatMessage,
  ChatSession,
  CreditUsageRecord,
} from '../shared/types';

let db: Database;
let dbPath: string;

function saveDb(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
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
    maxSteps: effectiveMaxSteps,
    maxRuntimeMinutes: Number.isFinite(parsedRuntime) ? Math.max(0, parsedRuntime) : DEFAULT_SETTINGS.maxRuntimeMinutes,
    browserProfile: map.browserProfile || DEFAULT_SETTINGS.browserProfile,
    domainProfiles: map.domainProfiles || DEFAULT_SETTINGS.domainProfiles,
    theme: (map.theme as any) || DEFAULT_SETTINGS.theme,
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

export function getHistory(limit = 100): Array<{url: string, title: string, visited_at: string}> {
  const res = db.exec('SELECT url, title, visited_at FROM history ORDER BY id DESC LIMIT ?', [limit]);
  if (res.length === 0) return [];
  return res[0].values.map(row => ({
    url: row[0] as string,
    title: row[1] as string,
    visited_at: row[2] as string
  }));
}
