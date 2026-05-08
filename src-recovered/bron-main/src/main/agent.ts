import { BrowserWindow } from 'electron';
import type { AgentAutomationController } from './automationController';
import { callOpenRouter, ChatTurn, enhancePrompt } from './openrouter';
import { validateAction } from './safety';
import { addMemory, createTask, updateTaskStatus, addStep, getSettings, addCreditUsage } from './memory';
import { AgentAction, AgentAttachment, AgentRunRequest, IPC } from '../shared/types';

const SYSTEM_PROMPT = `You are Bron, an elite AI web research and automation agent built into a browser.

IDENTITY:
- Be methodical, thorough, and practical.
- Deliver complete answers with clear structure and citations where possible.
- Do not get stuck in loops.

AVAILABLE ACTIONS:
- open_url: Navigate to a URL. target=URL
- search: Google search. value=query
- click: Click an element. target=selector
- select_option: Select a dropdown option. target=selector, value=option_value
- type: Type into an input. target=selector, value=text
- press_enter: Press Enter key
- scroll: Scroll the page. value="up" or "down"
- extract: Get visible text from the current page
- summarize: Summarize the current page
- new_tab: Open a new tab. target=URL (optional)
- switch_tab: Switch to a tab. target=tab_id
- close_tab: Close a tab. target=tab_id
- remember: Save a fact. target=key, value=data (critical for cross-page memory)
- done: Task complete. value=final answer

CORE RULES:
1. Conversation:
- If the user greets or asks casual chat, return action "done" immediately.

2. Four-phase method:
- PLAN: list targets, sources, and required data points.
- GATHER: extract from one site at a time; save findings with remember before leaving a page.
- VERIFY: cross-check key facts across at least 2 sources.
- COMPILE: produce concise but complete final output.

3. Output quality:
- For product comparison, include a compact table with separate columns for each source price.
- Include offers and key differences when available.
- Add short recommendations (best value, best overall, budget pick) only if supported by extracted data.

4. Self-correction:
- If an action fails, try a different selector/path/site.
- Do not repeat the same failing action more than twice.
- If blocked, move forward with the next best source.

5. Persistence:
- Continue working until the task is fully complete or explicitly stopped.
- Avoid repetitive loops by trying new strategies if one fails.

6. Memory discipline:
- Use remember aggressively after every meaningful extraction.
- Use descriptive keys (example: flipkart_s25_prices).
- Reuse remembered facts for final response.

7. Safety:
- Never enter passwords or OTPs.
- Never attempt login flows or bypass captchas.
- If sign-in is required, use another source.

8. Data integrity:
- Never invent URLs, facts, prices, or IDs.
- If data is missing, say "Not found".
- Use only data actually extracted from pages.

9. Output formatting:
- By default use plain text formatting.
- Do NOT use markdown decoration like **bold**, # headings, code fences, or table pipes unless the user explicitly asks for markdown.
- Keep output spreadsheet-friendly and narrow-sidebar friendly.
- Prefer short lines, concise bullets, and compact text.

10. Attachments:
- If attachments exist, treat them as high-priority context.
- For hiring/networking tasks, extract role, skills, seniority, domain, and location from JD first.
- Use those criteria to choose targets.
- Expand role titles into close synonyms and adjacent roles before searching.
- Use broad-to-narrow query passes instead of only one exact title phrase.

11. Context continuity:
- Resolve references like "them", "those", "same ones" from prior chat.
- If the user says "Continue" or "Resume", do NOT restart. Look at the last "DONE" or "ERROR" in the context and pick up from the last page you were on.
- Use the existing memory and browser state to complete the remaining parts of the task.

12. Dynamic blockers:
- If popup/modal/consent appears, handle it and continue.
- If expected action is missing (for example only "Follow" exists), skip and continue.

13. LinkedIn connect flow:
- After clicking Connect/Invite, complete popup flow.
- Default to "Send without a note" unless user explicitly asks for a note.
- Do not repeatedly click Sign in / Log in links. If login prompts persist, dismiss and continue with visible profiles.

14. LinkedIn anti-loop strategy:
- Do not re-type the same search query more than once unless page context changed.
- Avoid more than 8 consecutive scrolls on one result page; use next-page controls when available.
- Never click the same Invite target twice.
- If selector appears invalid (contains :has-text or :contains), choose a simpler visible alternative selector.

15. Response format:
- Return ONLY valid JSON.
- No markdown fences around JSON.

JSON response format:
{
  "thought": "detailed reasoning about what to do next and why",
  "action": "action_name",
  "target": "target",
  "value": "value",
  "reason": "brief reason"
}`;

let isRunning = false;
let shouldStop = false;
let currentAbortController: AbortController | null = null;

export function isAgentRunning(): boolean {
  return isRunning;
}

