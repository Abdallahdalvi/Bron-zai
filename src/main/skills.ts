import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import * as crypto from 'crypto';
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
    
    // Create WebSocket Server for structured IPC
    const wss = new WebSocketServer({ port: 0 });
    const token = crypto.randomBytes(16).toString('hex');
    let resultData: string | null = null;
    
    wss.on('listening', () => {
      const address = wss.address() as any;
      const port = address.port;
      
      const pyProcess = spawn(pythonCmd, [scriptPath, name, jsonArgs], {
        env: { ...process.env, BRON_WS_PORT: String(port), BRON_WS_TOKEN: token }
      });
      
      let errorData = '';
      pyProcess.stderr.on('data', (chunk) => {
        errorData += chunk.toString();
      });
      
      pyProcess.stdout.on('data', (chunk) => {
        console.log(`[Python Skill: ${name}] ${chunk.toString().trim()}`);
      });
      
      pyProcess.on('close', (code) => {
        // Use setImmediate to allow any pending WS message events to process
        // before we resolve/reject. This prevents the race between the process
        // exiting and the final BRON_PYTHON_RES WebSocket frame arriving.
        setImmediate(() => {
          wss.close();
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
    });

    wss.on('connection', (ws, req) => {
      const url = req.url || '';
      if (!url.includes(`token=${token}`)) {
        ws.close(4001, 'Unauthorized');
        return;
      }
      
      ws.on('message', async (message: any) => {
        try {
          const payload = JSON.parse(message.toString());
          
          if (payload.type === 'BRON_PYTHON_RES') {
            resultData = JSON.stringify(payload.data);
            return;
          }
          
          if (payload.type === 'BRON_BROWSER_REQ') {
            const req = payload.data;
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

            ws.send(JSON.stringify({ id: payload.id, result: callRes }));
          }
        } catch (e: any) {
          ws.send(JSON.stringify({ error: `Error executing controller command: ${e.message}` }));
        }
      });
    });
    
    wss.on('error', (err) => {
      reject(new Error(`WebSocket Server error: ${err.message}`));
      wss.close();
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
