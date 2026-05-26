import { app, BrowserWindow } from 'electron';
import { exec as execCallback } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import type { AgentAutomationController } from './agentAutomation';
import { callOpenRouter, ChatTurn, enhancePrompt } from './openrouter';
import { validateAction } from './safety';
import {
  addMemory,
  createTask,
  updateTaskStatus,
  addStep,
  getSettings,
  addCreditUsage,
  getBookmarks,
  createBookmark,
  updateBookmark,
  removeBookmark,
  searchBookmarks,
  getHistory,
  deleteHistoryUrl,
  deleteHistoryRange,
  getBrowserExtensions,
  getSavedCredentials,
  getAutofillProfiles,
  getWorkflows,
  getWorkflowSchedules,
  saveWorkflow,
  deleteWorkflow,
  saveWorkflowSchedule,
  updateWorkflowRun,
  saveSavedCredential,
  deleteSavedCredential,
  saveAutofillProfile,
  deleteAutofillProfile,
} from './memory';
import { AgentAction, AgentAttachment, AgentRunRequest, IPC } from '../shared/types';
import { SYSTEM_PROMPT } from '../agent/prompt';
import { strata } from '../integrations/strata';
import { TOOL_DEFINITIONS } from '../tools/registry';
import {
  readCore,
  readSoul,
  searchMemory as searchMarkdownMemory,
  updateCore as updateCoreMemory,
  updateSoul as updateSoulMemory,
  writeDailyMemory as writeDailyMemoryEntry,
} from '../memory';
import { runSkill } from './skills';
import { act as aiAct, extract as aiExtract, validate as aiValidate } from './aiActions';

let isRunning = false;
let shouldStop = false;
let currentAbortController: AbortController | null = null;
const execAsync = promisify(execCallback);

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
  const workflowId = parsedTaskInput.workflowId;
  const workflowRunId = parsedTaskInput.workflowRunId;
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
  if (!isChatMode && settings.agentPromptEnhancement !== false) {
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
    : `${SYSTEM_PROMPT}\n\n${buildCapabilityBootstrap(settings, browserController)}`;

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
        if (workflowRunId) {
          updateWorkflowRun(workflowRunId, {
            status: 'failed',
            result_summary: `Stopped at step limit (${maxSteps}).`,
            step_count: step,
            error_message: 'Step limit reached.',
            ended_at: new Date().toISOString(),
          });
        }
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
            if (workflowRunId) {
              updateWorkflowRun(workflowRunId, {
                status: 'failed',
                result_summary: 'Browser engine could not reconnect in time.',
                step_count: step,
                error_message: 'Browser engine reconnect timeout.',
                ended_at: new Date().toISOString(),
              });
            }
            send(
              IPC.AGENT_ERROR,
              'Browser engine could not reconnect in time. Please refresh once and try again.',
            );
            updateTaskStatus(taskId, 'failed');
            return;
          }

          await sleep(1200);
          continue; // Skip this iteration - state will be fetched again on retry
        }

        // For non-reconnection errors, report and stop
        if (workflowRunId) {
          updateWorkflowRun(workflowRunId, {
            status: 'failed',
            result_summary: `Failed to get browser state: ${msg}`,
            step_count: step,
            error_message: msg,
            ended_at: new Date().toISOString(),
          });
        }
        send(IPC.AGENT_ERROR, `Failed to get browser state: ${msg}`);
        updateTaskStatus(taskId, 'failed');
        return;
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
        settings,
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

        const maxErrors = typeof settings.costGuardMaxConsecutiveErrors === 'number'
          ? settings.costGuardMaxConsecutiveErrors
          : 5;

        if (errMsg.includes('429') || errMsg.includes('rate limit')) {
          apiRetries++;
          if (maxErrors > 0 && apiRetries >= maxErrors) {
            send(IPC.AGENT_ERROR, `Rate limited by OpenRouter after ${maxErrors} retries. Please wait a minute and try again.`);
            updateTaskStatus(taskId, 'failed');
            return;
          }
          const retryMessage = maxErrors === 0
            ? `Rate limited. Waiting 10 seconds before retry (attempt ${apiRetries})...`
            : `Rate limited. Waiting 10 seconds before retry (${apiRetries}/${maxErrors})...`;
          send(IPC.AGENT_STEP, {
            step,
            type: 'error',
            message: retryMessage,
          });
          await sleep(10000);
          continue;
        }

        apiRetries++;
        if (maxErrors > 0 && apiRetries >= maxErrors) {
          send(IPC.AGENT_ERROR, `API failed after ${maxErrors} attempts: ${errMsg.split('\n')[0]}`);
          updateTaskStatus(taskId, 'failed');
          return;
        }
        const errorMessage = maxErrors === 0
          ? `API Error (attempt ${apiRetries}): ${errMsg.split('\n')[0]}`
          : `API Error (retry ${apiRetries}/${maxErrors}): ${errMsg.split('\n')[0]}`;
        send(IPC.AGENT_STEP, {
          step,
          type: 'error',
          message: errorMessage,
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

      const destructiveMismatch = getDestructiveIntentMismatch(action, rawTask || task);
      if (destructiveMismatch) {
        lastResult = `BLOCKED: ${destructiveMismatch}`;
        addStep(taskId, step, action.action, action.target, action.value, `BLOCKED: ${destructiveMismatch}`);
        send(IPC.AGENT_STEP, {
          step,
          type: 'blocked',
          message: destructiveMismatch,
          action,
        });
        continue;
      }

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
      if (knownFailures >= 5) {
        const msg = `Skipping ${action.action} after 5 failures globally. Trying different approach.`;
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

      // Loop prevention: block exact same action+target after too many repeats
      // Note: Consecutive fill/type on DIFFERENT selectors is OK (forms have multiple fields)
      const repeatLimitedActions = new Set(['click', 'press_enter', 'press_key', 'select_option']);
      const repeatedSuccesses = repeatedActionCounts.get(actionSignature) || 0;
      const isFormField = ['type', 'fill', 'clear'].includes(action.action);
      const maxRepeats = action.action === 'click' ? 5 : (isFormField ? 15 : 3);
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
        getWindow,
        { apiKey: settings.apiKey, model: settings.model },
      );
      lastResult = result;
      if (isFailureResult(result)) {
        failedActionCounts.set(actionSignature, knownFailures + 1);
        repeatedActionCounts.delete(actionSignature);
      } else {
        failedActionCounts.delete(actionSignature);
        // Track repeats for loop prevention (exclude form fields on different targets)
        const repeatTrackingActions = new Set(['click', 'press_enter', 'press_key', 'select_option']);
        if (repeatTrackingActions.has(action.action)) {
          repeatedActionCounts.set(actionSignature, (repeatedActionCounts.get(actionSignature) || 0) + 1);
        } else if (['type', 'fill', 'clear'].includes(action.action)) {
          // Only count as repeat if same selector (forms legitimately use different fields)
          repeatedActionCounts.set(actionSignature, (repeatedActionCounts.get(actionSignature) || 0) + 1);
        } else {
          repeatedActionCounts.delete(actionSignature);
        }
      }

      if (shouldMarkSiteBlocked(result)) {
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
        let finalMessage = formatFinalAnswerForDisplay(action.value || action.reason || 'Task completed.');
        if (!isChatMode) {
          const isGeneric = !finalMessage || finalMessage.trim().toLowerCase() === 'task completed.' || finalMessage.length < 30;
          if (isGeneric) {
            send(IPC.AGENT_STEP, { step, type: 'thinking', message: 'Synthesizing report...' });
            try {
              // Create a fresh controller for synthesis to avoid "never" type issues and ensure it's abortable
              const synthController = new AbortController();
              finalMessage = await synthesizeFinalAnswerFromContext(
                settings.apiKey,
                rawTask || task,
                conversationHistory,
                runMemories,
                synthController.signal
              );
            } catch (err) {
              console.error('Synthesis failed:', err);
            }
          }
          finalMessage = await enrichFinalAnswerWithPageContext(
            rawTask || task,
            finalMessage,
            browserController,
          );
        }
        send(IPC.AGENT_DONE, {
          message: isChatMode ? action.value : `${finalMessage}\n\nRun time: ${formatDuration(elapsedMs)}`,
          steps: step,
          runtimeMs: elapsedMs,
        });
        if (workflowRunId) {
          updateWorkflowRun(workflowRunId, {
            status: 'completed',
            result_summary: finalMessage.slice(0, 12000),
            step_count: step,
            ended_at: new Date().toISOString(),
          });
        }
        updateTaskStatus(taskId, 'completed');
        return;
      }

      await sleep(400);
    }

    if (shouldStop) {
      const elapsedMs = Date.now() - runStartedAt;
      if (workflowRunId) {
        updateWorkflowRun(workflowRunId, {
          status: 'stopped',
          result_summary: `Stopped by user after ${formatDuration(elapsedMs)}.`,
          step_count: step,
          error_message: 'Stopped by user.',
          ended_at: new Date().toISOString(),
        });
      }
      send(IPC.AGENT_DONE, {
        message: `Agent stopped by user after ${formatDuration(elapsedMs)}.`,
        steps: step,
        runtimeMs: elapsedMs,
      });
      updateTaskStatus(taskId, 'stopped');
    } else {
      console.log('[Agent] Loop exited unexpectedly. step:', step, 'shouldStop:', shouldStop);
      const elapsedMs = Date.now() - runStartedAt;
      if (workflowRunId) {
        updateWorkflowRun(workflowRunId, {
          status: 'completed',
          result_summary: `Agent finished after ${step} steps in ${formatDuration(elapsedMs)}.`,
          step_count: step,
          ended_at: new Date().toISOString(),
        });
      }
      send(IPC.AGENT_DONE, {
        message: `Agent finished after ${step} steps in ${formatDuration(elapsedMs)}.`,
        steps: step,
        runtimeMs: elapsedMs,
      });
      updateTaskStatus(taskId, 'completed');
    }
  } catch (err: any) {
    if (workflowRunId) {
      updateWorkflowRun(workflowRunId, {
        status: 'failed',
        result_summary: `Agent error: ${err.message}`,
        step_count: step,
        error_message: String(err.message || err),
        ended_at: new Date().toISOString(),
      });
    }
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
  settings?: { agentFullAccess?: boolean; agentToolHints?: boolean; autoSaveSignIns?: boolean; workflowSchedulerEnabled?: boolean; domainProfiles?: string },
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
    .map((t: any) => `  ${t.active ? '->' : ' '} [${t.id}]${t.groupId ? ` {${t.groupId}}` : ''} ${t.title} (${t.url})`)
    .join('\n');

  const stepWarning = maxSteps > 0 && step >= maxSteps
    ? `\nWARNING: You are at step ${step}/${maxSteps}. Try to finish soon or use "done" with your best answer so far.\n`
    : '';

  const lastResultStr = lastResult
    ? `\nLAST ACTION RESULT:\n${lastResult.slice(0, 4000)}\n`
    : '';
  const priorContextStr = continuityContext
    ? `\nPRIOR CHAT CONTEXT:\n${continuityContext}\n`
    : '';
  const accessModeLine = settings?.agentFullAccess === false
    ? 'STANDARD ACCESS MODE: Ask before destructive actions outside the explicit task.'
    : 'FULL ACCESS MODE: Use built-in browser, file, history, bookmark, download, and connected app tools directly when they help.';
  const hintModeLine = settings?.agentToolHints === false
    ? 'RUNTIME HINTS: condensed'
    : 'RUNTIME HINTS: full capability bootstrap active';
  const siteHints = buildSiteProfileHints(state, settings?.domainProfiles);
  const siteHintStr = siteHints ? `\nSITE PROFILE HINTS:\n${siteHints}\n` : '';

  return `TASK: ${task}

STEP: ${step}/${maxSteps}${stepWarning}${loopWarning}
${lastResultStr}
${priorContextStr}
${accessModeLine}
${hintModeLine}
CURRENT TAB: ${state.tabs.find((t: any) => t.active)?.id || 'none'}
URL: ${state.url}
TITLE: ${state.title}
${siteHintStr}

OPEN TABS:
${tabsStr}

VISIBLE TEXT (first 10000 chars):
<page_content>
${state.visibleText.slice(0, 10000)}
</page_content>

CLICKABLE ELEMENTS:
${clickableStr}

INPUT FIELDS:
${inputStr}

RELEVANT MEMORY:
${memoryStr}

Choose your next action. Return ONLY valid JSON.`;
}

