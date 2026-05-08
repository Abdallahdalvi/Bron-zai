import fs from 'fs'; import path from 'path'; import os from 'os'; 
const MEMORY_DIR = path.join(os.homedir(), '.browseros', 'memory'); 
const CORE_FILE = path.join(MEMORY_DIR, 'CORE.md'); 
export class CoreMemory { 
  private ensureDir(): void {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    if (!fs.existsSync(CORE_FILE)) fs.writeFileSync(CORE_FILE, '# Core Memory\n\n', 'utf-8');
  } 
  async read(): Promise<string> { this.ensureDir(); return fs.readFileSync(CORE_FILE, 'utf-8'); } 
  async add(fact: string): Promise<void> { this.ensureDir(); fs.appendFileSync(CORE_FILE, `- ${fact}\n`, 'utf-8'); } 
} 
export const coreMemory = new CoreMemory(); 
