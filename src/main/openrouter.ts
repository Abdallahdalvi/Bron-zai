/**
 * OpenRouter Client with Cost Guard Integration
 * Rate limiting, retry logic, and cost protection
 */

import { AgentAction, ModelInfo } from '../shared/types';
import { checkCostGuard, recordSuccess, recordError } from './costGuard';
import { logError, logInfo, logWarn } from './logger';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
}

export interface OpenRouterUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface OpenRouterCallResult {
  action: AgentAction;
  usage: OpenRouterUsage;
}

const FALLBACK_AGENTIC_MODELS: ModelInfo[] = [
  // Free tier models
  { id: 'google/gemini-2.5-pro-exp-03-25:free', name: 'Gemini 2.5 Pro Exp (Free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek V3 (Free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'meta-llama/llama-4-scout:free', name: 'Llama 4 Scout (Free)', pricing: { prompt: '0', completion: '0' } },
  // Paid models (reasonable cost)
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
  { id: 'openai/gpt-4o', name: 'GPT-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', pricing: { prompt: '0.0000001', completion: '0.0000004' } },
  { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3', pricing: { prompt: '0.00000027', completion: '0.0000011' } },
];

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ImageContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface AttachmentPrompt {
  text: string;
  imageDataUrls: string[];
}

/** Exponential backoff retry configuration */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call OpenRouter with retry logic, cost guard, and proper error handling
 */
export async function callOpenRouter(
  opts: OpenRouterOptions,
  systemPrompt: string,
  userMessage: string,
  conversationHistory: ChatTurn[] = [],
  attachmentPrompt?: AttachmentPrompt,
  signal?: AbortSignal,
  taskId?: number,
): Promise<OpenRouterCallResult> {
  
  // Check cost guard before making request
  const costCheck = checkCostGuard(taskId);
  if (!costCheck.allowed) {
    logWarn('Cost guard blocked request', 'OpenRouter', { reason: costCheck.reason });
    throw new Error(costCheck.reason || 'Cost limit exceeded');
  }

  // Build messages
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | ImageContentPart[] }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-20),
  ];

  if (attachmentPrompt && attachmentPrompt.imageDataUrls.length > 0) {
    const contentParts: ImageContentPart[] = [
      { type: 'text', text: `${userMessage}\n\n${attachmentPrompt.text}`.trim() },
      ...attachmentPrompt.imageDataUrls.slice(0, 3).map((url) => ({
        type: 'image_url' as const,
        image_url: { url },
      })),
    ];
    messages.push({ role: 'user', content: contentParts });
  } else {
    messages.push({
      role: 'user',
      content: attachmentPrompt?.text
        ? `${userMessage}\n\n${attachmentPrompt.text}`
        : userMessage,
    });
  }

  // Retry loop with exponential backoff
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Bron Agentic Browser',
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          temperature: 0.15,
          max_tokens: 4096,
          top_p: 0.9,
        }),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        
        // Handle rate limiting
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after');
          const delayMs = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
          logWarn('Rate limited, retrying...', 'OpenRouter', { attempt, delayMs });
          await sleep(Math.min(delayMs, RETRY_CONFIG.maxDelayMs));
          continue;
        }

        // Handle server errors with retry
        if (res.status >= 500 && attempt < RETRY_CONFIG.maxRetries - 1) {
          const delayMs = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
          logWarn(`Server error ${res.status}, retrying...`, 'OpenRouter', { attempt });
          await sleep(delayMs);
          continue;
        }

        throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
      }

      const data: any = await res.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? '';
      const usage = normalizeUsage(data?.usage);

      // Record successful request
      recordSuccess(usage, taskId);
      logInfo('API call successful', 'OpenRouter', { 
        model: opts.model, 
        tokens: usage.totalTokens,
        cost: usage.cost,
      });

      return {
        action: parseAgentResponse(raw),
        usage,
      };

    } catch (err: any) {
      lastError = err;
      
      // Don't retry on abort
      if (err.name === 'AbortError') {
        throw err;
      }
      
      // Don't retry on auth errors
      if (err.message?.includes('401') || err.message?.includes('403')) {
        throw err;
      }

      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
        logWarn(`Request failed, retrying...`, 'OpenRouter', { attempt, error: err.message });
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted
  recordError();
  logError('All retries exhausted', 'OpenRouter', { attempts: RETRY_CONFIG.maxRetries }, lastError || undefined);
  throw lastError || new Error('Failed after all retries');
}

/**
 * Enhance prompt with retry logic
 */
