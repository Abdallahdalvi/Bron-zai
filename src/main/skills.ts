import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { SkillsRegistry, type SkillDefinition } from '../skills/registry';

let registry: SkillsRegistry | null = null;
let loaded = false;

function resolveSkillsRoot(): string {
  const candidates = [
    path.join(app.getAppPath(), 'src', 'skills'),
    path.join(process.cwd(), 'src', 'skills'),
    path.join(app.getAppPath(), 'skills'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

function getRegistry(): SkillsRegistry {
  if (!registry) {
    registry = new SkillsRegistry(resolveSkillsRoot());
  }
  return registry;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  await getRegistry().loadSkills();
  loaded = true;
}

export async function reloadSkills(): Promise<void> {
  await getRegistry().loadSkills();
  loaded = true;
}

export async function listSkills(): Promise<SkillDefinition[]> {
  await ensureLoaded();
  return getRegistry().getAllSkills();
}

export async function findSkill(query: string): Promise<SkillDefinition | null> {
  await ensureLoaded();
  return getRegistry().findSkill(query);
}
