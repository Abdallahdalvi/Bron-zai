import fs from 'fs'; import path from 'path'; import os from 'os'; 
const MEMORY_DIR = path.join(os.homedir(), '.browseros', 'memory'); 
export class DailyMemory { 
  private cleanupInterval: any; 
  constructor() { this.initializeCleanup(); } 
  private getTodayFile(): string { return path.join(MEMORY_DIR, `${new Date().toISOString().split('T')[0]}.md`); } 
  private ensureDir(): void { if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true }); } 
  private initializeCleanup(): void { this.cleanup().catch(console.error); this.cleanupInterval = setInterval(() => this.cleanup().catch(console.error), 24*60*60*1000); } 
  async write(content: string): Promise<void> { this.ensureDir(); fs.appendFileSync(this.getTodayFile(), `## ${new Date().toLocaleTimeString()}\n\n${content}\n\n`, 'utf-8'); } 
  async cleanup(): Promise<void> {
    this.ensureDir();
    const files = fs.readdirSync(MEMORY_DIR);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    files.filter(f => f.endsWith('.md') && f !== 'CORE.md' && f !== 'SOUL.md').forEach(f => {
      try {
        const fileDate = new Date(f.replace('.md', ''));
        if (fileDate < cutoff) fs.unlinkSync(path.join(MEMORY_DIR, f));
      } catch (e) {}
    });
  } 
  destroy(): void { if (this.cleanupInterval) clearInterval(this.cleanupInterval); } 
} 
export const dailyMemory = new DailyMemory(); 