export async function enhancePrompt(
  apiKey: string,
  rawPrompt: string,
  signal?: AbortSignal,
): Promise<{ enhanced: string; usage: OpenRouterUsage | null }> {
  const ENHANCER_MODEL = 'openai/gpt-4o-mini'; // Cheaper model for enhancement
  
  const ENHANCER_SYSTEM_PROMPT = `You are the Bron Prompt Enhancer.
Your goal is to optimize a user task for an autonomous browser agent.

STRATEGY:
1. If simple, keep brief and direct.
2. If complex research, expand into methodical plan.
3. Identify required data points and likely sources.
4. Add specific search queries to reduce trial-and-error.
5. Do NOT change the user's intent.
6. STRICTLY PRESERVE all negative constraints, rules, restrictions, and instructions on what NOT to do (e.g., "don't use right click", "avoid X", "without Y"). Never remove, ignore, or modify them.

OUTPUT: Return ONLY the enhanced, agent-ready prompt. No conversational filler.`;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Bron Prompt Enhancer',
        },
        body: JSON.stringify({
          model: ENHANCER_MODEL,
          messages: [
            { role: 'system', content: ENHANCER_SYSTEM_PROMPT },
            { role: 'user', content: `Original Task: ${rawPrompt}\n\nPlease enhance and detail this for my agent.` }
          ],
          temperature: 0.2,
          max_tokens: 2048,
        }),
        signal,
      });

      if (!res.ok) {
        if (attempt < RETRY_CONFIG.maxRetries - 1 && res.status >= 500) {
          await sleep(RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt));
          continue;
        }
        return { enhanced: rawPrompt, usage: null };
      }

      const data: any = await res.json();
      const enhanced = (data?.choices?.[0]?.message?.content ?? rawPrompt).trim();
      const usage = normalizeUsage(data?.usage);
      
      logInfo('Prompt enhanced', 'Enhancer', { originalLength: rawPrompt.length, enhancedLength: enhanced.length });
      return { enhanced, usage };

    } catch (err) {
      if (attempt === RETRY_CONFIG.maxRetries - 1) {
        logError('Enhancement failed', 'Enhancer', {}, err as Error);
        return { enhanced: rawPrompt, usage: null };
      }
      await sleep(RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt));
    }
  }

  return { enhanced: rawPrompt, usage: null };
}

/**
 * Fetch available models from OpenRouter
 */
export async function fetchOpenRouterModels(apiKey?: string, limit = 40): Promise<ModelInfo[]> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Bron Agentic Browser',
    };
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    const res = await fetch(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      logWarn(`Failed to fetch models: ${res.status}`, 'OpenRouter');
      throw new Error(`OpenRouter model list failed: ${res.status}`);
    }

    const data: any = await res.json();
    const remoteModels: ModelInfo[] = Array.isArray(data?.data)
      ? data.data.map((m: any) => ({
          id: String(m.id),
          name: String(m.name || m.id),
          pricing: {
            prompt: String(m.pricing?.prompt ?? '0'),
            completion: String(m.pricing?.completion ?? '0'),
          },
          description: m.description,
        }))
      : [];

    const sorted = remoteModels.sort((a, b) => a.name.localeCompare(b.name));
    
    // Merge with fallbacks
    const merged: ModelInfo[] = [...sorted];
    FALLBACK_AGENTIC_MODELS.forEach(f => {
      if (!merged.some(m => m.id === f.id)) merged.push(f);
    });

    logInfo(`Loaded ${merged.length} models`, 'OpenRouter');
    return merged;

  } catch (err) {
    logError('Failed to load models, using fallbacks', 'OpenRouter', {}, err as Error);
    return [...FALLBACK_AGENTIC_MODELS].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Parse agent response from LLM output */
function parseAgentResponse(raw: string): AgentAction {
  let cleaned = raw.trim();

  // Try to find markdown code block
  const codeBlocks = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (codeBlocks.length > 0) {
    cleaned = codeBlocks[codeBlocks.length - 1][1].trim();
  }

  // Find JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    logWarn('No JSON found in response, using default', 'Parser', { preview: raw.slice(0, 200) });
    return {
      thought: 'Failed to parse response',
      action: 'done',
      target: '',
      value: raw.slice(0, 500),
      reason: 'Parsing failed',
    };
  }

  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(jsonStr);

    return {
      thought: String(parsed.thought ?? ''),
      action: String(parsed.action ?? 'done') as AgentAction['action'],
      target: String(parsed.target ?? ''),
      value: String(parsed.value ?? ''),
      reason: String(parsed.reason ?? ''),
    };
  } catch (err: any) {
    logError('JSON parse failed', 'Parser', { segment: jsonStr.slice(0, 200) }, err);
    return {
      thought: 'Failed to parse JSON response',
      action: 'done',
      target: '',
      value: raw.slice(0, 500),
      reason: 'JSON parse error',
    };
  }
}

/** Normalize usage data from various API formats */
function normalizeUsage(rawUsage: any): OpenRouterUsage {
  const promptTokens = numberOrZero(
    rawUsage?.prompt_tokens ??
      rawUsage?.promptTokens ??
      rawUsage?.input_tokens ??
      rawUsage?.input_tokens_details?.text_tokens,
  );
  const completionTokens = numberOrZero(
    rawUsage?.completion_tokens ??
      rawUsage?.completionTokens ??
      rawUsage?.output_tokens ??
      rawUsage?.output_tokens_details?.text_tokens,
  );
  const reportedTotal = numberOrZero(rawUsage?.total_tokens ?? rawUsage?.totalTokens);
  const totalTokens = reportedTotal > 0 ? reportedTotal : promptTokens + completionTokens;
  const cost = numberOrZero(rawUsage?.cost ?? rawUsage?.cost_usd ?? rawUsage?.total_cost);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
  };
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