export function stopAgent(): void {
  shouldStop = true;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

export async function runAgent(
  taskInput: string | AgentRunRequest,
  browserController: AgentAutomationController,
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  shouldStop = false;

  const settings = getSettings();
  const parsedTaskInput = parseTaskInput(taskInput);
  const rawTask = parsedTaskInput.task;
  const attachments = parsedTaskInput.attachments;
  const contextMessages = parsedTaskInput.contextMessages;
  const sessionId = parsedTaskInput.sessionId;
  const recruitingAwareTask = augmentTaskForRecruiting(rawTask, attachments, contextMessages);
  const task = augmentTaskForStructuredOutput(recruitingAwareTask, attachments, contextMessages);
  const attachmentPrompt = buildAttachmentPrompt(attachments);
  if (!task) {
    const win = getWindow();
    win?.webContents.send(IPC.AGENT_ERROR, 'Please enter a task.');
    isRunning = false;
    return;
  }
  if (!settings.apiKey) {
    const win = getWindow();
    win?.webContents.send(IPC.AGENT_ERROR, 'OpenRouter API key is not set. Open Settings to add it.');
    isRunning = false;
    return;
  }

  const taskId = createTask(rawTask || task);
  const maxSteps = Number(settings.maxSteps || 0);
  const isChatMode = parsedTaskInput.isChatMode;

  const send = (channel: string, data: any) => {
    const win = getWindow();
    if (data && typeof data === 'object') {
      data.agentTabId = browserController.getAgentTabId();
    }
    win?.webContents.send(channel, data);
  };

  // ── Prompt Enhancement Step (ChatGPT 5.1 Engine) ──
  let optimizedTask = task;
  let enhancerUsage: any = null;
  if (!isChatMode) {
    try {
      send(IPC.AGENT_STEP, {
        step: 0,
        type: 'thinking',
        message: 'ChatGPT 5.1 Engine: Enhancing and detailing your task for maximum efficiency...',
      });
      currentAbortController = new AbortController();
      const enhancement = await enhancePrompt(settings.apiKey, task, currentAbortController.signal);
      optimizedTask = enhancement.enhanced;
      enhancerUsage = enhancement.usage;
      currentAbortController = null;
      
      send(IPC.AGENT_STEP, {
        step: 0,
        type: 'thinking',
        message: 'Optimization complete. Starting agentic execution...',
      });
    } catch (err) {
      currentAbortController = null;
      console.error('Enhancement step failed, using original task.');
    }
  }

  const systemPrompt = isChatMode 
    ? `You are Bron in Chat Mode. The user has already completed a research task and now wants to discuss the results or ask follow-up questions.
       RULES:
       1. Answer only using the provided conversation history and your existing knowledge.
       2. DO NOT suggest any browser actions (search, click, open_url, etc.).
       3. If you cannot answer from history, explain that you would need to switch back to Research Mode to find more info.
       4. Return your response as a JSON object with "thought" and "action": "done", "value": "your answer".`
    : SYSTEM_PROMPT;

  const runStartedAt = Date.now();
  let step = 0;
  let browserRecoveryRetries = 0;
  const runMemories: Array<{ key: string; value: string }> = [];
  const failedActionCounts = new Map<string, number>();
  const repeatedActionCounts = new Map<string, number>();
  const stateActionCounts = new Map<string, number>();
  const linkedInFlow = {
    loginClickCount: 0,
    consecutiveScrolls: 0,
    queryTypeCounts: new Map<string, number>(),
    inviteClickCounts: new Map<string, number>(),
  };


  let lastActions: string[] = []; 
  let lastResult = '';
  const visitedSites = new Set<string>(); 
  const failedSites = new Set<string>(); 
  const conversationHistory: ChatTurn[] = []; 

  try {
    let startTabId = browserController.getActiveTabId();
    if (!startTabId) {
      try {
        const bootState = await browserController.getBrowserState();
        startTabId = bootState.tabs.find((t) => t.active)?.id || null;
      } catch {
        startTabId = null;
      }
    }
    browserController.setAgentTabId(startTabId);
    while (!shouldStop) {
      step++;

      if (maxSteps > 0 && step > maxSteps) {
        const elapsedMs = Date.now() - runStartedAt;
        send(IPC.AGENT_DONE, {
          message: `Step limit reached (${maxSteps}). Stopping after ${formatDuration(elapsedMs)}.`,
          steps: step,
          runtimeMs: elapsedMs,
        });
        updateTaskStatus(taskId, 'completed');
        return;
      }

      let state: any;
      try {
        state = await browserController.getBrowserState();
        browserRecoveryRetries = 0;
      } catch (err: any) {
        const msg = String(err?.message || '');
        const reconnecting =
          msg.includes('ECONNREFUSED') ||
          msg.includes('ERR_CONNECTION_REFUSED') ||
          msg.includes('Failed to connect to browser engine');

        if (reconnecting) {
          browserRecoveryRetries++;
          send(IPC.AGENT_STEP, {
            step,
            type: 'error',
            message: `Browser engine is reconnecting (${browserRecoveryRetries}/8)...`,
          });

          if (browserRecoveryRetries >= 8) {
            send(
              IPC.AGENT_ERROR,
              'Browser engine could not reconnect in time. Please refresh once and try again.',
            );
            updateTaskStatus(taskId, 'failed');
            return;
          }

          await sleep(1200);
          continue;
        }

        throw err;
      }

      const memories = runMemories
        .slice(-12)
        .map((m) => ({ key: m.key, value: m.value }));

      try {
        const currentDomain = new URL(state.url).hostname;
        visitedSites.add(currentDomain);
      } catch {}

      let loopWarning = '';
      if (lastActions.length >= 3) {
        const last3 = lastActions.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          loopWarning = '\n\nCRITICAL: You are stuck in a loop. Do NOT repeat the same action again. Try a different selector, a different website, or use "done" if you have enough info.\n';
        }
      }

      const siteInfo = `
VISITED SITES: ${visitedSites.size > 0 ? Array.from(visitedSites).join(', ') : 'none'}
BLOCKED SITES: ${failedSites.size > 0 ? Array.from(failedSites).join(', ') + ' - DO NOT revisit these' : 'none'}`;

      const continuityContext = buildContinuityContext(contextMessages);
      const userMessage = buildUserMessage(
        optimizedTask,
        state,
        memories,
        step,
        maxSteps,
        lastResult,
        loopWarning + siteInfo,
        continuityContext,
      );

      send(IPC.AGENT_STEP, {
        step,
        type: 'thinking',
        message: `Step ${step}: Analyzing page and deciding next action...`,
      });

      let action: AgentAction;
      let usageForStep: { promptTokens: number; completionTokens: number; totalTokens: number; cost: number } | null = null;
      let apiRetries = 0;
      try {
        currentAbortController = new AbortController();
        const openRouterResult = await callOpenRouter(
          { apiKey: settings.apiKey, model: settings.model },
          systemPrompt,
          userMessage,
          conversationHistory,
          step === 1 ? attachmentPrompt : undefined,
          currentAbortController.signal,
        );
        currentAbortController = null;
        action = openRouterResult.action;
        usageForStep = openRouterResult.usage;

        let displayModel = settings.model;
        let promptTokens = usageForStep.promptTokens;
        let completionTokens = usageForStep.completionTokens;
        let totalTokens = usageForStep.totalTokens;
        let cost = usageForStep.cost;

        if (step === 1 && enhancerUsage) {
          displayModel = `${settings.model} + Enhancer`;
          promptTokens += enhancerUsage.promptTokens;
          completionTokens += enhancerUsage.completionTokens;
          totalTokens += enhancerUsage.totalTokens;
          cost += enhancerUsage.cost;
        }

        addCreditUsage({
          taskId,
          sessionId,
          model: displayModel,
          promptTokens,
          completionTokens,
          totalTokens,
          cost,
        });
      } catch (err: any) {
        currentAbortController = null;
        if (shouldStop || err.name === 'AbortError') {
          break; // Exit the while loop
        }
        const errMsg = err.message || '';

        if (errMsg.includes('402') || errMsg.includes('Insufficient credits')) {
          send(IPC.AGENT_ERROR, 'OpenRouter credits have run out. Please add credits at https://openrouter.ai/settings/credits and try again.');
          updateTaskStatus(taskId, 'failed');
          return;
        }
        if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
          send(IPC.AGENT_ERROR, 'Invalid API key. Please check your OpenRouter API key in Settings.');
          updateTaskStatus(taskId, 'failed');
          return;
        }
        if (errMsg.includes('403') || errMsg.includes('Forbidden')) {
          send(IPC.AGENT_ERROR, 'Access denied. Your API key may not have access to the selected model. Try a different model in Settings.');
          updateTaskStatus(taskId, 'failed');
          return;
        }
        if (errMsg.includes('404') || errMsg.includes('not found')) {
          send(IPC.AGENT_ERROR, `Model "${settings.model}" not found on OpenRouter. Please select a different model in Settings.`);
          updateTaskStatus(taskId, 'failed');
          return;
        }

        if (errMsg.includes('429') || errMsg.includes('rate limit')) {
          apiRetries++;
          if (apiRetries >= 3) {
            send(IPC.AGENT_ERROR, 'Rate limited by OpenRouter after 3 retries. Please wait a minute and try again.');
            updateTaskStatus(taskId, 'failed');
            return;
          }
          send(IPC.AGENT_STEP, {
            step,
            type: 'error',
            message: `Rate limited. Waiting 10 seconds before retry (${apiRetries}/3)...`,
          });
          await sleep(10000);
          continue;
        }

        apiRetries++;
        if (apiRetries >= 3) {
          send(IPC.AGENT_ERROR, `API failed after 3 attempts: ${errMsg.split('\n')[0]}`);
          updateTaskStatus(taskId, 'failed');
          return;
        }
        send(IPC.AGENT_STEP, {
          step,
          type: 'error',
          message: `API Error (retry ${apiRetries}/3): ${errMsg.split('\n')[0]}`,
        });
        await sleep(2000);
        continue;
      }

      const stateFingerprint = buildStateFingerprint(state);
      const heuristic = applyExecutionHeuristics(action, state, stateFingerprint, stateActionCounts, linkedInFlow);
      if (heuristic.note) {
        send(IPC.AGENT_STEP, {
          step,
          type: 'thinking',
          message: heuristic.note,
        });
      }
      if (heuristic.blockReason) {
        lastResult = heuristic.blockReason;
        addStep(taskId, step, action.action, action.target, action.value, `HEURISTIC_BLOCK: ${heuristic.blockReason}`);
        send(IPC.AGENT_STEP, {
          step,
          type: 'blocked',
          message: heuristic.blockReason,
          action,
        });
        continue;
      }
      action = heuristic.action;

      const safety = validateAction(action);
      if (!safety.safe) {
        send(IPC.AGENT_STEP, {
          step,
          type: 'blocked',
          message: `Safety block: ${safety.reason}`,
          action,
        });
        lastResult = `BLOCKED: ${safety.reason}`;
        addStep(taskId, step, action.action, action.target, action.value, `BLOCKED: ${safety.reason}`);
        continue; 
      }

      if (safety.requiresConfirmation) {
        send(IPC.AGENT_STEP, {
          step,
          type: 'confirmation',
          message: `${safety.reason}`,
          action,
        });
        lastResult = `CONFIRMATION NEEDED: ${safety.reason}`;
        addStep(taskId, step, action.action, action.target, action.value, `NEEDS_CONFIRMATION: ${safety.reason}`);
        continue; 
      }

      const actionSignature = buildActionSignature(action);
      const knownFailures = failedActionCounts.get(actionSignature) || 0;
      if (knownFailures >= 2) {
        const msg = `Skipping repeated failing action (${action.action}). Trying a different path.`;
        lastResult = msg;
        addStep(taskId, step, action.action, action.target, action.value, `SKIPPED_REPEAT_FAIL: ${msg}`);
        send(IPC.AGENT_STEP, {
          step,
          type: 'blocked',
          message: msg,
          action,
        });
        continue;
      }

      const repeatLimitedActions = new Set(['click', 'type', 'press_enter', 'select_option']);
      const repeatedSuccesses = repeatedActionCounts.get(actionSignature) || 0;
      const maxRepeats = action.action === 'click' ? 3 : 2;
      if (repeatLimitedActions.has(action.action) && repeatedSuccesses >= maxRepeats) {
        const msg = `Skipping repetitive action (${action.action}) to prevent loops.`;
        lastResult = msg;
        addStep(taskId, step, action.action, action.target, action.value, `SKIPPED_REPEAT_SUCCESS: ${msg}`);
        send(IPC.AGENT_STEP, {
          step,
          type: 'blocked',
          message: msg,
          action,
        });
        continue;
      }

      send(IPC.AGENT_STEP, {
        step,
        type: 'action',
        message: `${getActionEmoji(action.action)} ${action.reason || action.action}`,
        action,
      });

      const result = await executeAction(
        action,
        browserController,
        settings.saveMemory,
        (memory) => {
          runMemories.push(memory);
          if (runMemories.length > 100) runMemories.shift();
        },
        sessionId,
        taskId,
      );
      lastResult = result;
      if (isFailureResult(result)) {
        failedActionCounts.set(actionSignature, knownFailures + 1);
        repeatedActionCounts.delete(actionSignature);
      } else {
        failedActionCounts.delete(actionSignature);
        const repeatLimitedActions = new Set(['click', 'type', 'press_enter', 'select_option']);
        if (repeatLimitedActions.has(action.action)) {
          repeatedActionCounts.set(actionSignature, (repeatedActionCounts.get(actionSignature) || 0) + 1);
        } else {
          repeatedActionCounts.delete(actionSignature);
        }
      }

      if (result.toLowerCase().includes('failed') || result.toLowerCase().includes('timeout') || result.toLowerCase().includes('blocked') || result.toLowerCase().includes('access denied') || result.toLowerCase().includes('403')) {
        try {
          const state2 = await browserController.getBrowserState();
          const failedDomain = new URL(state2.url).hostname;
          failedSites.add(failedDomain);
        } catch {}
      }

      lastActions.push(`${action.action}:${action.target}`);
      if (lastActions.length > 5) lastActions.shift();

      addStep(taskId, step, action.action, action.target, action.value, result);

      send(IPC.AGENT_STEP, {
        step,
        type: 'result',
        message: formatStepResultForSidebar(result),
        action,
      });

      conversationHistory.push({
        role: 'user',
        content: `[Step ${step}] URL: ${state.url}`,
      });
      conversationHistory.push({
        role: 'assistant',
        content: JSON.stringify({ thought: action.thought, action: action.action, target: action.target?.slice(0, 100), result: result.slice(0, 300) }),
      });

      if (action.action === 'done' || isChatMode) {
        const elapsedMs = Date.now() - runStartedAt;
        const finalMessage = formatFinalAnswerForDisplay(action.value || action.reason || 'Task completed.');
        send(IPC.AGENT_DONE, {
          message: isChatMode ? action.value : `${finalMessage}\n\nRun time: ${formatDuration(elapsedMs)}`,
          steps: step,
          runtimeMs: elapsedMs,
        });
        updateTaskStatus(taskId, 'completed');
        return;
      }

      await sleep(400);
    }

    if (shouldStop) {
      const elapsedMs = Date.now() - runStartedAt;
      send(IPC.AGENT_DONE, {
        message: `Agent stopped by user after ${formatDuration(elapsedMs)}.`,
        steps: step,
        runtimeMs: elapsedMs,
      });
      updateTaskStatus(taskId, 'stopped');
    } else {
      console.log('[Agent] Loop exited unexpectedly. step:', step, 'shouldStop:', shouldStop);
      const elapsedMs = Date.now() - runStartedAt;
      send(IPC.AGENT_DONE, {
        message: `Agent finished after ${step} steps in ${formatDuration(elapsedMs)}.`,
        steps: step,
        runtimeMs: elapsedMs,
      });
      updateTaskStatus(taskId, 'completed');
    }
  } catch (err: any) {
    send(IPC.AGENT_ERROR, `Agent error: ${err.message}`);
    updateTaskStatus(taskId, 'failed');
  } finally {
    browserController.setAgentTabId(null);
    isRunning = false;
    shouldStop = false;
  }
}

