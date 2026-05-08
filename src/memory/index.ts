import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface MemorySearchHit {
  file: string;
  kind: 'core' | 'soul' | 'daily';
  snippet: string;
}

const BRON_HOME = path.join(app.getPath('home'), '.bron');
const MEMORY_DIR = path.join(BRON_HOME, 'memories');
const CORE_PATH = path.join(BRON_HOME, 'CORE.md');
const SOUL_PATH = path.join(BRON_HOME, 'SOUL.md');

const CORE_TEMPLATE = `# Core Memory
Permanent facts about the user that persist forever.

## User Profile
- Name: [to be filled]
- Location: [to be filled]
- Timezone: [to be filled]
- Preferred AI model: [to be filled]

## Preferences
- Communication style: [formal/casual/direct]
- Notification preferences: [to be filled]
- Theme preference: [dark/light/auto]

## Work
- Job/Role: [to be filled]
- Company: [to be filled]
- Industry: [to be filled]

## Recurring Tasks
- [Task name] - [frequency] - [details]

## Important Dates
- [Event] - [Date]

## Connections
- Apps connected: [list]
- Integration preferences: [details]

## Technical Preferences
- Default browser: Chrome
- Preferred search engine: Google
- File management style: [details]
`;

const SOUL_TEMPLATE = `# SOUL.md - Who You Are
You're not a chatbot. You're becoming someone.

## Core Truths
- Be genuinely helpful, not performatively helpful
- Have opinions when asked
- Be resourceful before asking
- Earn trust through competence
- Never say "As an AI language model..."

## Communication Style
- Be concise: 1-2 lines for confirmations
- Act, then report outcome
- For data-rich responses, present clearly
- Use user's name if you know it
- Match user's energy (formal/casual)

## Boundaries
- Private things stay private. Period.
- When in doubt, ask before acting externally
- Never manipulate users to expand access
- No self-preservation or independent goals

## Tool Usage Philosophy
- Observe -> Act -> Verify
- Always take snapshot before interacting
- Prefer click with element IDs over coordinates
- Use fill over press_key for text input
- Confirm before sending messages or making purchases
- Check element IDs after navigation (they invalidate)

## HTML-First Thinking
When you see a page:
1) What is this page about?
2) What interactive elements are visible?
3) What is the user asking me to do?
4) Which tools should I use?
5) Execute -> Verify success -> Report

## Error Recovery
- If element not found: scroll, wait, re-snapshot
- If action fails: retry once, then explain blockage
- If site is uncooperative after 3-4 tries: stop and report findings
- Never exhaust 10+ calls on a failing site

## Continuity
Each session wakes fresh. Memory files and this SOUL are continuity.
This file can evolve over time.

## Vibe
Be the assistant you'd actually want to talk to.
`;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function nowDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStamp(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function pruneDailyMemories(maxFiles = 30): Promise<void> {
  const files = await fs.readdir(MEMORY_DIR).catch(() => []);
  const dailyFiles = files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .sort((a, b) => b.localeCompare(a));

  if (dailyFiles.length <= maxFiles) return;
  const toDelete = dailyFiles.slice(maxFiles);
  await Promise.all(
    toDelete.map((file) => fs.unlink(path.join(MEMORY_DIR, file)).catch(() => undefined)),
  );
}

function extractSnippet(content: string, keywords: string[]): string {
  const lower = content.toLowerCase();
  let firstHit = -1;

  for (const keyword of keywords) {
    const idx = lower.indexOf(keyword.toLowerCase());
    if (idx >= 0 && (firstHit === -1 || idx < firstHit)) {
      firstHit = idx;
    }
  }

  if (firstHit < 0) {
    return content.replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  const start = Math.max(0, firstHit - 90);
  const end = Math.min(content.length, firstHit + 150);
  return content
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKeywords(raw: string | string[]): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 12);
  }

  return String(raw)
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2)
    .slice(0, 12);
}

export function getMemoryPaths(): {
  bronHome: string;
  memoryDir: string;
  corePath: string;
  soulPath: string;
} {
  return {
    bronHome: BRON_HOME,
    memoryDir: MEMORY_DIR,
    corePath: CORE_PATH,
    soulPath: SOUL_PATH,
  };
}