function buildSiteProfileHints(state: any, rawDomainProfiles?: string): string {
  const url = String(state?.url || '').toLowerCase();
  const text = String(state?.visibleText || '').toLowerCase();
  const hints: string[] = [];

  if (url.includes('docs.google.com/forms')) {
    hints.push('- Google Forms: prefer visible text targets like "Blank form" and direct editor actions over brittle CSS guesses.');
    hints.push('- If the template gallery is visible, do not mark the site blocked just because one card selector fails.');
  }
  if (url.includes('web.whatsapp.com')) {
    hints.push('- WhatsApp Web: context menus often need hover plus native pointer interaction on the chat row or row action button.');
    hints.push('- Avoid repeating the same chat click loop. If delete/archive is the goal, target the row context button or row menu.');
  }
  if (/signin|login|auth|accounts\.google\.com|typeform\.com\/signup/.test(url)) {
    hints.push('- Auth flow: prefer username/password fields, then wait for navigation or account chooser changes before retrying.');
  }
  if (/otp|verification|2-step|two-step|2fa|security code/.test(text)) {
    hints.push('- Verification flow detected: do not autofill passwords into code fields, and avoid repeating submits while waiting for the challenge state to change.');
  }
  const customHint = resolveDomainProfileHint(rawDomainProfiles, url);
  if (customHint) {
    hints.push(`- Custom site profile: ${customHint}`);
  }
  return hints.join('\n');
}

function parseDomainProfileHints(raw: string | undefined): Record<string, string> {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [domain, value] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(domain || '').trim().toLowerCase();
      const note = typeof value === 'string'
        ? value.trim()
        : value && typeof value === 'object' && 'note' in (value as Record<string, unknown>)
          ? String((value as Record<string, unknown>).note || '').trim()
          : '';
      if (key && note) out[key] = note;
    }
    return out;
  } catch {
    return {};
  }
}

function resolveDomainProfileHint(raw: string | undefined, pageUrl: string): string {
  const map = parseDomainProfileHints(raw);
  if (!pageUrl) return '';
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    for (const [domain, note] of Object.entries(map)) {
      if (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(host)) {
        return note;
      }
    }
  } catch {
    return '';
  }
  return '';
}

function getDestructiveIntentMismatch(action: AgentAction, taskText: string): string | null {
  const combined = `${action.target || ''} ${action.value || ''} ${action.reason || ''}`.toLowerCase();
  const destructive = /\b(delete|remove|clear|erase|trash|destroy|close account|sign out all)\b/.test(combined)
    || ['delete_history_url', 'delete_history_range', 'remove_bookmark', 'delete_workflow', 'delete_saved_credential', 'delete_autofill_profile'].includes(action.action);
  if (!destructive) return null;

  const taskLower = String(taskText || '').toLowerCase();
  const userAskedForIt = /\b(delete|remove|clear|erase|trash|cleanup|clean up)\b/.test(taskLower);
  if (userAskedForIt) return null;
  return 'Destructive action does not match the user task closely enough. Re-check intent before deleting or clearing data.';
}

function buildCapabilityBootstrap(
  settings: { headless?: boolean; agentFullAccess?: boolean; agentToolHints?: boolean; autoSaveSignIns?: boolean; workflowSchedulerEnabled?: boolean; domainProfiles?: string },
  browserController: AgentAutomationController,
): string {
  if (settings.agentToolHints === false) {
    return [
      '## Runtime Capability Bootstrap',
      `- Automation engine: ${browserController.constructor?.name || 'UnknownController'}`,
      `- Full agent access: ${settings.agentFullAccess === false ? 'disabled' : 'enabled'}`,
      `- Workspace root: ${process.cwd()}`,
      `- Downloads directory: ${app.getPath('downloads')}`,
      '- Use the listed browser, file, and integration tools directly when helpful.',
    ].join('\n');
  }

  const grouped = new Map<string, string[]>();
  for (const tool of TOOL_DEFINITIONS) {
    const existing = grouped.get(tool.category) || [];
    existing.push(tool.name);
    grouped.set(tool.category, existing);
  }

  const categoryOrder = [
    'observation',
    'interaction',
    'navigation',
    'bookmarks',
    'history',
    'tab-groups',
    'page-actions',
    'filesystem',
    'memory',
    'identity',
    'integration',
    'scheduling',
  ];

  const toolLines = categoryOrder
    .filter((category) => grouped.has(category))
    .map((category) => {
      const names = grouped.get(category) || [];
      return `- ${category} (${names.length}): ${names.join(', ')}`;
    });

  let connectionSummary = 'none connected';
  try {
    const allConnections = typeof (strata as any).getAllConnections === 'function'
      ? (strata as any).getAllConnections()
      : [];
    const connected = Array.isArray(allConnections)
      ? allConnections.filter((entry: any) => entry?.connected).map((entry: any) => entry.appName)
      : [];
    connectionSummary = connected.length > 0 ? connected.join(', ') : 'none connected';
  } catch {
    connectionSummary = 'unknown';
  }

  const engineName = browserController.constructor?.name || 'UnknownController';
  const engineSummary = /WebContentsViewController/i.test(engineName)
    ? 'Unified live browser automation through the main-process Chromium host with native pointer control, screenshots, downloads, and browser-managed tab coordination.'
    : 'Unified browser automation controller.';
  const extensionCount = getBrowserExtensions().filter((entry) => entry.enabled).length;
  const savedCredentialCount = getSavedCredentials().length;
  const autofillProfileCount = getAutofillProfiles().length;
  const domainProfileCount = Object.keys(parseDomainProfileHints(settings.domainProfiles)).length;

  return [
    '## Runtime Capability Bootstrap',
    '- Assume this capability block is authoritative for the entire run.',
    `- Automation engine: ${engineName}. ${engineSummary}`,
    `- Full agent access: ${settings.agentFullAccess === false ? 'disabled' : 'enabled'}. When enabled, do not ask the user for permission to use built-in tools; just use them.`,
    '- Runtime architecture: single live browser controller bound to the visible session. There is no parallel shadow browser in the normal path.',
    `- Workspace root: ${process.cwd()}`,
    `- Downloads directory: ${app.getPath('downloads')}`,
    `- Connected app actions: ${connectionSummary}`,
    `- Browser-managed extensions: ${extensionCount} enabled`,
    `- Browser-managed passwords/autofill: ${savedCredentialCount} saved sign-ins, ${autofillProfileCount} autofill profiles`,
    `- Browser-managed workflow scheduler: ${settings.workflowSchedulerEnabled === false ? 'paused' : 'enabled'} with ${getWorkflows().length} saved workflows`,
    `- Automatic sign-in capture: ${settings.autoSaveSignIns === false ? 'disabled' : 'enabled'} for detected successful logins`,
    `- Domain-specific site profiles: ${domainProfileCount} configured`,
    '- Safety boundaries: workspace file tools must stay inside the workspace root; avoid storing passwords/tokens in memory; only delete browsing history when the task explicitly asks; stop on CAPTCHA or hard access blocks.',
    '- Tool catalog:',
    ...toolLines,
    '- Tool orchestration rule: combine multiple tools whenever helpful. You are not limited to one browser action at a time.',
  ].join('\n');
}