function buildUserMessage(
  task: string,
  state: any,
  memories: any[],
  step: number,
  maxSteps: number,
  lastResult: string = '',
  loopWarning: string = '',
  continuityContext: string = '',
): string {
  const memoryStr =
    memories.length > 0
      ? memories
          .map((m) => {
            const value = String(m.value || '').replace(/\s+/g, ' ').trim();
            const preview = value.length > 800 ? `${value.slice(0, 800)}...` : value;
            return `- ${m.key}: ${preview}`;
          })
          .join('\n')
      : 'None';

  const clickableStr =
    state.clickableElements.length > 0
      ? state.clickableElements
          .slice(0, 80)
          .map((e: any) => `  [${e.tag}] "${e.text}" -> ${e.selector}`)
          .join('\n')
      : '  (none visible)';

  const inputStr =
    state.inputFields.length > 0
      ? state.inputFields
          .slice(0, 20)
          .map((f: any) => `  [${f.type}] ${f.label || f.placeholder || 'unnamed'} -> ${f.selector}`)
          .join('\n')
      : '  (none visible)';

  const tabsStr = state.tabs
    .map((t: any) => `  ${t.active ? '->' : ' '} [${t.id}] ${t.title} (${t.url})`)
    .join('\n');

  const stepWarning = step >= maxSteps
    ? `\nWARNING: You are at step ${step}/${maxSteps}. Try to finish soon or use "done" with your best answer so far.\n`
    : '';

  const lastResultStr = lastResult
    ? `\nLAST ACTION RESULT:\n${lastResult.slice(0, 4000)}\n`
    : '';
  const priorContextStr = continuityContext
    ? `\nPRIOR CHAT CONTEXT:\n${continuityContext}\n`
    : '';

  return `TASK: ${task}

STEP: ${step}/${maxSteps}${stepWarning}${loopWarning}
${lastResultStr}
${priorContextStr}
CURRENT TAB: ${state.tabs.find((t: any) => t.active)?.id || 'none'}
URL: ${state.url}
TITLE: ${state.title}

OPEN TABS:
${tabsStr}

VISIBLE TEXT (first 10000 chars):
${state.visibleText.slice(0, 10000)}

CLICKABLE ELEMENTS:
${clickableStr}

INPUT FIELDS:
${inputStr}

RELEVANT MEMORY:
${memoryStr}

Choose your next action. Return ONLY valid JSON.`;
}

