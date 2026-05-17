/**
 * CostGuard — Rate limiting and cost protection for OpenRouter API calls
 * Prevents runaway costs from agent loops or misconfigured tasks
 */

import { OpenRouterUsage } from './openrouter';
import { getSettings, saveSettings } from './memory';

export interface CostGuardConfig {
  /** Maximum cost per task in USD (default: $1.00) */
  maxCostPerTask: number;
  /** Maximum cost per day in USD (default: $10.00) */
  maxCostPerDay: number;
  /** Maximum requests per minute (default: 30) */
  maxRequestsPerMinute: number;
  /** Maximum consecutive errors before circuit breaker (default: 5) */
  maxConsecutiveErrors: number;
  /** Cooldown period after hitting limits in ms (default: 60000) */
  cooldownMs: number;
}

export const DEFAULT_COST_GUARD: CostGuardConfig = {
  maxCostPerTask: 1.0,
  maxCostPerDay: 10.0,
  maxRequestsPerMinute: 30,
  maxConsecutiveErrors: 5,
  cooldownMs: 60000,
};

interface CostStats {
  dailyCost: number;
  dailyCostDate: string;
  taskCosts: Map<number, number>;
  requestTimestamps: number[];
  consecutiveErrors: number;
  lastErrorAt: number | null;
  isCircuitOpen: boolean;
  circuitOpenedAt: number | null;
}

const stats: CostStats = {
  dailyCost: 0,
  dailyCostDate: new Date().toISOString().slice(0, 10),
  taskCosts: new Map(),
  requestTimestamps: [],
  consecutiveErrors: 0,
  lastErrorAt: null,
  isCircuitOpen: false,
  circuitOpenedAt: null,
};

/** Load cost guard configuration from settings or use defaults */
export function getCostGuardConfig(): CostGuardConfig {
  try {
    const settings = getSettings();
    return {
      maxCostPerTask: Number(settings.costGuardMaxCostPerTask ?? DEFAULT_COST_GUARD.maxCostPerTask),
      maxCostPerDay: Number(settings.costGuardMaxCostPerDay ?? DEFAULT_COST_GUARD.maxCostPerDay),
      maxRequestsPerMinute: Number(settings.costGuardMaxRequestsPerMinute ?? DEFAULT_COST_GUARD.maxRequestsPerMinute),
      maxConsecutiveErrors: Number(settings.costGuardMaxConsecutiveErrors ?? DEFAULT_COST_GUARD.maxConsecutiveErrors),
      cooldownMs: Number(settings.costGuardCooldownMs ?? DEFAULT_COST_GUARD.cooldownMs),
    };
  } catch {
    return DEFAULT_COST_GUARD;
  }
}

/** Save cost guard configuration to settings */
export function saveCostGuardConfig(config: Partial<CostGuardConfig>): void {
  const settings = getSettings();
  if (config.maxCostPerTask !== undefined) settings.costGuardMaxCostPerTask = config.maxCostPerTask;
  if (config.maxCostPerDay !== undefined) settings.costGuardMaxCostPerDay = config.maxCostPerDay;
  if (config.maxRequestsPerMinute !== undefined) settings.costGuardMaxRequestsPerMinute = config.maxRequestsPerMinute;
  if (config.maxConsecutiveErrors !== undefined) settings.costGuardMaxConsecutiveErrors = config.maxConsecutiveErrors;
  if (config.cooldownMs !== undefined) settings.costGuardCooldownMs = config.cooldownMs;
  saveSettings(settings);
}

/** Reset daily cost counter if date changed */
function checkAndResetDailyCost(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (stats.dailyCostDate !== today) {
    stats.dailyCost = 0;
    stats.dailyCostDate = today;
  }
}

/** Check if circuit breaker is open (too many errors) */
function isCircuitBreakerOpen(config: CostGuardConfig): boolean {
  if (!stats.isCircuitOpen) return false;
  
  // Check if cooldown period has elapsed
  if (stats.circuitOpenedAt && Date.now() - stats.circuitOpenedAt > config.cooldownMs) {
    stats.isCircuitOpen = false;
    stats.consecutiveErrors = 0;
    stats.circuitOpenedAt = null;
    return false;
  }
  
  return true;
}

/** Check rate limiting — max requests per minute */
function checkRateLimit(config: CostGuardConfig): { allowed: boolean; waitMs?: number } {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  
  // Clean old timestamps
  stats.requestTimestamps = stats.requestTimestamps.filter(ts => ts > oneMinuteAgo);
  
  if (stats.requestTimestamps.length >= config.maxRequestsPerMinute) {
    const oldestRequest = stats.requestTimestamps[0];
    const waitMs = 60000 - (now - oldestRequest) + 100; // +100ms buffer
    return { allowed: false, waitMs: Math.max(waitMs, 1000) };
  }
  
  return { allowed: true };
}

