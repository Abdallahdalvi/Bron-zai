import * as fs from 'fs/promises';
import * as path from 'path';

export interface SkillDefinition {
  name: string;
  description: string;
  triggers: string[];
  tools: string[];
  scriptDir: string;
  sourcePath: string;
}

export class SkillsRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  constructor(private readonly skillsRoot: string) {}

  async loadSkills(): Promise<void> {
    this.skills.clear();

    for (const category of ['builtin', 'custom']) {
      const categoryPath = path.join(this.skillsRoot, category);
      const entries = await fs.readdir(categoryPath, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(categoryPath, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const content = await fs.readFile(skillMdPath, 'utf-8').catch(() => '');
        if (!content.trim()) continue;

        const parsed = this.parseSkillMarkdown(content, skillDir, skillMdPath);
        if (!parsed.name) continue;
        this.skills.set(parsed.name.toLowerCase(), parsed);
      }
    }
  }

  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  findSkill(query: string): SkillDefinition | null {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) return null;

    const exact = this.skills.get(normalized);
    if (exact) return exact;

    for (const skill of this.skills.values()) {
      if (skill.name.toLowerCase() === normalized) return skill;
      if (skill.description.toLowerCase().includes(normalized)) return skill;
      if (skill.triggers.some((trigger) => normalized.includes(trigger.toLowerCase()))) {
        return skill;
      }
    }

    return null;
  }

  private parseSkillMarkdown(content: string, scriptDir: string, sourcePath: string): SkillDefinition {
    const name = this.extractSingleLineSection(content, /^#\s+(.+)$/m) || path.basename(scriptDir);
    const description = this.extractSingleLineSection(
      content,
      /##\s+Description\s*\n([\s\S]*?)(?:\n##\s+|$)/i,
    ).trim();
    const triggers = this.extractBulletSection(content, /##\s+Trigger Phrases\s*\n([\s\S]*?)(?:\n##\s+|$)/i);
    const tools = this.extractBulletSection(content, /##\s+Required Tools\s*\n([\s\S]*?)(?:\n##\s+|$)/i);

    return {
      name,
      description,
      triggers,
      tools,
      scriptDir,
      sourcePath,
    };
  }

  private extractSingleLineSection(content: string, pattern: RegExp): string {
    return content.match(pattern)?.[1]?.trim() || '';
  }

  private extractBulletSection(content: string, pattern: RegExp): string[] {
    const section = content.match(pattern)?.[1] || '';
    return section
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  }
}

export const skillsRegistry = new SkillsRegistry(path.join(__dirname, '..', 'skills'));