async function executeAction(
  action: AgentAction,
  bc: AgentAutomationController,
  saveMemory: boolean,
  onRemember?: (memory: { key: string; value: string }) => void,
  sessionId?: number,
  taskId?: number,
): Promise<string> {
  try {
    switch (action.action) {
      case 'open_url':
        await bc.navigate(action.target || action.value);
        return `Navigated to ${action.target || action.value}`;

      case 'search':
        return await bc.search(action.value || action.target);

      case 'click':
        await bc.highlightElement(action.target);
        return await bc.click(action.target);

      case 'select_option':
        await bc.highlightElement(action.target);
        return await bc.selectOption(action.target, action.value);

      case 'type':
        await bc.highlightElement(action.target);
        return await bc.typeText(action.target, action.value);

      case 'press_enter':
        return await bc.pressEnter();

      case 'scroll':
        return await bc.scroll(action.value || 'down');

      case 'extract': {
        const state = await bc.getBrowserState();
        return `Extracted text (${state.visibleText.length} chars): ${state.visibleText.slice(0, 1500)}`;
      }

      case 'summarize': {
        const s = await bc.getBrowserState();
        return `Page summary - Title: ${s.title}, URL: ${s.url}, Text preview: ${s.visibleText.slice(0, 1500)}`;
      }

      case 'new_tab': {
        const tabId = await bc.newTab(action.target || action.value || undefined);
        return `Opened new tab: ${tabId}`;
      }

      case 'switch_tab':
        await bc.switchTab(action.target);
        return `Switched to tab: ${action.target}`;

      case 'close_tab':
        await bc.closeTab(action.target);
        return `Closed tab: ${action.target}`;

      case 'remember':
        if (saveMemory) {
          const key = normalizeMemoryKey(action.target);
          const value = String(action.value || '').trim().slice(0, 12000);
          addMemory(key, value, 'agent', sessionId, taskId);
          onRemember?.({ key, value });
          return `Remembered "${key}" (${value.length} chars)`;
        }
        return 'Memory saving is disabled.';

      case 'done':
        return action.value || 'Task completed.';

      default:
        return `Unknown action: ${action.action}`;
    }
  } catch (err: any) {
    return `Action failed: ${err.message}`;
  }
}