async function executeAction(
  action: AgentAction,
  bc: AgentAutomationController,
  saveMemory: boolean,
  onRemember?: (memory: { key: string; value: string }) => void,
  sessionId?: number,
  taskId?: number,
  getWindow?: () => BrowserWindow | null,
  openRouterOpts?: { apiKey: string; model: string },
): Promise<string> {
  try {
    switch (action.action) {
      case 'take_snapshot':
      case 'take_enhanced_snapshot': {
        const state = await bc.getBrowserState();
        const enhanced = action.action === 'take_enhanced_snapshot';
        return formatSnapshot(state, enhanced);
      }

      case 'get_page_content':
      case 'extract': {
        const state = await bc.getBrowserState();
        return [
          `TITLE: ${state.title}`,
          `URL: ${state.url}`,
          '',
          state.visibleText.slice(0, 12000),
        ].join('\n');
      }

      case 'get_page_links': {
        const state = await bc.getBrowserState();
        const links = state.clickableElements
          .filter((entry) => entry.tag === 'a' || /https?:\/\//i.test(entry.selector))
          .slice(0, 120);

        if (links.length === 0) return 'No visible links found.';
        return links
          .map((entry, idx) => `${idx + 1}. ${entry.text || '(no text)'} -> ${entry.selector}`)
          .join('\n');
      }

      case 'get_dom': {
        const selector = String(action.target || '').trim() || undefined;
        const html = await bc.getDom(selector);
        return html || `No DOM content${selector ? ` for selector ${selector}` : ''}.`;
      }

      case 'search_dom': {
        const query = String(action.value || action.target || '').trim();
        const maybeLimit = Number(action.reason || '');
        const limit = Number.isFinite(maybeLimit) && maybeLimit > 0 ? maybeLimit : 25;
        return await bc.searchDom(query, limit);
      }

      case 'take_screenshot': {
        const image = await bc.getScreenshot();
        if (!image) return 'Screenshot capture failed.';
        const normalized = image.startsWith('data:image/')
          ? image
          : `data:image/jpeg;base64,${image}`;
        return normalized;
      }

      case 'evaluate_script': {
        const script = String(action.value || action.target || '').trim();
        return await bc.evaluateScript(script);
      }

      case 'get_console_logs': {
        const options = parseConsoleLogOptions(action.value);
        if (action.target && !options.search) {
          options.search = action.target;
        }
        return await bc.getConsoleLogs(options);
      }

      case 'navigate_page': {
        const navAction = String(action.value || '').trim().toLowerCase();
        const navTarget = String(action.target || '').trim();

        if (navAction === 'back') {
          await bc.goBack();
          return 'Navigated back.';
        }
        if (navAction === 'forward') {
          await bc.goForward();
          return 'Navigated forward.';
        }
        if (navAction === 'reload' || navAction === 'refresh') {
          await bc.refresh();
          return 'Page reloaded.';
        }

        const nextUrl = navTarget || String(action.value || '').trim();
        if (!nextUrl) return 'navigate_page failed: missing URL.';
        await bc.navigate(nextUrl);
        return `Navigated to ${nextUrl}`;
      }

      case 'open_url':
        await bc.navigate(action.target || action.value);
        return `Navigated to ${action.target || action.value}`;

      case 'search':
        return await bc.search(action.value || action.target);

      case 'click': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'clickable');
        await bc.highlightElement(selector);
        return await bc.click(selector);
      }

      case 'click_at': {
        const point = parsePointSpec(action.target || action.value);
        if (!point) return 'click_at failed: expected coordinates like "120,340".';
        return await bc.clickAt(point.x, point.y);
      }

      case 'right_click': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'clickable');
        await bc.highlightElement(selector);
        return await bc.rightClick(selector);
      }

      case 'right_click_at': {
        const point = parsePointSpec(action.target || action.value);
        if (!point) return 'right_click_at failed: expected coordinates like "120,340".';
        return await bc.rightClickAt(point.x, point.y);
      }

      case 'fill':
      case 'type': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'input');
        await bc.highlightElement(selector);
        return await bc.typeText(selector, action.value || '');
      }

      case 'clear': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'input');
        await bc.highlightElement(selector);
        return await bc.typeText(selector, '');
      }

      case 'upload_file': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'input');
        await bc.highlightElement(selector);
        const uploadFiles = await loadUploadFilePayloads(action.value || action.reason);
        return await bc.uploadFiles(selector, uploadFiles);
      }

      case 'check': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'input');
        await bc.highlightElement(selector);
        return await bc.check(selector);
      }

      case 'uncheck': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'input');
        await bc.highlightElement(selector);
        return await bc.uncheck(selector);
      }

      case 'select_option': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'input');
        await bc.highlightElement(selector);
        return await bc.selectOption(selector, action.value);
      }

      case 'press_key': {
        const rawKey = String(action.value || action.target || '').trim();
        const key = rawKey.toLowerCase();
        if (!key || key === 'enter' || key === 'return') {
          return await bc.pressEnter();
        }
        // rawKey already declared
        let normalizedKey = rawKey;
        const keyLower = key;
        if (keyLower === 'tab') normalizedKey = 'Tab';
        else if (keyLower === 'escape' || keyLower === 'esc') normalizedKey = 'Escape';
        else if (keyLower === 'backspace') normalizedKey = 'Backspace';
        else if (keyLower === 'delete' || keyLower === 'del') normalizedKey = 'Delete';
        else if (keyLower === 'arrowup' || keyLower === 'up') normalizedKey = 'ArrowUp';
        else if (keyLower === 'arrowdown' || keyLower === 'down') normalizedKey = 'ArrowDown';
        else if (keyLower === 'arrowleft' || keyLower === 'left') normalizedKey = 'ArrowLeft';
        else if (keyLower === 'arrowright' || keyLower === 'right') normalizedKey = 'ArrowRight';
        else if (keyLower === 'space') normalizedKey = 'Space';
        return await bc.pressKey(normalizedKey);
      }

      case 'press_enter':
        return await bc.pressEnter();

      case 'focus': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'input');
        await bc.highlightElement(selector);
        return await bc.focus(selector);
      }

      case 'hover': {
        const selector = await resolveSelectorFromActionTarget(action.target, bc, 'clickable');
        await bc.highlightElement(selector);
        return await bc.hover(selector);
      }

      case 'hover_at': {
        const point = parsePointSpec(action.target || action.value);
        if (!point) return 'hover_at failed: expected coordinates like "120,340".';
        return await bc.hoverAt(point.x, point.y);
      }

      case 'scroll':
        return await bc.scroll(action.value || action.target || 'down');

      case 'drag': {
        const sourceSelector = await resolveSelectorFromActionTarget(action.target, bc, 'clickable');
        const targetSelector = await resolveSelectorFromActionTarget(action.value, bc, 'clickable');
        await bc.highlightElement(sourceSelector);
        return await bc.drag(sourceSelector, targetSelector);
      }

      case 'drag_at': {
        const sourceSelector = await resolveSelectorFromActionTarget(action.target, bc, 'clickable');
        const point = parsePointSpec(action.value);
        if (!point) return 'drag_at failed: expected value coordinates like "120,340".';
        await bc.highlightElement(sourceSelector);
        return await bc.dragAt(sourceSelector, point.x, point.y);
      }

      case 'summarize': {
        const state = await bc.getBrowserState();
        return `Page summary - Title: ${state.title}, URL: ${state.url}, Text preview: ${state.visibleText.slice(0, 1500)}`;
      }

      case 'run_skill': {
        const skillName = String(action.target || '').trim();
        const skillArgs = action.value || '';
        return await runSkill(skillName, bc, skillArgs);
      }

      case 'new_page':
      case 'new_tab': {
        const currentTabs = await bc.getTabs();
        const target = action.target || action.value || undefined;
        const tabId = await bc.newTab(target);
        return `Opened new tab: ${tabId} (${currentTabs.length + 1} active tabs)`;
      }

      case 'switch_tab':
        await bc.switchTab(action.target);
        return `Switched to tab: ${action.target}`;

      case 'close_page':
      case 'close_tab':
        await bc.closeTab(action.target);
        return `Closed tab: ${action.target}`;

      case 'list_pages': {
        const state = await bc.getBrowserState();
        if (!state.tabs.length) return 'No open pages.';
        return state.tabs
          .map((tab) => `${tab.active ? '->' : '  '} [${tab.id}] ${tab.title} (${tab.url})`)
          .join('\n');
      }

      case 'get_active_page': {
        const state = await bc.getBrowserState();
        const active = state.tabs.find((tab) => tab.active);
        if (!active) return 'No active page.';
        return `Active page: [${active.id}] ${active.title} (${active.url})`;
      }

      case 'get_bookmarks': {
        const bookmarks = getBookmarks();
        if (!bookmarks.length) return 'No bookmarks saved.';
        return bookmarks
          .map((entry) => `[${entry.id}] ${entry.title} (${entry.url}) - ${entry.folder}`)
          .join('\n');
      }

      case 'create_bookmark': {
        const state = await bc.getBrowserState();
        const bookmark = createBookmark({
          title: String(action.reason || state.title || action.target || action.value || '').trim(),
          url: String(action.target || action.value || state.url).trim(),
          folder: parseBookmarkFolder(action.reason),
        });
        return `Created bookmark [${bookmark.id}] ${bookmark.title} (${bookmark.url})`;
      }

      case 'remove_bookmark': {
        const bookmarkId = Number(action.target || action.value);
        if (!Number.isFinite(bookmarkId)) return 'remove_bookmark: missing bookmark id.';
        removeBookmark(bookmarkId);
        return `Removed bookmark ${bookmarkId}.`;
      }

      case 'update_bookmark': {
        const bookmarkId = Number(action.target);
        if (!Number.isFinite(bookmarkId)) return 'update_bookmark: missing bookmark id.';
        const updates = parseBookmarkUpdateSpec(action.value);
        const updated = updateBookmark(bookmarkId, updates);
        if (!updated) return `update_bookmark: bookmark ${bookmarkId} not found.`;
        return `Updated bookmark [${updated.id}] ${updated.title} (${updated.url})`;
      }

      case 'move_bookmark': {
        const bookmarkId = Number(action.target);
        const nextPosition = Number(action.value);
        if (!Number.isFinite(bookmarkId) || !Number.isFinite(nextPosition)) {
          return 'move_bookmark: expected target=id and value=position.';
        }
        const moved = updateBookmark(bookmarkId, {
          position: nextPosition,
          folder: parseBookmarkFolder(action.reason),
        });
        if (!moved) return `move_bookmark: bookmark ${bookmarkId} not found.`;
        return `Moved bookmark ${bookmarkId} to position ${nextPosition}.`;
      }

      case 'search_bookmarks': {
        const results = searchBookmarks(action.value || action.target);
        if (!results.length) return `No bookmarks matched "${action.value || action.target}".`;
        return results
          .map((entry) => `[${entry.id}] ${entry.title} (${entry.url}) - ${entry.folder}`)
          .join('\n');
      }

      case 'search_history':
      case 'get_recent_history': {
        const query = String(action.value || action.target || '').trim().toLowerCase();
        const history = getHistory(120);
        const filtered = query
          ? history.filter(
              (entry) =>
                entry.url.toLowerCase().includes(query) ||
                entry.title.toLowerCase().includes(query),
            )
          : history;
        if (!filtered.length) return query ? `No history matched "${query}".` : 'No browsing history.';
        return filtered
          .slice(0, 60)
          .map((entry) => `[${entry.id}] ${entry.title || entry.url} (${entry.url}) @ ${entry.visited_at}`)
          .join('\n');
      }

      case 'delete_history_url': {
        const url = String(action.target || action.value || '').trim();
        if (!url) return 'delete_history_url: missing URL.';
        deleteHistoryUrl(url);
        return `Deleted history entries for ${url}`;
      }

      case 'delete_history_range': {
        const { start, end } = parseHistoryDeleteRange(action.value || action.target);
        deleteHistoryRange(start, end);
        return `Deleted history range${start || end ? ` from ${start || '-infinity'} to ${end || '+infinity'}` : ''}.`;
      }

      case 'list_tab_groups': {
        const groups = await bc.listTabGroups();
        if (!groups.length) return 'No tab groups exist.';
        return groups
          .map((group) => `[${group.id}] ${group.title}${group.color ? ` (${group.color})` : ''} -> ${group.tabIds.join(', ')}`)
          .join('\n');
      }

      case 'group_tabs': {
        const parsed = parseTabGroupSpec(action.value);
        const fallbackIds = parseTabIdList(action.target);
        const activeTabId = bc.getActiveTabId();
        const tabIds = parsed.tabIds.length
          ? parsed.tabIds
          : fallbackIds.length
            ? fallbackIds
            : activeTabId
              ? [activeTabId]
              : [];
        if (!tabIds.length) return 'group_tabs: no tabs provided.';
        const group = await bc.groupTabs(tabIds, {
          id: parsed.id || undefined,
          title: parsed.title || String(action.reason || '').trim() || undefined,
          color: parsed.color || parseColorHint(action.reason) || undefined,
        });
        return `Created tab group [${group.id}] ${group.title} with tabs: ${group.tabIds.join(', ')}`;
      }

      case 'update_tab_group': {
        const parsed = parseTabGroupSpec(action.value);
        const groupId = String(action.target || parsed.id || '').trim();
        if (!groupId) return 'update_tab_group: missing group id.';
        const updated = await bc.updateTabGroup(groupId, {
          title: parsed.title || String(action.reason || '').trim() || undefined,
          color: parsed.color || parseColorHint(action.reason) || undefined,
        });
        if (!updated) return `update_tab_group: group ${groupId} not found.`;
        return `Updated tab group [${updated.id}] ${updated.title}${updated.color ? ` (${updated.color})` : ''}.`;
      }

      case 'ungroup_tabs': {
        const parsed = parseTabGroupSpec(action.value);
        const targetText = String(action.target || '').trim();
        const tabIds = parsed.tabIds.length ? parsed.tabIds : parseTabIdList(targetText);
        const inferredGroupId = parsed.id || (tabIds.length === 0 ? targetText : '');
        const removed = await bc.ungroupTabs(tabIds, inferredGroupId || undefined);
        if (!removed) return inferredGroupId
          ? `ungroup_tabs: group ${inferredGroupId} not found.`
          : 'ungroup_tabs: no matching grouped tabs found.';
        return `Ungrouped ${removed} tab${removed === 1 ? '' : 's'}.`;
      }

      case 'close_tab_group': {
        const groupId = String(action.target || action.value || '').trim();
        if (!groupId) return 'close_tab_group: missing group id.';
        const closed = await bc.closeTabGroup(groupId);
        if (!closed) return `close_tab_group: group ${groupId} not found.`;
        return `Closed ${closed} tab${closed === 1 ? '' : 's'} from group ${groupId}.`;
      }

      case 'save_pdf': {
        const state = await bc.getBrowserState();
        const pdfBase64 = await bc.getPdfData();
        if (!pdfBase64) return 'save_pdf failed: PDF capture unavailable.';
        const filePath = await writeAgentArtifactBuffer(
          pdfBase64,
          'pdf',
          parseArtifactHint(action.value || action.reason),
          state.title || 'page',
        );
        return `Saved PDF to ${filePath}`;
      }

      case 'save_screenshot': {
        const state = await bc.getBrowserState();
        const image = await bc.getScreenshot();
        if (!image) return 'save_screenshot failed: screenshot capture unavailable.';
        const filePath = await writeAgentArtifactBuffer(
          image,
          'png',
          parseArtifactHint(action.value || action.reason),
          state.title || 'screenshot',
        );
        return `Saved screenshot to ${filePath}`;
      }

      case 'download_file': {
        const request = parseDownloadRequest(action.target, action.value, action.reason);
        const state = await bc.getBrowserState();
        const url = request.url || state.url;
        if (!url) return 'download_file: missing URL.';
        const filePath = await downloadUrlWithWindowSession(getWindow, url, request.filename);
        return `Downloaded file to ${filePath}`;
      }

      case 'list_workflows': {
        const workflows = getWorkflows();
        const schedules = getWorkflowSchedules();
        if (!workflows.length) return 'No workflows saved.';
        return workflows
          .map((workflow) => {
            const schedule = schedules.find((entry) => entry.workflow_id === workflow.id);
            const scheduleBits = schedule
              ? [
                  schedule.enabled ? 'enabled' : 'paused',
                  schedule.rrule,
                  schedule.next_run_at ? `next ${schedule.next_run_at}` : '',
                ].filter(Boolean).join(' | ')
              : 'no schedule';
            return `[${workflow.id}] ${workflow.title} - ${scheduleBits}\n${workflow.task_prompt}`;
          })
          .join('\n\n');
      }

      case 'save_workflow': {
        const spec = parseWorkflowSaveSpec(action.target, action.value, action.reason);
        const workflowId = saveWorkflow({
          id: spec.id || undefined,
          title: spec.title,
          task_prompt: spec.taskPrompt,
          notes: spec.notes,
        });
        if (spec.rrule) {
          const existingSchedule = getWorkflowSchedules(workflowId)[0];
          saveWorkflowSchedule({
            id: existingSchedule?.id,
            workflow_id: workflowId,
            rrule: spec.rrule,
            enabled: spec.enabled,
            next_run_at: existingSchedule?.next_run_at,
            last_run_at: existingSchedule?.last_run_at,
          });
        }
        return `Saved workflow ${workflowId}${spec.rrule ? ` with schedule ${spec.rrule}` : ''}.`;
      }

      case 'delete_workflow': {
        const workflowId = Number(action.target || action.value);
        if (!Number.isFinite(workflowId)) return 'delete_workflow: missing workflow id.';
        deleteWorkflow(workflowId);
        return `Deleted workflow ${workflowId}.`;
      }

      case 'list_saved_credentials': {
        const credentials = getSavedCredentials();
        if (!credentials.length) return 'No saved credentials.';
        return credentials
          .map((entry) =>
            `[${entry.id}] ${entry.domain} | ${entry.username || 'no username'} | password ${entry.has_password ? 'saved' : 'missing'}${entry.last_used_at ? ` | last used ${entry.last_used_at}` : ''}${entry.notes ? ` | ${entry.notes}` : ''}`,
          )
          .join('\n');
      }

      case 'save_saved_credential': {
        const spec = parseCredentialSaveSpec(action.target, action.value, action.reason);
        const saved = saveSavedCredential(spec);
        return `Saved credential [${saved.id}] for ${saved.domain}${saved.username ? ` (${saved.username})` : ''}.`;
      }

      case 'delete_saved_credential': {
        const credentialId = Number(action.target || action.value);
        if (!Number.isFinite(credentialId)) return 'delete_saved_credential: missing credential id.';
        deleteSavedCredential(credentialId);
        return `Deleted saved credential ${credentialId}.`;
      }

      case 'list_autofill_profiles': {
        const profiles = getAutofillProfiles();
        if (!profiles.length) return 'No autofill profiles.';
        return profiles
          .map((profile) =>
            `[${profile.id}] ${profile.label}${profile.full_name ? ` | ${profile.full_name}` : ''}${profile.email ? ` | ${profile.email}` : ''}${profile.phone ? ` | ${profile.phone}` : ''}`,
          )
          .join('\n');
      }

      case 'save_autofill_profile': {
        const spec = parseAutofillProfileSaveSpec(action.target, action.value, action.reason);
        const saved = saveAutofillProfile(spec);
        return `Saved autofill profile [${saved.id}] ${saved.label}.`;
      }

      case 'delete_autofill_profile': {
        const profileId = Number(action.target || action.value);
        if (!Number.isFinite(profileId)) return 'delete_autofill_profile: missing profile id.';
        deleteAutofillProfile(profileId);
        return `Deleted autofill profile ${profileId}.`;
      }

      case 'discover_server_categories_or_actions': {
        const request = parseIntegrationRequest(action.target, action.value);
        const tools = await strata.discoverTools(request.appName || '');
        if (!tools || !tools.length) {
          return request.appName
            ? `No integration tools found for ${request.appName}.`
            : 'No integration tools found.';
        }
        return tools
          .map((tool: any) => `${request.appName} :: ${tool.name} - ${tool.description || ''}`.trim())
          .join('\n');
      }

      case 'execute_action': {
        const request = parseIntegrationActionExecution(action.target, action.value, action.reason);
        if (!request.appName || !request.action) {
          return 'execute_action: expected appName and action.';
        }
        const result = await strata.executeAction(
          request.appName,
          request.action,
          request.params || {},
        );
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      }

      case 'search_documentation': {
        const request = parseIntegrationRequest(action.target, action.value);
        // Use discoverTools for all connected apps as documentation search
        const allApps = strata.listAvailableApps();
        const results: string[] = [];
        const queryLower = (request.query || request.appName || '').toLowerCase();
        
        for (const appName of allApps) {
          if (appName.toLowerCase().includes(queryLower)) {
            results.push(`${appName} - Available app`);
          }
        }
        
        if (!results.length) return `No apps matched "${queryLower}".`;
        return results.join('\n');
      }

      case 'suggest_schedule': {
        const schedule = suggestSchedule(action.value || action.target || action.reason);
        return JSON.stringify(schedule, null, 2);
      }

      case 'filesystem_read': {
        const filePath = resolveWorkspacePath(action.target || action.value);
        const content = await fs.readFile(filePath, 'utf-8');
        return content.slice(0, 20000);
      }

      case 'filesystem_write': {
        const filePath = resolveWorkspacePath(action.target);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, String(action.value || ''), 'utf-8');
        return `Wrote ${String(action.value || '').length} chars to ${filePath}`;
      }

      case 'filesystem_edit': {
        const filePath = resolveWorkspacePath(action.target);
        const source = await fs.readFile(filePath, 'utf-8');
        const editSpec = parseFilesystemEditSpec(action.value);
        const hasNeedle = source.includes(editSpec.search);
        if (!hasNeedle) {
          return `filesystem_edit: search string not found in ${filePath}`;
        }
        const next = editSpec.all
          ? source.split(editSpec.search).join(editSpec.replace)
          : source.replace(editSpec.search, editSpec.replace);
        await fs.writeFile(filePath, next, 'utf-8');
        return `Edited ${filePath} (${editSpec.all ? 'all matches' : 'first match'}).`;
      }

      case 'filesystem_bash': {
        const spec = parseFilesystemBashSpec(action.target, action.value, action.reason);
        const result = await runWorkspaceShellCommand(spec.command, spec.cwd, spec.timeoutMs);
        return formatShellResult(result.stdout, result.stderr);
      }

      case 'filesystem_ls': {
        const dirPath = resolveWorkspacePath(action.target || '.');
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries
          .slice(0, 300)
          .map((entry) => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`)
          .join('\n');
      }

      case 'filesystem_find': {
        const pattern = String(action.value || action.target || '').trim().toLowerCase();
        if (!pattern) return 'filesystem_find: missing pattern.';
        const base = resolveWorkspacePath('.');
        const hits = await walkWorkspace(base, (fullPath) =>
          path.basename(fullPath).toLowerCase().includes(pattern),
        );
        if (!hits.length) return `No files matched "${pattern}".`;
        return hits.slice(0, 200).join('\n');
      }

      case 'filesystem_grep': {
        const query = String(action.value || action.target || '').trim().toLowerCase();
        if (!query) return 'filesystem_grep: missing query.';
        const base = resolveWorkspacePath('.');
        const hits = await walkWorkspace(base, async (fullPath) => {
          try {
            const body = await fs.readFile(fullPath, 'utf-8');
            return body.toLowerCase().includes(query);
          } catch {
            return false;
          }
        });
        if (!hits.length) return `No files contain "${query}".`;
        return hits.slice(0, 120).join('\n');
      }

      case 'memory_search': {
        const query = action.value || action.target;
        const hits = await searchMarkdownMemory(query);
        if (!hits.length) return `No memory entries matched "${query}".`;
        return hits
          .slice(0, 20)
          .map((hit) => `[${hit.kind}] ${hit.file}\n${hit.snippet}`)
          .join('\n\n');
      }

      case 'memory_write': {
        const title = String(action.target || 'Agent Note').trim();
        const content = String(action.value || '').trim();
        if (!content) return 'memory_write: empty content.';
        const savedPath = await writeDailyMemoryEntry(content, title);
        return `Saved memory note to ${savedPath}`;
      }

      case 'memory_read_core':
        return await readCore();

      case 'memory_update_core': {
        const parsed = parseMemoryUpdateSpec(action.value);
        if (!parsed.additions.length && !parsed.removals.length) {
          return 'memory_update_core: no additions or removals provided.';
        }
        await updateCoreMemory(parsed.additions, parsed.removals);
        return `Updated CORE memory (+${parsed.additions.length}, -${parsed.removals.length}).`;
      }

      case 'soul_read':
        return await readSoul();

      case 'soul_update': {
        const content = String(action.value || action.target || '').trim();
        if (!content) return 'soul_update: empty content.';
        await updateSoulMemory(content);
        return 'SOUL.md updated.';
      }

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

      // ── AI High-Level Commands (Skyvern-style) ───────────────────
      case 'act': {
        if (!openRouterOpts?.apiKey) return 'act() failed: no API key configured';
        const prompt = String(action.value || action.target || '').trim();
        if (!prompt) return 'act() failed: missing instruction in value or target';
        return await aiAct(bc, openRouterOpts, prompt);
      }

      case 'extract': {
        if (!openRouterOpts?.apiKey) return 'extract() failed: no API key configured';
        const prompt = String(action.value || action.target || '').trim();
        let schema: Record<string, unknown> | undefined;
        try {
          if (action.target && action.value && action.target !== action.value) {
            schema = JSON.parse(action.target);
          }
        } catch {}
        return await aiExtract(bc, openRouterOpts, prompt, schema);
      }

      case 'validate': {
        if (!openRouterOpts?.apiKey) return 'validate() failed: no API key configured';
        const prompt = String(action.value || action.target || '').trim();
        if (!prompt) return 'validate() failed: missing question in value or target';
        return await aiValidate(bc, openRouterOpts, prompt);
      }

      default:
        return `Unknown action: ${action.action}`;
    }
  } catch (err: any) {
    return `Action failed: ${err.message}`;
  }
}

async function resolveSelectorFromActionTarget(
  rawTarget: string,
  bc: AgentAutomationController,
  preference: 'clickable' | 'input',
): Promise<string> {
  const target = String(rawTarget || '').trim();
  if (!target) {
    throw new Error('missing selector/element id target');
  }

  if (/^[~!@#$%^&*()_\-+=[\]][A-Za-z0-9_]+$/.test(target)) {
    return `[unique_id="${target}"]`;
  }

  if (looksLikeSelector(target)) {
    return target;
  }

  const state = await bc.getBrowserState();
  const clickable = state.clickableElements || [];
  const inputs = state.inputFields || [];

  // Robust check: if target is mapped as a unique_id selector in the state, return it directly
  const allSelectors = [...clickable.map(e => e.selector), ...inputs.map(e => e.selector)];
  const exactMatch = allSelectors.find(sel => sel === `[unique_id="${target}"]` || sel === target);
  if (exactMatch) {
    return `[unique_id="${target}"]`;
  }

  const idMatch = target.match(/^([ci])(\d+)$/i);
  if (idMatch) {
    const idx = Math.max(0, Number(idMatch[2]) - 1);
    if (idMatch[1].toLowerCase() === 'c') {
      const entry = clickable[idx];
      if (entry?.selector) return entry.selector;
    }
    if (idMatch[1].toLowerCase() === 'i') {
      const entry = inputs[idx];
      if (entry?.selector) return entry.selector;
    }
  }

  if (/^\d+$/.test(target)) {
    const idx = Math.max(0, Number(target) - 1);
    if (preference === 'input' && inputs[idx]?.selector) return inputs[idx].selector;
    if (preference === 'clickable' && clickable[idx]?.selector) return clickable[idx].selector;
    const merged = [...clickable.map((e) => e.selector), ...inputs.map((e) => e.selector)];
    if (merged[idx]) return merged[idx];
  }

  const byText = clickable.find((entry) => entry.text?.toLowerCase().includes(target.toLowerCase()));
  if (byText?.selector) return byText.selector;

  if (preference === 'clickable' && target.length <= 80) {
    const safeText = target.replace(/"/g, '\\"');
    return `text="${safeText}"`;
  }

  throw new Error(`could not resolve target "${target}" to a selector`);
}

function looksLikeSelector(target: string): boolean {
  return (
    target.startsWith('#') ||
    target.startsWith('.') ||
    target.startsWith('[') ||
    target.startsWith('//') ||
    target.startsWith('text=') ||
    target.includes('[') ||
    target.includes('>') ||
    target.includes(':') ||
    /^[~!@#$%^&*()_\-+=[\]]/.test(target)
  );
}

function formatSnapshot(state: any, enhanced = false): string {
  const clickable = (state.clickableElements || []).slice(0, enhanced ? 120 : 80);
  const inputs = (state.inputFields || []).slice(0, enhanced ? 40 : 20);

  const clickableLines = clickable.length
    ? clickable.map((entry: any, idx: number) => `[C${idx + 1}] ${entry.text || '(no text)'} -> ${entry.selector}`)
    : ['(none)'];
  const inputLines = inputs.length
    ? inputs.map((entry: any, idx: number) => `[I${idx + 1}] ${entry.label || entry.placeholder || '(unnamed)'} -> ${entry.selector}`)
    : ['(none)'];

  return [
    `SNAPSHOT ${enhanced ? '(enhanced)' : ''}`.trim(),
    `TITLE: ${state.title || ''}`,
    `URL: ${state.url || ''}`,
    '',
    'PRUNED DOM TREE LAYOUT:',
    state.prunedDomTree || '(none)',
    '',
    'CLICKABLE:',
    ...clickableLines,
    '',
    'INPUTS:',
    ...inputLines,
  ].join('\n');
}

function resolveWorkspacePath(rawPath: string): string {
  const workspaceRoot = path.resolve(process.cwd());
  const requested = String(rawPath || '').trim() || '.';
  const resolved = path.resolve(workspaceRoot, requested);

  const normalizedRoot = workspaceRoot.toLowerCase();
  const normalizedResolved = resolved.toLowerCase();
  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`path outside workspace is not allowed: ${requested}`);
  }
  return resolved;
}

type FileMatchPredicate = (fullPath: string) => boolean | Promise<boolean>;

async function walkWorkspace(
  baseDir: string,
  predicate: FileMatchPredicate,
  maxResults = 400,
): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [baseDir];

  while (queue.length > 0 && out.length < maxResults) {
    const current = queue.shift()!;
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = (await fs.readdir(current, { withFileTypes: true })) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (out.length >= maxResults) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        queue.push(fullPath);
        continue;
      }

      const matched = await predicate(fullPath);
      if (matched) out.push(fullPath);
    }
  }

  return out;
}

function parseFilesystemEditSpec(rawValue: string): { search: string; replace: string; all: boolean } {
  const text = String(rawValue || '').trim();
  if (!text) throw new Error('filesystem_edit: missing edit instructions');

  try {
    const parsed = JSON.parse(text);
    const search = String(parsed?.search || '');
    const replace = String(parsed?.replace || '');
    const all = !!parsed?.all;
    if (!search) throw new Error('filesystem_edit JSON requires "search"');
    return { search, replace, all };
  } catch {
    const sepIndex = text.indexOf('=>');
    if (sepIndex < 0) {
      throw new Error('filesystem_edit expects JSON {search,replace,all} or "search => replace"');
    }
    const search = text.slice(0, sepIndex).trim();
    const replace = text.slice(sepIndex + 2).trim();
    if (!search) throw new Error('filesystem_edit: empty search text');
    return { search, replace, all: false };
  }
}

function parseMemoryUpdateSpec(rawValue: string): { additions: string[]; removals: string[] } {
  const text = String(rawValue || '').trim();
  if (!text) return { additions: [], removals: [] };

  try {
    const parsed = JSON.parse(text);
    const additions = Array.isArray(parsed?.additions)
      ? parsed.additions.map((entry: unknown) => String(entry).trim()).filter(Boolean)
      : [];
    const removals = Array.isArray(parsed?.removals)
      ? parsed.removals.map((entry: unknown) => String(entry).trim()).filter(Boolean)
      : [];
    return { additions, removals };
  } catch {
    return { additions: [text], removals: [] };
  }
}

function parseConsoleLogOptions(rawValue: string): {
  clear?: boolean;
  level?: string;
  limit?: number;
  search?: string;
} {
  const text = String(rawValue || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    const options: { clear?: boolean; level?: string; limit?: number; search?: string } = {};
    if (typeof parsed?.clear === 'boolean') options.clear = parsed.clear;
    if (typeof parsed?.level === 'string') options.level = parsed.level;
    if (typeof parsed?.search === 'string') options.search = parsed.search;
    if (Number.isFinite(Number(parsed?.limit))) options.limit = Number(parsed.limit);
    return options;
  } catch {
    return { search: text };
  }
}

function parseTaskInput(
  taskInput: string | AgentRunRequest,
): {
  task: string;
  sessionId?: number;
  attachments: AgentAttachment[];
  contextMessages: string[];
  isChatMode: boolean;
  workflowId?: number;
  workflowRunId?: number;
  workflowOrigin?: 'manual' | 'scheduled' | 'retry';
} {
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
  return {
    task,
    sessionId,
    attachments,
    contextMessages,
    isChatMode,
    workflowId: Number(taskInput?.workflowId || 0) || undefined,
    workflowRunId: Number(taskInput?.workflowRunId || 0) || undefined,
    workflowOrigin: taskInput?.workflowOrigin || undefined,
  };
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

async function enrichFinalAnswerWithPageContext(
  taskText: string,
  finalMessage: string,
  bc: AgentAutomationController,
): Promise<string> {
  const task = String(taskText || '').toLowerCase();
  const asksWhichPage =
    /what\s+page\s+(am\s+i|i\s+am)\s+on/.test(task) ||
    /which\s+page\s+(am\s+i|i\s+am)\s+on/.test(task) ||
    /tell\s+me\s+what\s+page/.test(task) ||
    /current\s+page/.test(task);
  if (!asksWhichPage) return finalMessage;

  const alreadyHasUrl = /https?:\/\//i.test(finalMessage);
  const alreadyHasPageLine = /\b(url|title|page)\b/i.test(finalMessage);
  if (alreadyHasUrl && alreadyHasPageLine) return finalMessage;

  try {
    const state = await bc.getBrowserState();
    const title = String(state?.title || '').trim() || '(no title)';
    const url = String(state?.url || '').trim() || '(unknown URL)';
    return `${finalMessage}\n\nCurrent page:\nTitle: ${title}\nURL: ${url}`;
  } catch {
    return finalMessage;
  }
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

function shouldMarkSiteBlocked(result: string): boolean {
  const text = String(result || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('access denied') ||
    text.includes('403') ||
    text.includes('captcha') ||
    text.includes('site blocked') ||
    text.includes('forbidden') ||
    text.includes('login required') ||
    text.includes('unauthorized')
  );
}

function parseBookmarkFolder(reason: string): string | undefined {
  const text = String(reason || '').trim();
  if (!text) return undefined;
  const match = text.match(/folder\s*[:=]\s*([^\n,;]+)/i);
  return match?.[1]?.trim();
}

function parseBookmarkUpdateSpec(raw: string): {
  title?: string;
  url?: string;
  folder?: string;
  position?: number;
} {
  const text = String(raw || '').trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, unknown> = {};
      if ('title' in parsed) out.title = String((parsed as any).title || '');
      if ('url' in parsed) out.url = String((parsed as any).url || '');
      if ('folder' in parsed) out.folder = String((parsed as any).folder || '');
      if ('position' in parsed && Number.isFinite(Number((parsed as any).position))) {
        out.position = Number((parsed as any).position);
      }
      return out;
    }
  } catch {
    // Fall back to key=value parsing.
  }

  const out: Record<string, unknown> = {};
  for (const segment of text.split(/[,\n]/)) {
    const [rawKey, ...rest] = segment.split('=');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (!value) continue;
    if (key === 'title' || key === 'url' || key === 'folder') out[key] = value;
    if (key === 'position' && Number.isFinite(Number(value))) out.position = Number(value);
  }
  return out;
}

function parseHistoryDeleteRange(raw: string): { start?: string; end?: string } {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return {
        start: (parsed as any).start ? String((parsed as any).start) : undefined,
        end: (parsed as any).end ? String((parsed as any).end) : undefined,
      };
    }
  } catch {
    // Fall back to a simple "start|end" format.
  }

  const [start, end] = text.split('|').map((part) => part.trim());
  return {
    start: start || undefined,
    end: end || undefined,
  };
}

function parsePointSpec(raw: string): { x: number; y: number } | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*[,x]\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function parsePathList(raw: string): string[] {
  return String(raw || '')
    .split(/[\n,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function loadUploadFilePayloads(raw: string): Promise<Array<{ path: string; name: string; mimeType: string; data: string }>> {
  const text = String(raw || '').trim();
  if (!text) throw new Error('upload_file: missing file path.');

  let requestedPaths = parsePathList(text);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      requestedPaths = parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
    } else if (parsed && typeof parsed === 'object') {
      const paths = Array.isArray((parsed as any).paths)
        ? (parsed as any).paths.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
        : [];
      requestedPaths = paths.length ? paths : parsePathList(String((parsed as any).path || ''));
    }
  } catch {
    // Plain path list.
  }

  if (!requestedPaths.length) throw new Error('upload_file: no file paths provided.');

  const out: Array<{ path: string; name: string; mimeType: string; data: string }> = [];
  let totalBytes = 0;
  for (const rawPath of requestedPaths.slice(0, 3)) {
    const resolved = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(process.cwd(), rawPath);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error(`upload_file: not a file: ${resolved}`);
    if (stat.size > 8 * 1024 * 1024) throw new Error(`upload_file: file too large (>8MB): ${resolved}`);
    totalBytes += stat.size;
    if (totalBytes > 12 * 1024 * 1024) throw new Error('upload_file: combined upload payload too large (>12MB).');
    const bytes = await fs.readFile(resolved);
    out.push({
      path: resolved,
      name: path.basename(resolved),
      mimeType: inferMimeType(resolved),
      data: bytes.toString('base64'),
    });
  }
  return out;
}

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function parseTabIdList(raw: string): string[] {
  return String(raw || '')
    .split(/[\s,\n]+/)
    .map((part) => part.trim())
    .filter((part) => !!part);
}

function parseFilesystemBashSpec(target: string, value: string, reason: string): {
  command: string;
  cwd?: string;
  timeoutMs: number;
} {
  const rawTarget = String(target || '').trim();
  const rawValue = String(value || '').trim();
  const primary = String(rawValue || rawTarget || '').trim();
  if (!primary) throw new Error('filesystem_bash: missing command.');

  const fallbackTimeout = 30000;
  const fallbackCwd = rawTarget && rawValue ? rawTarget : undefined;

  try {
    const parsed = JSON.parse(primary);
    if (parsed && typeof parsed === 'object') {
      const command = String((parsed as any).command || '').trim();
      if (!command) throw new Error('filesystem_bash JSON requires "command".');
      const cwd = (parsed as any).cwd ? String((parsed as any).cwd).trim() : fallbackCwd;
      const timeoutMsRaw = Number((parsed as any).timeoutMs || (parsed as any).timeout || fallbackTimeout);
      return {
        command,
        cwd,
        timeoutMs: Number.isFinite(timeoutMsRaw) ? Math.max(1000, Math.min(120000, timeoutMsRaw)) : fallbackTimeout,
      };
    }
  } catch {
    // Plain command string.
  }

  return {
    command: primary,
    cwd: fallbackCwd,
    timeoutMs: fallbackTimeout,
  };
}

function parseWorkflowSaveSpec(target: string, value: string, reason: string): {
  id?: number;
  title: string;
  taskPrompt: string;
  notes?: string;
  rrule?: string;
  enabled?: boolean;
} {
  const raw = String(value || '').trim();
  const fallbackTitle = String(target || '').trim();
  const fallbackNotes = String(reason || '').trim();
  if (!raw) {
    return {
      title: fallbackTitle || 'Untitled Workflow',
      taskPrompt: fallbackNotes || fallbackTitle || 'Continue the saved browser workflow.',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      id: Number((parsed as any)?.id || 0) || undefined,
      title: String((parsed as any)?.title || fallbackTitle || 'Untitled Workflow').trim(),
      taskPrompt: String((parsed as any)?.task_prompt || (parsed as any)?.taskPrompt || '').trim() || fallbackNotes || fallbackTitle,
      notes: String((parsed as any)?.notes || fallbackNotes || '').trim() || undefined,
      rrule: String((parsed as any)?.rrule || '').trim() || undefined,
      enabled: typeof (parsed as any)?.enabled === 'boolean' ? !!(parsed as any).enabled : true,
    };
  } catch {
    return {
      title: fallbackTitle || 'Untitled Workflow',
      taskPrompt: raw,
      notes: fallbackNotes || undefined,
    };
  }
}

function parseCredentialSaveSpec(
  target: string,
  value: string,
  reason: string,
): { id?: number; domain: string; username?: string; password?: string; notes?: string } {
  const domainFallback = String(target || '').trim();
  const valueText = String(value || '').trim();
  const notesFallback = String(reason || '').trim();
  try {
    const parsed = JSON.parse(valueText || '{}');
    const domain = String((parsed as any)?.domain || domainFallback).trim();
    if (!domain) throw new Error('missing domain');
    return {
      id: Number((parsed as any)?.id || 0) || undefined,
      domain,
      username: String((parsed as any)?.username || '').trim() || undefined,
      password: Object.prototype.hasOwnProperty.call(parsed || {}, 'password')
        ? String((parsed as any)?.password || '')
        : undefined,
      notes: String((parsed as any)?.notes || notesFallback || '').trim() || undefined,
    };
  } catch {
    const [username, password, ...noteParts] = valueText.split('|').map((entry) => entry.trim());
    if (!domainFallback) {
      throw new Error('save_saved_credential expects target=domain and value=username|password|notes, or JSON.');
    }
    return {
      domain: domainFallback,
      username: username || undefined,
      password: password || undefined,
      notes: noteParts.join(' | ') || notesFallback || undefined,
    };
  }
}

function parseAutofillProfileSaveSpec(
  target: string,
  value: string,
  reason: string,
): {
  id?: number;
  label: string;
  full_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
} {
  const fallbackLabel = String(target || '').trim() || 'Default';
  const raw = String(value || '').trim();
  try {
    const parsed = JSON.parse(raw || '{}');
    return {
      id: Number((parsed as any)?.id || 0) || undefined,
      label: String((parsed as any)?.label || fallbackLabel).trim() || 'Default',
      full_name: String((parsed as any)?.full_name || (parsed as any)?.fullName || '').trim() || undefined,
      email: String((parsed as any)?.email || '').trim() || undefined,
      phone: String((parsed as any)?.phone || '').trim() || undefined,
      company: String((parsed as any)?.company || '').trim() || undefined,
      address_line1: String((parsed as any)?.address_line1 || '').trim() || undefined,
      address_line2: String((parsed as any)?.address_line2 || '').trim() || undefined,
      city: String((parsed as any)?.city || '').trim() || undefined,
      state: String((parsed as any)?.state || '').trim() || undefined,
      postal_code: String((parsed as any)?.postal_code || '').trim() || undefined,
      country: String((parsed as any)?.country || '').trim() || undefined,
    };
  } catch {
    return {
      label: fallbackLabel,
      full_name: raw || String(reason || '').trim() || undefined,
    };
  }
}

function parseIntegrationRequest(target: string, value: string): { appName?: string; query?: string } {
  const rawTarget = String(target || '').trim();
  const rawValue = String(value || '').trim();
  const merged = rawValue || rawTarget;
  if (!merged) return {};

  try {
    const parsed = JSON.parse(merged);
    if (parsed && typeof parsed === 'object') {
      return {
        appName: (parsed as any).appName ? String((parsed as any).appName).trim() : undefined,
        query: (parsed as any).query ? String((parsed as any).query).trim() : undefined,
      };
    }
  } catch {
    // Plain text.
  }

  if (rawTarget && rawValue) return { appName: rawTarget, query: rawValue };
  return { query: merged };
}

function parseIntegrationActionExecution(target: string, value: string, reason: string): {
  appName?: string;
  category?: string;
  action?: string;
  params: Record<string, unknown>;
} {
  const raw = String(value || '').trim() || String(target || '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        appName: (parsed as any).appName ? String((parsed as any).appName).trim() : undefined,
        category: (parsed as any).category ? String((parsed as any).category).trim() : undefined,
        action: (parsed as any).action ? String((parsed as any).action).trim() : undefined,
        params: (parsed as any).params && typeof (parsed as any).params === 'object'
          ? { ...(parsed as any).params }
          : {},
      };
    }
  } catch {
    // Fall back to delimited text.
  }

  const appName = String(target || '').trim() || undefined;
  const [category, actionName] = String(value || '').split('/').map((part) => part.trim());
  return {
    appName,
    category: category || 'connection',
    action: actionName || category || undefined,
    params: reason ? { note: reason } : {},
  };
}

function parseColorHint(raw: string): string | undefined {
  const text = String(raw || '').trim();
  if (!text) return undefined;
  const match = text.match(/color\s*[:=]\s*([a-z0-9#_-]+)/i);
  return match?.[1]?.trim() || undefined;
}

async function runWorkspaceShellCommand(
  command: string,
  cwdHint?: string,
  timeoutMs = 30000,
): Promise<{ stdout: string; stderr: string }> {
  const cwd = cwdHint ? resolveWorkspacePath(cwdHint) : resolveWorkspacePath('.');
  const { stdout, stderr } = await execAsync(`powershell -NoProfile -Command ${JSON.stringify(command)}`, {
    cwd,
    timeout: Math.max(1000, Math.min(120000, timeoutMs)),
    maxBuffer: 1024 * 1024 * 4,
    windowsHide: true,
  });
  return {
    stdout: String(stdout || ''),
    stderr: String(stderr || ''),
  };
}

function formatShellResult(stdout: string, stderr: string): string {
  const parts: string[] = [];
  const out = String(stdout || '').trim();
  const err = String(stderr || '').trim();
  if (out) parts.push(out.slice(0, 20000));
  if (err) parts.push(`STDERR:\n${err.slice(0, 12000)}`);
  return parts.join('\n\n') || 'Command completed with no output.';
}

function suggestSchedule(raw: string): {
  summary: string;
  cadence: string;
  time?: string;
  weekdays?: string[];
  interval?: number;
} {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) {
    return { summary: 'Run daily at 09:00 local time.', cadence: 'daily', time: '09:00' };
  }

  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let time = '09:00';
  if (timeMatch) {
    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] || '0');
    const meridiem = String(timeMatch[3] || '').toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  if (/weekday|weekdays|every workday/.test(text)) {
    return {
      summary: `Run every weekday at ${time} local time.`,
      cadence: 'weekly',
      weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'],
      time,
    };
  }

  const hourly = text.match(/every\s+(\d+)\s+hour/);
  if (hourly) {
    const interval = Math.max(1, Number(hourly[1]));
    return {
      summary: `Run every ${interval} hour${interval === 1 ? '' : 's'}.`,
      cadence: 'hourly',
      interval,
    };
  }

  const daily = text.match(/every\s+(\d+)\s+day/);
  if (daily) {
    const interval = Math.max(1, Number(daily[1]));
    return {
      summary: `Run every ${interval} day${interval === 1 ? '' : 's'} at ${time} local time.`,
      cadence: 'daily',
      interval,
      time,
    };
  }

  if (/weekly|every week/.test(text)) {
    return {
      summary: `Run weekly at ${time} local time.`,
      cadence: 'weekly',
      weekdays: ['MO'],
      time,
    };
  }

  return {
    summary: `Run daily at ${time} local time.`,
    cadence: 'daily',
    time,
  };
}

function parseTabGroupSpec(raw: string): {
  id?: string;
  title?: string;
  color?: string;
  tabIds: string[];
} {
  const text = String(raw || '').trim();
  if (!text) return { tabIds: [] };

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const tabIds = Array.isArray((parsed as any).tabIds)
        ? (parsed as any).tabIds.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
        : [];
      return {
        id: (parsed as any).id ? String((parsed as any).id).trim() : undefined,
        title: (parsed as any).title ? String((parsed as any).title).trim() : undefined,
        color: (parsed as any).color ? String((parsed as any).color).trim() : undefined,
        tabIds,
      };
    }
  } catch {
    // Fall back to key=value parsing.
  }

  const out: { id?: string; title?: string; color?: string; tabIds: string[] } = { tabIds: [] };
  for (const segment of text.split(/[\n;]/)) {
    const [rawKey, ...rest] = segment.split('=');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (!value) continue;
    if (key === 'id') out.id = value;
    if (key === 'title' || key === 'name') out.title = value;
    if (key === 'color') out.color = value;
    if (key === 'tabs' || key === 'tabids' || key === 'tab_ids') out.tabIds = parseTabIdList(value);
  }
  return out;
}

function parseArtifactHint(raw: string): { filename?: string } {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return {
        filename: (parsed as any).filename
          ? String((parsed as any).filename).trim()
          : (parsed as any).path
            ? path.basename(String((parsed as any).path))
            : undefined,
      };
    }
  } catch {
    // Fall back to plain text.
  }
  return { filename: text };
}

function parseDownloadRequest(target: string, value: string, reason: string): { url?: string; filename?: string } {
  const parts = [String(target || '').trim(), String(value || '').trim(), String(reason || '').trim()].filter(Boolean);
  for (const part of parts) {
    try {
      const parsed = JSON.parse(part);
      if (parsed && typeof parsed === 'object') {
        return {
          url: (parsed as any).url ? String((parsed as any).url).trim() : undefined,
          filename: (parsed as any).filename ? String((parsed as any).filename).trim() : undefined,
        };
      }
    } catch {
      if (/^https?:\/\//i.test(part)) {
        return { url: part };
      }
    }
  }
  const hint = parseArtifactHint(value || reason);
  return {
    url: /^https?:\/\//i.test(String(target || '').trim()) ? String(target).trim() : undefined,
    filename: hint.filename,
  };
}

function sanitizeArtifactStem(raw: string, fallback: string): string {
  const source = String(raw || '').trim() || fallback;
  const cleaned = source
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

async function getAgentArtifactsDir(): Promise<string> {
  const dir = path.join(app.getPath('downloads'), 'Bron');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeAgentArtifactBuffer(
  rawData: string,
  extension: string,
  hint: { filename?: string },
  fallbackStem: string,
): Promise<string> {
  const dir = await getAgentArtifactsDir();
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  const preferredName = hint.filename ? path.basename(hint.filename) : '';
  const stem = sanitizeArtifactStem(preferredName ? preferredName.replace(/\.[^.]+$/, '') : fallbackStem, 'artifact');
  const fileName = preferredName
    ? (preferredName.toLowerCase().endsWith(ext.toLowerCase()) ? preferredName : `${preferredName}${ext}`)
    : `${stem}_${Date.now()}${ext}`;

  const base64 = rawData.startsWith('data:')
    ? rawData.slice(rawData.indexOf(',') + 1)
    : rawData;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

async function downloadUrlWithWindowSession(
  getWindow: (() => BrowserWindow | null) | undefined,
  url: string,
  filenameHint?: string,
): Promise<string> {
  const win = getWindow?.();
  if (!win || win.isDestroyed()) {
    throw new Error('download_file failed: browser window unavailable.');
  }

  const dir = await getAgentArtifactsDir();
  const session = win.webContents.session;
  const hintedName = filenameHint ? path.basename(filenameHint) : '';

  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`download_file timed out for ${url}`));
    }, 45000);

    const cleanup = () => {
      clearTimeout(timeout);
      session.removeListener('will-download', onWillDownload);
    };

    const onWillDownload = (_event: any, item: any) => {
      let urlBase = '';
      try {
        urlBase = path.basename(new URL(url).pathname);
      } catch {
        urlBase = '';
      }
      const candidate = hintedName || String(item?.getFilename?.() || '').trim() || urlBase || 'download.bin';
      const ext = path.extname(candidate || '') || '.bin';
      const fileName = `${sanitizeArtifactStem(candidate.replace(/\.[^.]+$/, ''), 'download')}${ext}`;
      const savePath = path.join(dir, fileName);
      item.setSavePath(savePath);
      item.once('done', (_doneEvent: any, state: string) => {
        cleanup();
        if (state === 'completed') {
          resolve(savePath);
          return;
        }
        reject(new Error(`download_file failed: ${state}`));
      });
    };

    session.on('will-download', onWillDownload);
    try {
      session.downloadURL(url);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
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
    take_snapshot: '[SNAP]',
    take_enhanced_snapshot: '[SNAP+]',
    get_page_content: '[READ]',
    get_page_links: '[LINKS]',
    get_dom: '[DOM]',
    search_dom: '[DOM?]',
    take_screenshot: '[SHOT]',
    evaluate_script: '[JS]',
    get_console_logs: '[LOGS]',
    navigate_page: '[NAV]',
    open_url: '[OPEN]',
    search: '[SEARCH]',
    click: '[CLICK]',
    click_at: '[CLICK@]',
    fill: '[FILL]',
    clear: '[CLEAR]',
    check: '[CHECK]',
    uncheck: '[UNCHECK]',
    select_option: '[SELECT]',
    upload_file: '[UPLOAD]',
    type: '[TYPE]',
    press_key: '[KEY]',
    press_enter: '[ENTER]',
    focus: '[FOCUS]',
    hover: '[HOVER]',
    hover_at: '[HOVER@]',
    scroll: '[SCROLL]',
    drag: '[DRAG]',
    drag_at: '[DRAG@]',
    extract: '[EXTRACT]',
    summarize: '[SUMMARIZE]',
    new_page: '[PAGE+]',
    close_page: '[PAGE-]',
    list_pages: '[PAGES]',
    get_active_page: '[ACTIVE]',
    new_tab: '[TAB+]',
    switch_tab: '[TAB]',
    close_tab: '[TAB-]',
    filesystem_read: '[FS-R]',
    filesystem_write: '[FS-W]',
    filesystem_edit: '[FS-E]',
    filesystem_bash: '[FS-SH]',
    filesystem_grep: '[FS-G]',
    filesystem_find: '[FS-F]',
    filesystem_ls: '[FS-LS]',
    list_tab_groups: '[GROUPS]',
    group_tabs: '[GROUP+]',
    update_tab_group: '[GROUP~]',
    ungroup_tabs: '[GROUP-]',
    close_tab_group: '[GROUPX]',
    save_pdf: '[PDF]',
    save_screenshot: '[SAVE-SHOT]',
    download_file: '[DL]',
    list_workflows: '[WF]',
    save_workflow: '[WF+]',
    delete_workflow: '[WF-]',
    list_saved_credentials: '[AUTH]',
    save_saved_credential: '[AUTH+]',
    delete_saved_credential: '[AUTH-]',
    list_autofill_profiles: '[FORMS]',
    save_autofill_profile: '[FORMS+]',
    delete_autofill_profile: '[FORMS-]',
    discover_server_categories_or_actions: '[DISCOVER]',
    execute_action: '[INTEGRATION]',
    search_documentation: '[DOCS?]',
    suggest_schedule: '[SCHEDULE]',
    memory_search: '[MEM?]',
    memory_write: '[MEM+]',
    memory_read_core: '[CORE]',
    memory_update_core: '[CORE+]',
    soul_read: '[SOUL]',
    soul_update: '[SOUL+]',
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
  return { action };
}

function isLinkedInUrl(url: string): boolean {
  return /linkedin\.com/i.test(String(url || ''));
}

function looksLikeLinkedInLoginAction(action: AgentAction): boolean {
  if (action.action !== 'click' && action.action !== 'open_url' && action.action !== 'navigate_page') return false;
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

/**
 * Synthesizes a final report if the model provided an empty or generic "done" message.
 */
async function synthesizeFinalAnswerFromContext(
  apiKey: string,
  task: string,
  history: ChatTurn[],
  memories: Array<{ key: string; value: string }>,
  signal?: AbortSignal,
): Promise<string> {
  const model = 'openai/gpt-4o';
  const systemPrompt = `You are Bron's Research Summarizer.
Your goal is to compile a professional, detailed markdown report based on a research task and the data gathered so far.

RULES:
1. Provide a comprehensive answer to the original task.
2. Use markdown tables, bold text, and lists to make it readable.
3. Include specific names, prices, links, or counts found in the history/memories.
4. If multiple sites were visited, summarize findings from each.
5. If the data is incomplete, state what was found and what is missing.
6. Return ONLY the markdown report. No introductory filler.`;

  const memoryContext = memories.length > 0 
    ? `RELEVANT FINDINGS:\n${memories.map(m => `- ${m.key}: ${m.value.slice(0, 500)}`).join('\n')}`
    : 'No specific findings in memory.';

  const historyContext = history.length > 0
    ? `CONVERSATION LOG (Partial):\n${history.slice(-15).map(h => `[${h.role}] ${h.content.slice(0, 1000)}`).join('\n')}`
    : 'No conversation history.';

  const userMessage = `TASK: ${task}\n\n${memoryContext}\n\n${historyContext}\n\nPlease synthesize a final report.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Bron Synthesis',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.2,
      }),
      signal,
    });

    if (!res.ok) throw new Error(`Synthesis API error: ${res.status}`);
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || 'Task completed (synthesis failed).').trim();
  } catch (err) {
    console.error('Synthesis API call failed:', err);
    return 'Task completed.';
  }
}