export interface CostGuardResult {
  allowed: boolean;
  reason?: string;
  currentTaskCost: number;
  dailyCost: number;
  waitMs?: number;
}

/**
 * Check if an API call is allowed based on cost and rate limits.
 * Call this BEFORE making an OpenRouter request.
 */
export function checkCostGuard(taskId?: number): CostGuardResult {
  const config = getCostGuardConfig();
  checkAndResetDailyCost();
  
  // Check circuit breaker
  if (isCircuitBreakerOpen(config)) {
    const remainingMs = config.cooldownMs - (Date.now() - (stats.circuitOpenedAt || 0));
    return {
      allowed: false,
      reason: `Circuit breaker open due to consecutive errors. Try again in ${Math.ceil(remainingMs / 1000)}s.`,
      currentTaskCost: taskId ? (stats.taskCosts.get(taskId) || 0) : 0,
      dailyCost: stats.dailyCost,
      waitMs: remainingMs,
    };
  }
  
  // Check rate limit
  const rateLimit = checkRateLimit(config);
  if (!rateLimit.allowed) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${config.maxRequestsPerMinute} requests per minute.`,
      currentTaskCost: taskId ? (stats.taskCosts.get(taskId) || 0) : 0,
      dailyCost: stats.dailyCost,
      waitMs: rateLimit.waitMs,
    };
  }
  
  // Check daily cost limit
  if (stats.dailyCost >= config.maxCostPerDay) {
    return {
      allowed: false,
      reason: `Daily cost limit reached: $${stats.dailyCost.toFixed(2)} / $${config.maxCostPerDay.toFixed(2)}.`,
      currentTaskCost: taskId ? (stats.taskCosts.get(taskId) || 0) : 0,
      dailyCost: stats.dailyCost,
    };
  }
  
  // Check task cost limit
  if (taskId) {
    const taskCost = stats.taskCosts.get(taskId) || 0;
    if (taskCost >= config.maxCostPerTask) {
      return {
        allowed: false,
        reason: `Task cost limit reached: $${taskCost.toFixed(2)} / $${config.maxCostPerTask.toFixed(2)}.`,
        currentTaskCost: taskCost,
        dailyCost: stats.dailyCost,
      };
    }
  }
  
  // Record this request
  stats.requestTimestamps.push(Date.now());
  
  return {
    allowed: true,
    currentTaskCost: taskId ? (stats.taskCosts.get(taskId) || 0) : 0,
    dailyCost: stats.dailyCost,
  };
}

/**
 * Record successful API call cost.
 * Call this AFTER a successful OpenRouter response.
 */
export function recordSuccess(usage: OpenRouterUsage, taskId?: number): void {
  const cost = usage.cost || 0;
  stats.dailyCost += cost;
  stats.consecutiveErrors = 0;
  
  if (taskId) {
    const currentCost = stats.taskCosts.get(taskId) || 0;
    stats.taskCosts.set(taskId, currentCost + cost);
  }
}

/**
 * Record API error for circuit breaker tracking.
 * Call this AFTER a failed OpenRouter request.
 */
export function recordError(): void {
  const config = getCostGuardConfig();
  stats.consecutiveErrors++;
  stats.lastErrorAt = Date.now();
  
  if (stats.consecutiveErrors >= config.maxConsecutiveErrors) {
    stats.isCircuitOpen = true;
    stats.circuitOpenedAt = Date.now();
  }
}

/** Get current cost statistics */
export function getCostStats(): {
  dailyCost: number;
  dailyCostDate: string;
  requestsLastMinute: number;
  consecutiveErrors: number;
  isCircuitOpen: boolean;
} {
  checkAndResetDailyCost();
  const oneMinuteAgo = Date.now() - 60000;
  const recentRequests = stats.requestTimestamps.filter(ts => ts > oneMinuteAgo).length;
  
  return {
    dailyCost: stats.dailyCost,
    dailyCostDate: stats.dailyCostDate,
    requestsLastMinute: recentRequests,
    consecutiveErrors: stats.consecutiveErrors,
    isCircuitOpen: stats.isCircuitOpen,
  };
}

/** Reset all cost tracking (for testing or manual override) */
export function resetCostTracking(): void {
  stats.dailyCost = 0;
  stats.dailyCostDate = new Date().toISOString().slice(0, 10);
  stats.taskCosts.clear();
  stats.requestTimestamps = [];
  stats.consecutiveErrors = 0;
  stats.lastErrorAt = null;
  stats.isCircuitOpen = false;
  stats.circuitOpenedAt = null;
}

/** Reset circuit breaker (manual recovery) */
export function resetCircuitBreaker(): void {
  stats.isCircuitOpen = false;
  stats.circuitOpenedAt = null;
  stats.consecutiveErrors = 0;
}