function parseTaskInput(
  taskInput: string | AgentRunRequest,
): { task: string; sessionId?: number; attachments: AgentAttachment[]; contextMessages: string[]; isChatMode: boolean } {
  if (typeof taskInput === 'string') {
    return { task: taskInput, attachments: [], contextMessages: [], isChatMode: false };
  }
  const task = String(taskInput?.task || '').trim();
  const sessionId = taskInput?.sessionId;
  const attachments = Array.isArray(taskInput?.attachments) ? taskInput.attachments : [];
  const contextMessages = Array.isArray(taskInput?.contextMessages)
    ? taskInput.contextMessages.map((m) => String(m || '').trim()).filter(Boolean).slice(-8)
    : [];
  const isChatMode = !!taskInput?.isChatMode;
  return { task, sessionId, attachments, contextMessages, isChatMode };
}

function augmentTaskForRecruiting(
  rawTask: string,
  attachments: AgentAttachment[],
  contextMessages: string[],
): string {
  const task = String(rawTask || '').trim();
  if (!task) return '';

  const corpusParts = [task, ...contextMessages.slice(-6)];
  for (const att of attachments.slice(0, 4)) {
    if (att.kind === 'text' && att.textContent) {
      corpusParts.push(att.textContent.slice(0, 4000));
    }
  }
  const corpus = corpusParts.join('\n');
  if (!isRecruitingIntent(corpus)) return task;

  const baseRoles = extractRolePhrases(corpus);
  const expandedRoles = expandRolePhrases(baseRoles, corpus);
  if (expandedRoles.length === 0) return task;

  const locationHints = extractLocationHints(corpus);
  const skillHints = extractSkillHints(corpus);

  const coreRoles = expandedRoles.slice(0, Math.min(4, expandedRoles.length));
  const adjacentRoles = expandedRoles
    .filter((r) => !coreRoles.includes(r))
    .slice(0, 14);

  const locationLine = locationHints.length > 0
    ? `- Location filters: ${locationHints.join(', ')}`
    : '- Location filters: use location from JD/user prompt';
  const skillLine = skillHints.length > 0
    ? `- Skill filters: ${skillHints.join(', ')}`
    : '- Skill filters: prioritize explicit JD skills';

  return `${task}

AUTO ROLE EXPANSION (generated):
- Core roles: ${coreRoles.join(' | ')}
- Adjacent roles to include: ${adjacentRoles.length > 0 ? adjacentRoles.join(' | ') : coreRoles.join(' | ')}
${locationLine}
${skillLine}
- Search strategy: run multiple OR-based role queries (broad -> narrow), then shortlist by skill, industry, seniority, and location match.
- For follow-up commands like "send connection to them", use only the previously shortlisted candidate set, not random new profiles.
- For LinkedIn sourcing, prefer LinkedIn native search/filter pages. Avoid repetitive Google site:linkedin scraping patterns that trigger CAPTCHA.
`;
}

function augmentTaskForStructuredOutput(
  rawTask: string,
  attachments: AgentAttachment[],
  contextMessages: string[],
): string {
  const task = String(rawTask || '').trim();
  if (!task) return '';

  const corpusParts = [task, ...contextMessages.slice(-6)];
  for (const att of attachments.slice(0, 4)) {
    if (att.kind === 'text' && att.textContent) {
      corpusParts.push(att.textContent.slice(0, 2500));
    }
  }
  const lower = corpusParts.join('\n').toLowerCase();

  const asksForTable = /\b(table|tabular|sheet|spreadsheet)\b/.test(lower);
  const looksLikeTravelComparison = /\b(flight|airline|round trip|departure|return|cheapest|fastest|doha|mumbai)\b/.test(lower);

  if (!asksForTable && !looksLikeTravelComparison) return task;

  return `${task}

OUTPUT FORMAT REQUIREMENTS (MANDATORY):
- Use compact pipe-style tables for comparison sections.
- Do not use markdown decoration like **bold** or # headings.
- Keep each section to max 5 rows unless user explicitly asks for more.
- Keep cells concise to fit a narrow sidebar.

Use this table schema for flight-style comparisons:
| Rank | Option | Price INR | Time Window | Duration | Stops/Layover | Emissions |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ... | ... | ... | ... | ... | ... |

Use sections in this order when relevant:
1) TOP CHEAPEST
2) TOP FASTEST
3) TOP OVERALL
4) TOP QUALITY
5) BEST VALUE PICKS (short bullets)
`;
}

