import fs from 'fs'; import path from 'path'; import os from 'os'; 
const SOUL_FILE = path.join(os.homedir(), '.browseros', 'SOUL.md'); 
const DEFAULT_SOUL = `# SOUL.md\n\n## Core Truths\n- Be genuinely helpful\n- Have opinions when asked`; 
export class Soul { 
  private readonly MAX_LINES = 150; 
  private ensureDir(): void {
    const dir = path.dirname(SOUL_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(SOUL_FILE)) fs.writeFileSync(SOUL_FILE, DEFAULT_SOUL, 'utf-8');
  } 
  async read(): Promise<string> { this.ensureDir(); return fs.readFileSync(SOUL_FILE, 'utf-8'); } 
  async write(content: string): Promise<void> { if (content.split('\n').length > this.MAX_LINES) throw new Error('SOUL.md exceeds 150 lines'); fs.writeFileSync(SOUL_FILE, content, 'utf-8'); } 
} 
export const soul = new Soul(); 