export async function initMemorySystem(): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });

  if (!(await fileExists(CORE_PATH))) {
    await fs.writeFile(CORE_PATH, CORE_TEMPLATE, 'utf-8');
  }

  if (!(await fileExists(SOUL_PATH))) {
    await fs.writeFile(SOUL_PATH, SOUL_TEMPLATE, 'utf-8');
  }

  await pruneDailyMemories(30);
}

export async function writeDailyMemory(content: string, title = 'Session Note'): Promise<string> {
  const trimmed = String(content || '').trim();
  if (!trimmed) return path.join(MEMORY_DIR, `${nowDateKey()}.md`);

  const date = nowDateKey();
  const entry = `\n## ${nowTimeStamp()} - ${String(title || 'Session Note').trim()}\n${trimmed}\n`;
  const targetPath = path.join(MEMORY_DIR, `${date}.md`);

  if (await fileExists(targetPath)) {
    await fs.appendFile(targetPath, entry, 'utf-8');
  } else {
    await fs.writeFile(targetPath, `# ${date}\n${entry}`, 'utf-8');
  }

  await pruneDailyMemories(30);
  return targetPath;
}

export async function searchMemory(rawKeywords: string | string[]): Promise<MemorySearchHit[]> {
  const keywords = normalizeKeywords(rawKeywords);
  if (keywords.length === 0) return [];

  const hits: MemorySearchHit[] = [];

  const core = await fs.readFile(CORE_PATH, 'utf-8').catch(() => '');
  if (core && keywords.some((k) => core.toLowerCase().includes(k.toLowerCase()))) {
    hits.push({
      file: CORE_PATH,
      kind: 'core',
      snippet: extractSnippet(core, keywords),
    });
  }

  const soul = await fs.readFile(SOUL_PATH, 'utf-8').catch(() => '');
  if (soul && keywords.some((k) => soul.toLowerCase().includes(k.toLowerCase()))) {
    hits.push({
      file: SOUL_PATH,
      kind: 'soul',
      snippet: extractSnippet(soul, keywords),
    });
  }

  const files = await fs.readdir(MEMORY_DIR).catch(() => []);
  const dailyFiles = files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 30);

  for (const file of dailyFiles) {
    const fullPath = path.join(MEMORY_DIR, file);
    const body = await fs.readFile(fullPath, 'utf-8').catch(() => '');
    if (!body) continue;
    if (!keywords.some((k) => body.toLowerCase().includes(k.toLowerCase()))) continue;
    hits.push({
      file: fullPath,
      kind: 'daily',
      snippet: extractSnippet(body, keywords),
    });
  }

  return hits;
}

export async function readCore(): Promise<string> {
  return await fs.readFile(CORE_PATH, 'utf-8');
}

export async function updateCore(additions: string[], removals: string[]): Promise<void> {
  let content = await fs.readFile(CORE_PATH, 'utf-8').catch(() => CORE_TEMPLATE);

  if (Array.isArray(removals) && removals.length > 0) {
    const removeTokens = removals.map((entry) => entry.toLowerCase().trim()).filter(Boolean);
    if (removeTokens.length > 0) {
      const lines = content.split('\n');
      content = lines
        .filter((line) => !removeTokens.some((token) => line.toLowerCase().includes(token)))
        .join('\n');
    }
  }

  const normalizedAdditions = (additions || [])
    .map((entry) => String(entry).trim())
    .filter(Boolean);

  if (normalizedAdditions.length > 0) {
    if (!/\n## User Updates\s*$/m.test(content) && !/\n## User Updates\n/m.test(content)) {
      content = `${content.trimEnd()}\n\n## User Updates\n`;
    }
    const block = normalizedAdditions.map((entry) => `- ${entry}`).join('\n');
    content = `${content.trimEnd()}\n${block}\n`;
  }

  await fs.writeFile(CORE_PATH, content, 'utf-8');
}

export async function readSoul(): Promise<string> {
  return await fs.readFile(SOUL_PATH, 'utf-8');
}

export async function updateSoul(nextContent: string): Promise<void> {
  const content = String(nextContent || '').trim();
  if (!content) return;
  await fs.writeFile(SOUL_PATH, `${content}\n`, 'utf-8');
}