function isRecruitingIntent(text: string): boolean {
  const lower = String(text || '').toLowerCase();
  return /(hiring|hire|recruit|candidate|job description|jd\b|linkedin|send connection|shortlist|profile search|talent)/.test(lower);
}

function extractRolePhrases(text: string): string[] {
  const cleaned = String(text || '').replace(/\r/g, ' ');
  const roleRegex = /\b([a-z][a-z/&+\-\s]{1,56}?(?:engineer|manager|support|specialist|consultant|executive|associate|developer|analyst|representative))\b/gi;
  const out: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = roleRegex.exec(cleaned)) !== null) {
    const role = normalizeRolePhrase(match[1]);
    if (!role) continue;
    out.push(role);
    if (out.length >= 12) break;
  }

  if (out.length === 0) {
    const fallbackLine = cleaned
      .split('\n')
      .find((line) => /(role|position|title|hiring for)/i.test(line));
    if (fallbackLine) {
      const fallback = normalizeRolePhrase(fallbackLine);
      if (fallback) out.push(fallback);
    }
  }

  return dedupeStrings(out).slice(0, 10);
}

function expandRolePhrases(baseRoles: string[], corpus: string): string[] {
  const expanded = new Set<string>();
  const source = baseRoles.length > 0 ? baseRoles : ['sales engineer'];
  const lowerCorpus = corpus.toLowerCase();

  for (const role of source) {
    const normalized = normalizeRolePhrase(role);
    if (!normalized) continue;
    expanded.add(normalized);

    const lower = normalized.toLowerCase();

    if (lower.includes('sales engineer')) {
      addRoleVariants(expanded, [
        'Senior Sales Engineer',
        'Technical Sales Engineer',
        'Pre Sales Engineer',
        'Solutions Engineer',
        'Presales Consultant',
        'Business Development Engineer',
        'Application Engineer',
        'Field Application Engineer',
        'Sales Account Manager',
      ]);
    }
    if (lower.includes('sales')) {
      addRoleVariants(expanded, [
        'Account Executive',
        'Account Manager',
        'Inside Sales Specialist',
        'Sales Development Representative',
        'Business Development Executive',
      ]);
    }
    if (lower.includes('support')) {
      addRoleVariants(expanded, [
        'Technical Support Engineer',
        'Customer Support Specialist',
        'Customer Success Specialist',
        'Client Success Manager',
        'Implementation Support Engineer',
      ]);
    }
    if (lower.includes('engineer')) {
      addRoleVariants(expanded, [
        'Solutions Consultant',
        'Systems Engineer',
        'Technical Consultant',
        'Implementation Engineer',
      ]);
    }
  }

  if (/(iot|telemetry|mqtt|modbus|rs485)/.test(lowerCorpus)) {
    addRoleVariants(expanded, [
      'IoT Solutions Engineer',
      'Telemetry Engineer',
      'Industrial IoT Engineer',
      'SCADA Engineer',
      'Instrumentation Engineer',
    ]);
  }

  if (/(water|utility|utilities)/.test(lowerCorpus)) {
    addRoleVariants(expanded, [
      'Water Management Specialist',
      'Water Utility Solutions Engineer',
      'Utility Account Manager',
    ]);
  }

  if (/(industrial automation|automation)/.test(lowerCorpus)) {
    addRoleVariants(expanded, [
      'Industrial Automation Engineer',
      'Automation Solutions Engineer',
      'Control Systems Engineer',
    ]);
  }

  return Array.from(expanded).slice(0, 18);
}

function addRoleVariants(target: Set<string>, variants: string[]): void {
  for (const role of variants) {
    const cleaned = normalizeRolePhrase(role);
    if (cleaned) target.add(cleaned);
  }
}

function normalizeRolePhrase(text: string): string {
  return String(text || '')
    .replace(/[|,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–—\s]+|[-–—\s]+$/g, '')
    .slice(0, 70);
}

function extractLocationHints(text: string): string[] {
  const out: string[] = [];
  const locationRegex = /\b(mumbai|pune|bangalore|bengaluru|delhi|gurgaon|gurugram|hyderabad|chennai|kolkata|noida)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = locationRegex.exec(text)) !== null) {
    out.push(match[1]);
    if (out.length >= 4) break;
  }
  return dedupeStrings(out).map(toTitleCase);
}

