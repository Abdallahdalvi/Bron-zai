/**
 * AgentStateMachine — Refactored agent loop using finite state machine pattern
 * Replaces the 2,861-line god function with modular, testable states
 */

import { AgentAction, AgentAttachment, AgentRunRequest, BrowserState } from '../shared/types';
import type { AgentAutomationController } from './agentAutomation';
import type { BrowserWindow } from 'electron';

/** Possible states in the agent lifecycle */
export type AgentPhase = 
  | 'idle'
  | 'enhancing_prompt'
  | 'observing'
  | 'deciding'
  | 'executing'
  | 'verifying'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'stopped';

/** State-specific context */
export interface AgentContext {
  taskId: number;
  sessionId?: number;
  rawTask: string;
  optimizedTask: string;
  attachments: AgentAttachment[];
  contextMessages: string[];
  isChatMode: boolean;
  
  // Execution tracking
  step: number;
  maxSteps: number;
  startTime: number;
  
  // State
  phase: AgentPhase;
  lastActions: string[];
  lastResult: string;
  memories: Array<{ key: string; value: string }>;
  
  // Error handling
  consecutiveErrors: number;
  consecutiveSameActions: number;
  failedSites: Set<string>;
  visitedSites: Set<string>;
  
  // Cost tracking
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  
  // Recovery
  recoveryAttempts: number;
  lastError?: string;
  
  // Action tracking for loop detection
  actionHistory: Array<{
    step: number;
    action: string;
    target: string;
    value: string;
    result: string;
  }>;
}

/** Result of executing a single state */
export interface StateResult {
  nextPhase: AgentPhase;
  action?: AgentAction;
  error?: string;
  shouldPause?: boolean;
}

/** State handler interface */
type StateHandler = (
  ctx: AgentContext,
  deps: AgentDependencies
) => Promise<StateResult>;

/** Dependencies injected into state handlers */
export interface AgentDependencies {
  browserController: AgentAutomationController;
  getWindow: () => BrowserWindow | null;
  callOpenRouter: (
    systemPrompt: string,
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>
  ) => Promise<{ action: AgentAction; usage: { cost: number; promptTokens: number; completionTokens: number } }>;
  enhancePrompt: (task: string) => Promise<{ enhanced: string; usage: { cost: number } | null }>;
  validateAction: (action: AgentAction) => { safe: boolean; reason?: string; requiresConfirmation?: boolean };
  executeAction: (action: AgentAction) => Promise<string>;
  addMemory: (key: string, value: string) => void;
  addStep: (stepNumber: number, action: string, target: string, value: string, result: string) => void;
  getMemories: () => Promise<Array<{ key: string; value: string }>>;
  sendToRenderer: (channel: string, data: unknown) => void;
  checkCostGuard: (taskId: number) => { allowed: boolean; reason?: string };
  recordSuccess: (usage: { cost: number }, taskId: number) => void;
  sleep: (ms: number) => Promise<void>;
}

