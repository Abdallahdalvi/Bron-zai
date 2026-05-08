"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.getChatSessions = getChatSessions;
exports.getChatSession = getChatSession;
exports.saveChatSession = saveChatSession;
exports.deleteChatSession = deleteChatSession;
exports.getAllMemories = getAllMemories;
exports.addMemory = addMemory;
exports.clearAllMemories = clearAllMemories;
exports.getRelevantMemories = getRelevantMemories;
exports.createTask = createTask;
exports.updateTaskStatus = updateTaskStatus;
exports.addStep = addStep;
exports.addCreditUsage = addCreditUsage;
exports.getCreditUsageHistory = getCreditUsageHistory;
exports.getSettings = getSettings;
exports.saveSettings = saveSettings;
const sql_js_1 = __importDefault(require("sql.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_1 = require("electron");
const types_1 = require("../shared/types");
let db;
let dbPath;
function saveDb() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs_1.default.writeFileSync(dbPath, buffer);
}
/** Initialise SQLite database in the app's userData folder. */
async function initDatabase() {
    const SQL = await (0, sql_js_1.default)();
    dbPath = path_1.default.join(electron_1.app.getPath('userData'), 'bron.db');
    if (fs_1.default.existsSync(dbPath)) {
        const fileBuffer = fs_1.default.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    }
    else {
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
  `);
    // Migration: Add session_id and task_id to memories if they don't exist
    try {
        const tableInfo = db.exec("PRAGMA table_info(memories)");
        if (tableInfo.length > 0) {
            const columns = tableInfo[0].values.map(v => v[1]);
            if (!columns.includes('session_id')) {
                db.run("ALTER TABLE memories ADD COLUMN session_id INTEGER");
            }
            if (!columns.includes('task_id')) {
                db.run("ALTER TABLE memories ADD COLUMN task_id INTEGER");
            }
        }
    }
    catch (e) {
        console.error('Migration failed:', e);
    }
    // Seed default settings if empty
    const res = db.exec('SELECT COUNT(*) as c FROM settings');
    const count = res.length > 0 ? res[0].values[0][0] : 0;
    if (count === 0) {
        for (const [k, v] of Object.entries(types_1.DEFAULT_SETTINGS)) {
            db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, String(v)]);
        }
    }
    saveDb();
    // Auto-save every 30 seconds
    setInterval(saveDb, 30000);
}
// ── Chat Sessions ──────────────────────────────────────────────────────
function getChatSessions() {
    const res = db.exec('SELECT id, title, messages, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 50');
    if (res.length === 0)
        return [];
    return res[0].values.map((row) => ({
        id: row[0],
        title: row[1],
        messages: JSON.parse(row[2]),
        created_at: row[3],
        updated_at: row[4],
    }));
}
function getChatSession(id) {
    const res = db.exec('SELECT id, title, messages, created_at, updated_at FROM chat_sessions WHERE id = ?', [id]);
    if (res.length === 0 || res[0].values.length === 0)
        return null;
    const row = res[0].values[0];
    return {
        id: row[0],
        title: row[1],
        messages: JSON.parse(row[2]),
        created_at: row[3],
        updated_at: row[4],
    };
}
function saveChatSession(title, messages, id) {
    const msgJson = JSON.stringify(messages);
    if (id) {
        db.run("UPDATE chat_sessions SET title = ?, messages = ?, updated_at = datetime('now') WHERE id = ?", [title, msgJson, id]);
        saveDb();
        return id;
    }
    else {
        db.run('INSERT INTO chat_sessions (title, messages) VALUES (?, ?)', [title, msgJson]);
        const res = db.exec('SELECT last_insert_rowid()');
        saveDb();
        return res[0].values[0][0];
    }
}
function deleteChatSession(id) {
    db.run('DELETE FROM chat_sessions WHERE id = ?', [id]);
    saveDb();
}
// ── Memories ───────────────────────────────────────────────────────────
function getAllMemories() {
    const res = db.exec('SELECT id, key, value, source, session_id, task_id, created_at, updated_at FROM memories ORDER BY updated_at DESC');
    if (res.length === 0)
        return [];
    return res[0].values.map((row) => ({
        id: row[0],
        key: row[1],
        value: row[2],
        source: row[3],
        session_id: row[4],
        task_id: row[5],
        created_at: row[6],
        updated_at: row[7],
    }));
}
function addMemory(key, value, source, sessionId, taskId) {
    const existing = db.exec('SELECT id FROM memories WHERE key = ?', [key]);
    if (existing.length > 0 && existing[0].values.length > 0) {
        const id = existing[0].values[0][0];
        db.run("UPDATE memories SET value = ?, source = ?, session_id = ?, task_id = ?, updated_at = datetime('now') WHERE id = ?", [value, source, sessionId || null, taskId || null, id]);
    }
    else {
        db.run('INSERT INTO memories (key, value, source, session_id, task_id) VALUES (?, ?, ?, ?, ?)', [key, value, source, sessionId || null, taskId || null]);
    }
    saveDb();
}
function clearAllMemories() {
    db.run('DELETE FROM memories');
    saveDb();
}
function getRelevantMemories(query, limit = 5) {
    const stopWords = new Set([
        'a', 'an', 'and', 'are', 'be', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or',
        'that', 'the', 'their', 'them', 'then', 'they', 'this', 'to', 'was', 'what', 'when', 'where',
        'who', 'why', 'will', 'with', 'you', 'your',
    ]);
    const words = Array.from(new Set(query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stopWords.has(w)))).slice(0, 10);
    if (words.length === 0)
        return [];
    const relevance = words
        .map(() => "(CASE WHEN LOWER(key) LIKE ? THEN 3 ELSE 0 END + CASE WHEN LOWER(value) LIKE ? THEN 1 ELSE 0 END)")
        .join(' + ');
    const conditions = words.map(() => '(LOWER(key) LIKE ? OR LOWER(value) LIKE ?)').join(' OR ');
    const relevanceParams = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
    const whereParams = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
    const params = [...relevanceParams, ...whereParams, String(limit)];
    const res = db.exec(`
      SELECT id, key, value, source, created_at, updated_at, (${relevance}) AS score
      FROM memories
      WHERE key NOT LIKE 'task_pattern_%'
        AND source <> 'user_feedback'
        AND (${conditions})
      ORDER BY score DESC, updated_at DESC
      LIMIT ?
    `, params);
    if (res.length === 0)
        return [];
    return res[0].values.map((row) => ({
        id: row[0],
        key: row[1],
        value: row[2],
        source: row[3],
        created_at: row[4],
        updated_at: row[5],
    }));
}
// ── Tasks ──────────────────────────────────────────────────────────────
function createTask(task) {
    db.run('INSERT INTO tasks (task) VALUES (?)', [task]);
    const res = db.exec('SELECT last_insert_rowid()');
    saveDb();
    return res[0].values[0][0];
}
function updateTaskStatus(id, status) {
    db.run("UPDATE tasks SET status = ?, ended_at = datetime('now') WHERE id = ?", [status, id]);
    saveDb();
}
// ── Steps ──────────────────────────────────────────────────────────────
function addStep(taskId, stepNumber, action, target, value, result) {
    db.run('INSERT INTO steps (task_id, step_number, action, target, value, result) VALUES (?, ?, ?, ?, ?, ?)', [taskId, stepNumber, action, target, value, result]);
    saveDb();
}
function addCreditUsage(record) {
    const model = String(record.model || '').trim();
    const promptTokens = Number(record.promptTokens || 0);
    const completionTokens = Number(record.completionTokens || 0);
    const totalTokens = Number(record.totalTokens || 0) ||
        Math.max(0, promptTokens) + Math.max(0, completionTokens);
    const cost = Number.isFinite(record.cost) ? Number(record.cost) : 0;
    db.run(`
      INSERT INTO credit_usage (
        task_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
        record.taskId || null,
        record.sessionId || null,
        model,
        Math.max(0, Math.floor(promptTokens)),
        Math.max(0, Math.floor(completionTokens)),
        Math.max(0, Math.floor(totalTokens)),
        Number.isFinite(cost) ? cost : 0,
    ]);
    saveDb();
}
function getCreditUsageHistory(limit = 120) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit || 120)));
    const res = db.exec(`
      SELECT id, task_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, cost, created_at
      FROM credit_usage
      ORDER BY id DESC
      LIMIT ?
    `, [safeLimit]);
    if (res.length === 0)
        return [];
    return res[0].values.map((row) => ({
        id: row[0],
        task_id: row[1],
        session_id: row[2],
        model: row[3] || '',
        prompt_tokens: row[4] || 0,
        completion_tokens: row[5] || 0,
        total_tokens: row[6] || 0,
        cost: Number(row[7] || 0),
        created_at: row[8],
    }));
}
// ── Settings ───────────────────────────────────────────────────────────
function getSettings() {
    const res = db.exec('SELECT key, value FROM settings');
    const map = {};
    if (res.length > 0) {
        for (const row of res[0].values) {
            map[row[0]] = row[1];
        }
    }
    const rawMaxSteps = String(map.maxSteps ?? '').trim();
    const parsedMaxSteps = parseInt(rawMaxSteps, 10);
    const parsedRuntime = parseInt(map.maxRuntimeMinutes, 10);
    const effectiveMaxSteps = rawMaxSteps === '50'
        ? 500
        : Number.isFinite(parsedMaxSteps) && parsedMaxSteps > 0
            ? parsedMaxSteps
            : types_1.DEFAULT_SETTINGS.maxSteps;
    return {
        apiKey: map.apiKey ?? types_1.DEFAULT_SETTINGS.apiKey,
        model: map.model ?? types_1.DEFAULT_SETTINGS.model,
        headless: map.headless === 'true',
        saveMemory: map.saveMemory !== 'false',
        maxSteps: effectiveMaxSteps,
        maxRuntimeMinutes: Number.isFinite(parsedRuntime) ? Math.max(0, parsedRuntime) : types_1.DEFAULT_SETTINGS.maxRuntimeMinutes,
        browserProfile: map.browserProfile || types_1.DEFAULT_SETTINGS.browserProfile,
        domainProfiles: map.domainProfiles || types_1.DEFAULT_SETTINGS.domainProfiles,
    };
}
function saveSettings(settings) {
    for (const [k, v] of Object.entries(settings)) {
        db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, String(v)]);
    }
    saveDb();
}
//# sourceMappingURL=memory.js.map