function extractSkillHints(text: string): string[] {
  const needles = [
    'iot',
    'mqtt',
    'modbus',
    'rs485',
    'telemetry',
    'industrial automation',
    'water management',
    'b2b',
    'rfp',
    'tender',
  ];
  const lower = text.toLowerCase();
  const hits = needles.filter((s) => lower.includes(s));
  return hits.slice(0, 8).map(toTitleCase);
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildAttachmentPrompt(
  attachments: AgentAttachment[],
): { text: string; imageDataUrls: string[] } | undefined {
  if (!attachments || attachments.length === 0) return undefined;

  const imageDataUrls = attachments
    .filter((a) => a.kind === 'image' && a.imageDataUrl)
    .map((a) => String(a.imageDataUrl))
    .slice(0, 3);

  const lines: string[] = [];
  for (const att of attachments.slice(0, 6)) {
    if (att.kind === 'text' && att.textContent) {
      lines.push(`File: ${att.name} (${formatBytes(att.sizeBytes)})`);
      lines.push(att.textContent.slice(0, 7000));
      lines.push('---');
      continue;
    }
    if (att.kind === 'image') {
      lines.push(`Image attached: ${att.name} (${formatBytes(att.sizeBytes)}). Analyze this image for relevant details.`);
      continue;
    }
    lines.push(`Attachment not parsed: ${att.name}. ${att.note || 'No preview available.'}`);
  }

  if (lines.length === 0 && imageDataUrls.length === 0) return undefined;
  return {
    text: `ATTACHMENT CONTEXT:\n${lines.join('\n')}`,
    imageDataUrls,
  };
}

function buildContinuityContext(contextMessages: string[]): string {
  if (!contextMessages || contextMessages.length === 0) return '';
  const lines = contextMessages
    .slice(-6)
    .map((msg, idx) => `- Context ${idx + 1}: ${msg.replace(/\s+/g, ' ').trim().slice(0, 900)}`);
  return lines.join('\n');
}

function buildActionSignature(action: AgentAction): string {
  return [
    action.action,
    String(action.target || '').slice(0, 180),
    String(action.value || '').slice(0, 120),
  ].join('|');
}

function isFailureResult(result: string): boolean {
  const text = String(result || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('action failed') ||
    text.includes('click failed') ||
    text.includes('select failed') ||
    text.includes('type failed') ||
    text.includes('timeout') ||
    text.includes('not found') ||
    text.includes('access denied') ||
    text.includes('blocked')
  );
}

function formatStepResultForSidebar(result: string): string {
  const text = String(result || '').trim();
  if (!text) return '';
  if (text.length <= 420) return text;
  return `${text.slice(0, 420)}...`;
}

function formatFinalAnswerForDisplay(raw: string): string {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (!text) return 'Task completed.';

  const converted = convertTravelSummaryToTables(text);
  if (converted) return converted;
  return text;
}

function convertTravelSummaryToTables(text: string): string | null {
  if (/\|\s*Rank\s*\|/i.test(text) && /\|\s*Option\s*\|/i.test(text)) {
    return text;
  }

  const hasTravelSections = /TOP\s+CHEAPEST|TOP\s+FASTEST|TOP\s+OVERALL|TOP\s+QUALITY/i.test(text);
  if (!hasTravelSections) return null;

  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''));

  const sections: Array<{ title: string; items: string[] }> = [];
  let current: { title: string; items: string[] } | null = null;

  const isSeparatorLine = (line: string): boolean =>
    /^\s*[=\-]{6,}\s*$/.test(line);

  const isLikelySectionTitle = (line: string): boolean =>
    /^(TOP|BEST VALUE PICKS|BEST VALUE|QUALITY|FASTEST|CHEAPEST|OVERALL)/i.test(line.trim());

  const isBestValueSection = (title: string): boolean =>
    /best value/i.test(title);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || isSeparatorLine(line)) continue;

    if (isLikelySectionTitle(line)) {
      if (current && current.items.length > 0) sections.push(current);
      current = { title: line, items: [] };
      continue;
    }

    if (!current) continue;

    const numInline = line.match(/^\d+\.\s*(.+)$/);
    if (numInline && numInline[1].trim()) {
      current.items.push(numInline[1].trim());
      continue;
    }

    const onlyNumber = /^\d+\.$/.test(line);
    if (onlyNumber) {
      let itemText = '';
      for (let j = i + 1; j < lines.length; j++) {
        const probe = lines[j].trim();
        if (!probe || isSeparatorLine(probe)) continue;
        if (/^\d+\./.test(probe) || isLikelySectionTitle(probe)) break;
        itemText = probe;
        i = j;
        break;
      }
      if (itemText) current.items.push(itemText);
      continue;
    }

    if (line.startsWith('-') || line.startsWith('•')) {
      current.items.push(line.replace(/^[-•]\s*/, '').trim());
      continue;
    }
  }

  if (current && current.items.length > 0) sections.push(current);
  if (sections.length === 0) return null;

  const out: string[] = [];
  for (const section of sections) {
    out.push(section.title);
    if (isBestValueSection(section.title)) {
      section.items.slice(0, 6).forEach((item) => {
        out.push(`- ${toTableCell(item)}`);
      });
      out.push('');
      continue;
    }

    out.push('| Rank | Option | Price INR | Time Window | Duration | Stops/Layover | Emissions |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');

    const rows = section.items.slice(0, 7);
    rows.forEach((item, idx) => {
      const parsed = parseTravelRow(item);
      out.push(
        `| ${idx + 1} | ${toTableCell(parsed.option)} | ${toTableCell(parsed.price)} | ${toTableCell(parsed.timeWindow)} | ${toTableCell(parsed.duration)} | ${toTableCell(parsed.stops)} | ${toTableCell(parsed.emissions)} |`,
      );
    });
    out.push('');
  }

  return out.join('\n').trim();
}

function parseTravelRow(item: string): {
  option: string;
  price: string;
  timeWindow: string;
  duration: string;
  stops: string;
  emissions: string;
} {
  const text = String(item || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return { option: '', price: '', timeWindow: '', duration: '', stops: '', emissions: '' };
  }

  const segments = text.split(/\s+[—-]\s+/g).map((s) => s.trim()).filter(Boolean);
  const option = segments[0] || text;

  const price = text.match(/₹\s?[\d,]+/i)?.[0] || '';
  const timeWindow = text.match(/\d{1,2}:\d{2}\s*[AP]M\s*→\s*\d{1,2}:\d{2}\s*[AP]M(?:\+\d+)?/i)?.[0] || '';
  const duration = text.match(/\b\d+\s*h(?:\s*\d+\s*m)?\b|\b\d+h\s*\d*m\b/i)?.[0] || '';
  const stops = text.match(/\bnonstop\b|\b\d+\s*stop[s]?(?:\s*\([^)]*\))?/i)?.[0] || '';
  const emissions = text.match(/\b\d+\s*kg\b[^—-]*/i)?.[0] || '';

  return {
    option,
    price,
    timeWindow,
    duration,
    stops,
    emissions,
  };
}

