import { AgentAction, ModelInfo } from '../shared/types';

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
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B IT', pricing: { prompt: '0.00000013', completion: '0.00000038' } },
  { id: 'deepseek/deepseek-chat-v3.1', name: 'DeepSeek V3.1', pricing: { prompt: '0.00000015', completion: '0.00000075' } },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', pricing: { prompt: '0.000000252', completion: '0.000000378' } },
  { id: 'google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B', pricing: { prompt: '0.00000006', completion: '0.00000033' } },
  { id: 'openai/gpt-5.5-pro', name: 'GPT-5.5 Pro', pricing: { prompt: '0.00003', completion: '0.00018' } },
  { id: 'x-ai/grok-4.3', name: 'Grok 4.3', pricing: { prompt: '0.00000125', completion: '0.0000025' } },
];

const PRIORITY_MODEL_PREFIXES = [
  'google/gemma-4',
  'deepseek/deepseek-v3',
  'deepseek/deepseek-chat-v3',
  'openai/gpt-5.5',
  'x-ai/grok-4',
];

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface TextContentPart {
  type: 'text';
  text: string;
}

interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

interface AttachmentPrompt {
  text: string;
  imageDataUrls: string[];
}

/**
 * Call OpenRouter chat completion with full conversation history.
 * This enables multi-turn reasoning where the agent remembers previous actions.
 */
export async function callOpenRouter(
  opts: OpenRouterOptions,
  systemPrompt: string,
  userMessage: string,
  conversationHistory: ChatTurn[] = [],
  attachmentPrompt?: AttachmentPrompt,
  signal?: AbortSignal,
): Promise<OpenRouterCallResult> {
  // Build messages: system + conversation history + current user message
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | Array<TextContentPart | ImageContentPart> }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-20), // Keep last 20 turns for context
  ];

  if (attachmentPrompt && attachmentPrompt.imageDataUrls.length > 0) {
    const contentParts: Array<TextContentPart | ImageContentPart> = [
      {
        type: 'text',
        text: `${userMessage}\n\n${attachmentPrompt.text}`.trim(),
      },
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
    throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
  }

  const data: any = await res.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? '';
  const usage = normalizeUsage(data?.usage);

  return {
    action: parseAgentResponse(raw),
    usage,
  };
}

/**
 * Enhances and details a user prompt for better agentic task execution.
 * Uses ChatGPT 5.5 Pro (or equivalent) as the backend detailer.
 */
export async function enhancePrompt(
  apiKey: string,
  rawPrompt: string,
  signal?: AbortSignal,
): Promise<{ enhanced: string; usage: OpenRouterUsage | null }> {
  const ENHANCER_MODEL = 'openai/gpt-4o'; // Reliable high-end model for optimization
  const ENHANCER_SYSTEM_PROMPT = `You are the Bron Prompt Enhancer (GPT-5.1 Engine).
Your goal is to optimize a user task for an autonomous browser agent.

STRATEGY:
1. If the task is simple (e.g., "What time is it in X?"), keep the enhancement brief and direct.
2. If the task is complex research, expand it into a methodical plan (Plan, Gather, Verify, Compile).
3. Identify required data points and likely high-quality sources.
4. Add specific search queries to reduce trial-and-error.
5. Do NOT change the user's intent.
6. Avoid redundant steps (e.g., if a source is likely to have everything, don't plan 5 other sites).

OUTPUT: Return ONLY the enhanced, agent-ready prompt. No conversational filler.`;

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
      }),
      signal,
    });

    if (!res.ok) return { enhanced: rawPrompt, usage: null };

    const data: any = await res.json();
    const enhanced = (data?.choices?.[0]?.message?.content ?? rawPrompt).trim();
    const usage = normalizeUsage(data?.usage);
    
    return { enhanced, usage };
  } catch (err) {
    console.error('Prompt enhancement failed:', err);
    return { enhanced: rawPrompt, usage: null };
  }
}

/**
 * Fetch available models from OpenRouter and return a curated, ranked list
 * optimized for agentic browser tasks.
 */
export async function fetchOpenRouterModels(apiKey?: string, limit = 40): Promise<ModelInfo[]> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Bron Agentic Browser',
    };
    if (apiKey && apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    const res = await fetch(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers,
    });
    if (!res.ok) throw new Error(`OpenRouter model list failed: ${res.status}`);

    const data: any = await res.json();
    const remoteModels: ModelInfo[] = Array.isArray(data?.data)
      ? data.data
          .map((m: any) => ({
            id: String(m.id),
            name: String(m.name || m.id),
            pricing: {
              prompt: String(m.pricing?.prompt ?? '0'),
              completion: String(m.pricing?.completion ?? '0'),
            },
            description: m.description
          }))
      : [];

    // Sort alphabetically by name
    const sorted = remoteModels.sort((a, b) => a.name.localeCompare(b.name));
    
    // Merge with fallbacks
    const merged: ModelInfo[] = [...sorted];
    FALLBACK_AGENTIC_MODELS.forEach(f => {
      if (!merged.some(m => m.id === f.id)) merged.push(f);
    });

    return merged;
  } catch {
    return [...FALLBACK_AGENTIC_MODELS].sort((a, b) => a.name.localeCompare(b.name));
  }
}

function mergeWithFallbacks(primary: string[], fallbacks: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...primary, ...fallbacks]) {
    const key = id.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}


function parseAgentResponse(raw: string): AgentAction {
  let cleaned = raw.trim();

  // 1. Try to find the last markdown code block (often where models put the final JSON)
  const codeBlocks = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (codeBlocks.length > 0) {
    cleaned = codeBlocks[codeBlocks.length - 1][1].trim();
  }

  // 2. Try to find the JSON object structure { ... }
  // We look for the FIRST { and the LAST } to capture the full object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(`No JSON found in model response. Raw: ${raw.slice(0, 300)}...`);
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
    throw new Error(`Failed to parse model JSON: ${err.message}. Segment: ${jsonStr.slice(0, 200)}`);
  }
}

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
