import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
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

async function runPythonSkill(
  scriptPath: string,
  name: string,
  bc: any,
  args: any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const jsonArgs = JSON.stringify(args);
    
    const pyProcess = spawn(pythonCmd, [scriptPath, name, jsonArgs]);
    
    let resultData = '';
    let errorData = '';
    let buffer = '';

    pyProcess.stdout.on('data', async (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('__BRON_BROWSER_REQ__:')) {
          try {
            const rawReq = trimmed.slice('__BRON_BROWSER_REQ__:'.length);
            const req = JSON.parse(rawReq);
            let callRes = null;
            const action = req.action;
            const target = req.target;
            const value = req.value;
            
            if (action === 'navigate_page') {
              callRes = await bc.navigatePage(target);
            } else if (action === 'click') {
              callRes = await bc.click(target);
            } else if (action === 'right_click') {
              callRes = await bc.rightClick(target);
            } else if (action === 'fill' || action === 'type') {
              callRes = await bc.fill(target, value);
            } else if (action === 'press_enter') {
              callRes = await bc.pressEnter();
            } else if (action === 'scroll') {
              callRes = await bc.scroll(target);
            } else if (action === 'take_enhanced_snapshot') {
              callRes = await bc.getBrowserState();
            } else if (typeof bc[action] === 'function') {
              callRes = await bc[action](target, value);
            } else {
              callRes = `Error: Unsupported browser action "${action}"`;
            }

            pyProcess.stdin.write(JSON.stringify({ result: callRes }) + '\n');
          } catch (e: any) {
            pyProcess.stdin.write(JSON.stringify({ result: `Error executing controller command: ${e.message}` }) + '\n');
          }
        } else if (trimmed.startsWith('__BRON_PYTHON_RES__:')) {
          resultData = trimmed.slice('__BRON_PYTHON_RES__:'.length);
        } else if (trimmed) {
          console.log(`[Python Skill: ${name}] ${trimmed}`);
        }
      }
    });

    pyProcess.stderr.on('data', (chunk) => {
      errorData += chunk.toString();
    });

    pyProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorData || `Python process exited with code ${code}`));
        return;
      }
      
      if (!resultData) {
        resolve(`Python skill "${name}" executed successfully with no output.`);
        return;
      }

      try {
        const parsed = JSON.parse(resultData);
        if (parsed.status === 'success') {
          resolve(parsed.result);
        } else {
          reject(new Error(parsed.message || 'Unknown Python skill execution error'));
        }
      } catch (e) {
        resolve(resultData);
      }
    });
  });
}

export async function runSkill(
  name: string,
  bc: any,
  args: any
): Promise<any> {
  await ensureLoaded();
  const skill = getRegistry().findSkill(name);
  if (!skill) {
    throw new Error(`Skill "${name}" not found`);
  }
  if (!skill.scriptPath) {
    throw new Error(`Skill "${name}" has no executable script file (index.js or index.py)`);
  }

  if (skill.scriptPath.endsWith('.py')) {
    return await runPythonSkill(skill.scriptPath, name, bc, args);
  }

  try {
    delete require.cache[require.resolve(skill.scriptPath)];
    const scriptFn = require(skill.scriptPath);
    if (typeof scriptFn !== 'function') {
      throw new Error(`Executable script inside skill "${name}" does not export a function.`);
    }
    return await scriptFn(bc, args);
  } catch (err: any) {
    throw new Error(`Error executing skill "${name}": ${err.message}`);
  }
}