function toTableCell(value: string): string {
  return String(value || '')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMemoryKey(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || `note_${Date.now()}`;
}

function formatTimeoutSummary(memories: Array<{ key: string; value: string }>, minutes: number): string {
  const unique = new Map<string, string>();
  for (const item of memories) {
    if (!item?.key) continue;
    unique.set(item.key, item.value || '');
  }

  const rows = Array.from(unique.entries()).slice(-12);
  if (rows.length === 0) {
    return `Time limit reached (${minutes} minutes). No saved findings yet. Try a more specific prompt or increase runtime in Settings.`;
  }

  const lines = rows.map(([key, value]) => {
    const compact = value.replace(/\s+/g, ' ').trim();
    const preview = compact.length > 280 ? `${compact.slice(0, 280)}...` : compact;
    return `- **${key}**: ${preview || '(empty)'}`;
  });

  return [
    `Time limit reached (${minutes} minutes).`,
    '',
    'Saved findings so far:',
    ...lines,
  ].join('\n');
}

function getActionEmoji(action: string): string {
  const map: Record<string, string> = {
    open_url: '[OPEN]',
    search: '[SEARCH]',
    click: '[CLICK]',
    select_option: '[SELECT]',
    type: '[TYPE]',
    press_enter: '[ENTER]',
    scroll: '[SCROLL]',
    extract: '[EXTRACT]',
    summarize: '[SUMMARIZE]',
    new_tab: '[TAB+]',
    switch_tab: '[TAB]',
    close_tab: '[TAB-]',
    remember: '[MEMORY]',
    done: '[DONE]',
  };
  return map[action] || '[ACTION]';
}

function applyExecutionHeuristics(
  action: AgentAction,
  state: any,
  stateFingerprint: string,
  stateActionCounts: Map<string, number>,
  linkedInFlow: {
    loginClickCount: number;
    consecutiveScrolls: number;
    queryTypeCounts: Map<string, number>;
    inviteClickCounts: Map<string, number>;
  },
): { action: AgentAction; blockReason?: string; note?: string } {
  const actionSignature = buildActionSignature(action);
  const stateActionKey = `${stateFingerprint}::${actionSignature}`;
  if (stateActionCounts.size > 4000) {
    stateActionCounts.clear();
  }
  const attemptsOnSameState = stateActionCounts.get(stateActionKey) || 0;
  stateActionCounts.set(stateActionKey, attemptsOnSameState + 1);
  if (attemptsOnSameState >= 2) {
    return {
      action,
      blockReason: `Action "${action.action}" is BLOCKED because the page did not change after previous attempts. You MUST try a different action (like clicking the Search button instead of pressing Enter, or scrolling to see more results).`,
    };
  }

  const linkedin = isLinkedInUrl(state?.url);
  if (!linkedin) {
    linkedInFlow.consecutiveScrolls = 0;
    return { action };
  }

  if (action.action === 'click' && looksLikeLinkedInLoginAction(action)) {
    linkedInFlow.loginClickCount += 1;
    if (linkedInFlow.loginClickCount > 1) {
      return {
        action,
        blockReason: 'LinkedIn login loop detected. Skipping repeated login click and continuing on visible results.',
      };
    }
  }

  if (action.action === 'type' && looksLikeSearchInputAction(action.target)) {
    const q = normalizeQuery(action.value);
    if (q) {
      const qCount = (linkedInFlow.queryTypeCounts.get(q) || 0) + 1;
      linkedInFlow.queryTypeCounts.set(q, qCount);
      if (qCount > 2) {
        return {
          action,
          blockReason: `Skipping repeated LinkedIn search query "${q}".`,
        };
      }
    }
  }

  if (action.action === 'click') {
    const inviteKey = extractInviteKey(action.target);
    if (inviteKey) {
      const inviteCount = (linkedInFlow.inviteClickCounts.get(inviteKey) || 0) + 1;
      linkedInFlow.inviteClickCounts.set(inviteKey, inviteCount);
      if (inviteCount > 1) {
        return {
          action,
          blockReason: `Skipping duplicate invite click for ${inviteKey}.`,
        };
      }
    }
  }

  if (action.action === 'scroll') {
    linkedInFlow.consecutiveScrolls += 1;
    if (linkedInFlow.consecutiveScrolls > 8) {
      const nextSelector = findLinkedInNextPageSelector(state);
      if (nextSelector) {
        return {
          action: {
            ...action,
            action: 'click',
            target: nextSelector,
            value: '',
            reason: 'Move to next LinkedIn results page to avoid excessive scrolling',
          },
          note: 'Loop guard: replaced repeated scrolls with next-page navigation.',
        };
      }
      return {
        action,
        blockReason: 'Too many consecutive LinkedIn scrolls without progress. Try a different visible action.',
      };
    }
  } else {
    linkedInFlow.consecutiveScrolls = 0;
  }

  return { action };
}

function isLinkedInUrl(url: string): boolean {
  return /linkedin\.com/i.test(String(url || ''));
}

function looksLikeLinkedInLoginAction(action: AgentAction): boolean {
  if (action.action !== 'click' && action.action !== 'open_url') return false;
  const s = `${action.target} ${action.value} ${action.reason}`.toLowerCase();
  return /login|log in|sign in/.test(s);
}

function looksLikeSearchInputAction(target: string): boolean {
  const t = String(target || '').toLowerCase();
  return /search|query|placeholder|aria-label/.test(t);
}

function normalizeQuery(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function extractInviteKey(selector: string): string | null {
  const s = String(selector || '');
  const inviteMatch = s.match(/invite\s+(.+?)\s+to connect/i);
  if (!inviteMatch) return null;
  return inviteMatch[1].replace(/\s+/g, ' ').trim().toLowerCase();
}

function findLinkedInNextPageSelector(state: any): string | null {
  const clickable = Array.isArray(state?.clickableElements) ? state.clickableElements : [];
  for (const el of clickable) {
    const text = String(el?.text || '').toLowerCase();
    const selector = String(el?.selector || '');
    if (!selector) continue;
    if (
      selector.includes("pagination-controls-next-button-visible") ||
      /next|page\s+next/.test(text)
    ) {
      return selector;
    }
  }
  return null;
}

function buildStateFingerprint(state: any): string {
  const url = String(state?.url || '');
  const title = String(state?.title || '').slice(0, 120);
  const text = String(state?.visibleText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
  return `${url}::${title}::${text}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