/** State handlers implementation */
const stateHandlers: Record<AgentPhase, StateHandler> = {
  
  /** Initial state — decide if we need enhancement */
  idle: async (ctx, deps) => {
    if (ctx.isChatMode) {
      ctx.optimizedTask = ctx.rawTask;
      return { nextPhase: 'observing' };
    }
    return { nextPhase: 'enhancing_prompt' };
  },

  /** Prompt enhancement state */
  enhancing_prompt: async (ctx, deps) => {
    deps.sendToRenderer('AGENT_STEP', {
      step: 0,
      type: 'thinking',
      message: 'ChatGPT 5.1 Engine: Enhancing and detailing your task...',
    });

    try {
      const enhancement = await deps.enhancePrompt(ctx.rawTask);
      ctx.optimizedTask = enhancement.enhanced;
      if (enhancement.usage) {
        ctx.totalCost += enhancement.usage.cost;
      }
      
      deps.sendToRenderer('AGENT_STEP', {
        step: 0,
        type: 'thinking',
        message: 'Optimization complete. Starting agentic execution...',
      });
      
      return { nextPhase: 'observing' };
    } catch (error) {
      // Fallback to original task
      ctx.optimizedTask = ctx.rawTask;
      return { nextPhase: 'observing' };
    }
  },

  /** Get browser state to inform decision */
  observing: async (ctx, deps) => {
    deps.sendToRenderer('AGENT_STEP', {
      step: ctx.step,
      type: 'thinking',
      message: `Step ${ctx.step}: Analyzing page state...`,
    });

    try {
      const state = await deps.browserController.getBrowserState();
      
      // Track visited sites
      try {
        const domain = new URL(state.url).hostname;
        ctx.visitedSites.add(domain);
      } catch {}

      // Build observation payload
      ctx.lastResult = JSON.stringify(state);
      
      return { nextPhase: 'deciding' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Check if this is a browser disconnect
      if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ERR_CONNECTION_REFUSED')) {
        if (ctx.recoveryAttempts < 8) {
          ctx.recoveryAttempts++;
          deps.sendToRenderer('AGENT_STEP', {
            step: ctx.step,
            type: 'error',
            message: `Browser reconnecting (${ctx.recoveryAttempts}/8)...`,
          });
          await deps.sleep(1200);
          return { nextPhase: 'recovering' };
        }
      }
      
      ctx.lastError = errorMsg;
      ctx.consecutiveErrors++;
      return { nextPhase: 'failed' };
    }
  },

  /** Query LLM to decide next action */
  deciding: async (ctx, deps) => {
    deps.sendToRenderer('AGENT_STEP', {
      step: ctx.step,
      type: 'thinking',
      message: `Step ${ctx.step}: Deciding next action...`,
    });

    // Check cost guard
    const costCheck = deps.checkCostGuard(ctx.taskId);
    if (!costCheck.allowed) {
      return { nextPhase: 'failed', error: costCheck.reason };
    }

    // Check step limit
    if (ctx.maxSteps > 0 && ctx.step > ctx.maxSteps) {
      return { nextPhase: 'completed' };
    }

    // Check for action loops
    const loopWarning = detectActionLoop(ctx);
    if (loopWarning) {
      ctx.lastResult += `\n\nCRITICAL: ${loopWarning}`;
    }

    // Get relevant memories
    const memories = await deps.getMemories();
    ctx.memories = memories.slice(-12);

    // Build system prompt based on mode
    const systemPrompt = ctx.isChatMode 
      ? getChatModeSystemPrompt()
      : getAgentSystemPrompt();

    // Build user message with full context
    const userMessage = buildUserMessage(ctx);

    try {
      const response = await deps.callOpenRouter(
        systemPrompt,
        userMessage,
        ctx.actionHistory.map(a => ({
          role: 'assistant',
          content: JSON.stringify({
            thought: `Step ${a.step}: ${a.action}`,
            action: a.action,
            target: a.target,
            value: a.value,
          }),
        }))
      );

      // Track token usage
      ctx.totalCost += response.usage.cost;
      ctx.promptTokens += response.usage.promptTokens;
      ctx.completionTokens += response.usage.completionTokens;
      deps.recordSuccess({ cost: response.usage.cost }, ctx.taskId);

      // Validate action
      const validation = deps.validateAction(response.action);
      if (!validation.safe) {
        ctx.lastError = validation.reason;
        ctx.consecutiveErrors++;
        
        deps.sendToRenderer('AGENT_STEP', {
          step: ctx.step,
          type: 'error',
          message: `Safety blocked: ${validation.reason}`,
        });
        
        if (ctx.consecutiveErrors >= 3) {
          return { nextPhase: 'failed', error: 'Too many consecutive errors' };
        }
        
        return { nextPhase: 'observing' }; // Retry observation
      }

      // Check for confirmation requirement
      if (validation.requiresConfirmation) {
        deps.sendToRenderer('AGENT_STEP', {
          step: ctx.step,
          type: 'confirmation',
          message: validation.reason,
          action: response.action,
        });
        return { nextPhase: 'executing', action: response.action, shouldPause: true };
      }

      return { nextPhase: 'executing', action: response.action };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      ctx.consecutiveErrors++;
      
      // Check for abort
      if (errorMsg.includes('AbortError')) {
        return { nextPhase: 'stopped' };
      }
      
      ctx.lastError = errorMsg;
      
      if (ctx.consecutiveErrors >= 5) {
        return { nextPhase: 'failed', error: errorMsg };
      }
      
      return { nextPhase: 'observing' }; // Retry
    }
  },

  /** Execute the decided action */
  executing: async (ctx, deps) => {
    // This state receives the action from 'deciding' via StateResult.action
    const action = (ctx as any).__pendingAction as AgentAction;
    if (!action) {
      return { nextPhase: 'failed', error: 'No action to execute' };
    }

    deps.sendToRenderer('AGENT_STEP', {
      step: ctx.step,
      type: 'action',
      message: `Step ${ctx.step}: ${action.action} — ${action.reason}`,
      action,
    });

    try {
      const result = await deps.executeAction(action);

      // Record action in history
      ctx.actionHistory.push({
        step: ctx.step,
        action: action.action,
        target: action.target,
        value: action.value,
        result: result.slice(0, 500), // Truncate long results
      });

      ctx.lastResult = result;
      ctx.lastActions.push(action.action);
      if (ctx.lastActions.length > 10) ctx.lastActions.shift();

      deps.addStep(ctx.step, action.action, action.target, action.value, result);

      // Check if done
      if (action.action === 'done') {
        return { nextPhase: 'completed' };
      }

      ctx.step++;
      ctx.consecutiveErrors = 0;
      return { nextPhase: 'verifying' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      ctx.consecutiveErrors++;
      ctx.lastError = errorMsg;
      
      deps.sendToRenderer('AGENT_STEP', {
        step: ctx.step,
        type: 'error',
        message: `Action failed: ${errorMsg}`,
      });

      if (ctx.consecutiveErrors >= 5) {
        return { nextPhase: 'failed', error: errorMsg };
      }

      return { nextPhase: 'observing' };
    }
  },

  /** Verify action result and decide next step */
  verifying: async (ctx, deps) => {
    // Brief pause for page to settle
    await deps.sleep(300);
    return { nextPhase: 'observing' };
  },

  /** Attempt to recover from browser disconnect */
  recovering: async (ctx, deps) => {
    try {
      // Try to get browser state as a recovery check
      await deps.browserController.getBrowserState();
      ctx.recoveryAttempts = 0;
      return { nextPhase: 'observing' };
    } catch {
      ctx.recoveryAttempts++;
      if (ctx.recoveryAttempts >= 8) {
        return { nextPhase: 'failed', error: 'Browser recovery failed after 8 attempts' };
      }
      await deps.sleep(1200);
      return { nextPhase: 'recovering' };
    }
  },

  /** Task completed successfully */
  completed: async (ctx, deps) => {
    const elapsed = Date.now() - ctx.startTime;
    
    deps.sendToRenderer('AGENT_DONE', {
      message: `Task completed in ${ctx.step} steps (${formatDuration(elapsed)}).`,
      steps: ctx.step,
      runtimeMs: elapsed,
      cost: ctx.totalCost,
    });

    return { nextPhase: 'completed' };
  },

  /** Task failed */
  failed: async (ctx, deps) => {
    const elapsed = Date.now() - ctx.startTime;
    
    deps.sendToRenderer('AGENT_ERROR', {
      message: ctx.lastError || 'Task failed',
      steps: ctx.step,
      runtimeMs: elapsed,
      cost: ctx.totalCost,
    });

    return { nextPhase: 'failed' };
  },

  /** Task stopped by user */
  stopped: async (ctx, deps) => {
    const elapsed = Date.now() - ctx.startTime;
    
    deps.sendToRenderer('AGENT_DONE', {
      message: `Task stopped after ${ctx.step} steps (${formatDuration(elapsed)}).`,
      steps: ctx.step,
      runtimeMs: elapsed,
      cost: ctx.totalCost,
      stopped: true,
    });

    return { nextPhase: 'stopped' };
  },
};

/** Detect if agent is stuck in an action loop */
function detectActionLoop(ctx: AgentContext): string | null {
  // Check last 3 actions for exact repetition
  if (ctx.lastActions.length >= 3) {
    const last3 = ctx.lastActions.slice(-3);
    if (last3[0] === last3[1] && last3[1] === last3[2]) {
      return 'You are stuck in a loop. Do NOT repeat the same action again. Try a different approach or use "done" if you have enough info.';
    }
  }

  // Check for circular patterns
  if (ctx.actionHistory.length >= 6) {
    const recent = ctx.actionHistory.slice(-6);
    const pattern1 = recent.slice(0, 3).map(a => a.action).join(',');
    const pattern2 = recent.slice(3, 6).map(a => a.action).join(',');
    if (pattern1 === pattern2) {
      return 'Detected circular action pattern. Break the cycle with a different strategy.';
    }
  }

  return null;
}

/** Build user message with full context for LLM */
function buildUserMessage(ctx: AgentContext): string {
  const siteInfo = `
VISITED SITES: ${ctx.visitedSites.size > 0 ? Array.from(ctx.visitedSites).join(', ') : 'none'}
BLOCKED SITES: ${ctx.failedSites.size > 0 ? Array.from(ctx.failedSites).join(', ') + ' - DO NOT revisit these' : 'none'}`;

  const memoryContext = ctx.memories.length > 0
    ? `RELEVANT MEMORIES:\n${ctx.memories.map(m => `- ${m.key}: ${m.value}`).join('\n')}`
    : 'No relevant memories.';

  return `TASK: ${ctx.optimizedTask}

CURRENT STEP: ${ctx.step}${ctx.maxSteps > 0 ? ` / ${ctx.maxSteps}` : ''}

BROWSER STATE:
${ctx.lastResult}

${memoryContext}

${siteInfo}

${ctx.lastActions.length > 0 ? `RECENT ACTIONS: ${ctx.lastActions.slice(-5).join(' → ')}` : ''}

What is your next action?`;
}

/** Get system prompt for agent mode */
function getAgentSystemPrompt(): string {
  // This references the main SYSTEM_PROMPT from prompt.ts
  // In real implementation, import from '../agent/prompt'
  return `You are BrowserOS - an expert web automation agent.

CRITICAL:
1. MAX 8 TABS TOTAL
2. Complete tasks on current page when possible
3. Use evaluate_script to extract data
4. Return ONLY valid JSON with thought, action, target, value, reason

Action must be one of: navigate_page, click, fill, take_enhanced_snapshot, evaluate_script, done, etc.`;
}

/** Get system prompt for chat mode */
function getChatModeSystemPrompt(): string {
  return `You are Bron in Chat Mode. Answer using provided conversation history.
DO NOT suggest browser actions. Return JSON with "thought" and "action": "done", "value": "your answer".`;
}

/** Format duration for display */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** Main agent state machine runner */
export class AgentStateMachine {
  private ctx: AgentContext;
  private deps: AgentDependencies;
  private running = false;
  private shouldStop = false;

  constructor(ctx: AgentContext, deps: AgentDependencies) {
    this.ctx = ctx;
    this.deps = deps;
  }

  /** Start the state machine */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.shouldStop = false;

    while (this.running && !this.shouldStop) {
      const handler = stateHandlers[this.ctx.phase];
      if (!handler) {
        console.error(`Unknown phase: ${this.ctx.phase}`);
        break;
      }

      const result = await handler(this.ctx, this.deps);

      // Store pending action for executing phase
      if (result.action) {
        (this.ctx as any).__pendingAction = result.action;
      }

      // Check for terminal states
      if (['completed', 'failed', 'stopped'].includes(result.nextPhase)) {
        this.ctx.phase = result.nextPhase;
        await stateHandlers[result.nextPhase](this.ctx, this.deps);
        break;
      }

      this.ctx.phase = result.nextPhase;
    }

    this.running = false;
  }

  /** Request graceful stop */
  stop(): void {
    this.shouldStop = true;
  }

  /** Get current context (for UI updates) */
  getContext(): Readonly<AgentContext> {
    return this.ctx;
  }

  /** Check if running */
  isRunning(): boolean {
    return this.running;
  }
}

/** Factory to create context from task input */
export function createAgentContext(
  taskInput: AgentRunRequest,
  taskId: number,
  maxSteps: number
): AgentContext {
  return {
    taskId,
    sessionId: taskInput.sessionId,
    rawTask: taskInput.task,
    optimizedTask: taskInput.task,
    attachments: taskInput.attachments || [],
    contextMessages: taskInput.contextMessages || [],
    isChatMode: taskInput.isChatMode || false,
    step: 1,
    maxSteps,
    startTime: Date.now(),
    phase: 'idle',
    lastActions: [],
    lastResult: '',
    memories: [],
    consecutiveErrors: 0,
    consecutiveSameActions: 0,
    failedSites: new Set(),
    visitedSites: new Set(),
    totalCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    recoveryAttempts: 0,
    actionHistory: [],
  };
}
