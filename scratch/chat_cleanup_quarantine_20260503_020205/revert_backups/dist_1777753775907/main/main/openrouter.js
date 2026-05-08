"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callOpenRouter = callOpenRouter;
exports.fetchOpenRouterModels = fetchOpenRouterModels;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const FALLBACK_AGENTIC_MODELS = [
    'google/gemma-3-27b-it',
    'google/gemma-3-27b-it:free',
    'qwen/qwen3-32b',
    'deepseek/deepseek-chat',
    'google/gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'anthropic/claude-sonnet-4',
    'openai/gpt-4o-mini',
    'openai/o4-mini',
    'openai/gpt-4.1',
];
const PRIORITY_MODEL_PREFIXES = [
    'google/gemma-3-27b-it',
    'qwen/qwen3-32b',
    'anthropic/claude-sonnet-4',
    'openai/o4-mini',
    'openai/gpt-4.1',
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash',
    'deepseek/deepseek-chat',
    'openai/gpt-4o-mini',
];
/**
 * Call OpenRouter chat completion with full conversation history.
 * This enables multi-turn reasoning where the agent remembers previous actions.
 */
async function callOpenRouter(opts, systemPrompt, userMessage, conversationHistory = [], attachmentPrompt) {
    // Build messages: system + conversation history + current user message
    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-20), // Keep last 20 turns for context
    ];
    if (attachmentPrompt && attachmentPrompt.imageDataUrls.length > 0) {
        const contentParts = [
            {
                type: 'text',
                text: `${userMessage}\n\n${attachmentPrompt.text}`.trim(),
            },
            ...attachmentPrompt.imageDataUrls.slice(0, 3).map((url) => ({
                type: 'image_url',
                image_url: { url },
            })),
        ];
        messages.push({ role: 'user', content: contentParts });
    }
    else {
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
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? '';
    const usage = normalizeUsage(data?.usage);
    return {
        action: parseAgentResponse(raw),
        usage,
    };
}
/**
 * Fetch available models from OpenRouter and return a curated, ranked list
 * optimized for agentic browser tasks.
 */
async function fetchOpenRouterModels(apiKey, limit = 40) {
    try {
        const headers = {
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
        if (!res.ok) {
            throw new Error(`OpenRouter model list failed: ${res.status}`);
        }
        const data = await res.json();
        const ids = Array.isArray(data?.data)
            ? data.data
                .map((m) => String(m?.id || '').trim())
                .filter((id) => id.length > 0)
            : [];
        const deduped = Array.from(new Set(ids));
        const filtered = deduped.filter((id) => isLikelyChatModel(id));
        const ranked = filtered.sort((a, b) => scoreModelId(b) - scoreModelId(a) || a.localeCompare(b));
        const merged = mergeWithFallbacks(ranked, FALLBACK_AGENTIC_MODELS);
        return merged.slice(0, Math.max(10, Math.min(120, limit)));
    }
    catch {
        return [...FALLBACK_AGENTIC_MODELS];
    }
}
function mergeWithFallbacks(primary, fallbacks) {
    const seen = new Set();
    const result = [];
    for (const id of [...primary, ...fallbacks]) {
        const key = id.trim();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        result.push(key);
    }
    return result;
}
function isLikelyChatModel(id) {
    const lower = id.toLowerCase();
    if (/(embedding|rerank|moderation|whisper|transcribe|tts|speech|image|video|vision-only|sdxl|flux|midjourney)/.test(lower)) {
        return false;
    }
    return /(gpt|o4|claude|gemini|gemma|qwen|deepseek|llama|mistral|grok|instruct|chat|sonnet|it)/.test(lower);
}
function scoreModelId(id) {
    const lower = id.toLowerCase();
    let score = 0;
    const priorityIdx = PRIORITY_MODEL_PREFIXES.findIndex((p) => lower.startsWith(p));
    if (priorityIdx >= 0)
        score += (PRIORITY_MODEL_PREFIXES.length - priorityIdx) * 1000;
    if (lower.includes('gemma-3-27b-it'))
        score += 900;
    if (lower.includes('qwen3-32b'))
        score += 850;
    if (lower.includes('claude-sonnet-4'))
        score += 800;
    if (lower.includes('o4-mini'))
        score += 780;
    if (lower.includes('gpt-4.1'))
        score += 760;
    if (lower.includes('gemini-2.5-pro'))
        score += 740;
    if (lower.includes('gemini-2.5-flash'))
        score += 720;
    if (lower.includes('deepseek-chat'))
        score += 700;
    if (lower.includes('gpt-4o-mini'))
        score += 680;
    if (lower.includes(':free'))
        score -= 80;
    if (lower.includes('preview'))
        score -= 20;
    if (lower.includes('experimental'))
        score -= 40;
    return score;
}
/**
 * Extract and parse JSON from the model's response text.
 * Handles markdown code fences if present.
 */
function parseAgentResponse(raw) {
    let cleaned = raw.trim();
    // Strip markdown code fences
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    }
    // Try to find JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error(`No JSON found in model response: ${raw.slice(0, 200)}`);
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
        thought: String(parsed.thought ?? ''),
        action: String(parsed.action ?? 'done'),
        target: String(parsed.target ?? ''),
        value: String(parsed.value ?? ''),
        reason: String(parsed.reason ?? ''),
    };
}
function normalizeUsage(rawUsage) {
    const promptTokens = numberOrZero(rawUsage?.prompt_tokens ??
        rawUsage?.promptTokens ??
        rawUsage?.input_tokens ??
        rawUsage?.input_tokens_details?.text_tokens);
    const completionTokens = numberOrZero(rawUsage?.completion_tokens ??
        rawUsage?.completionTokens ??
        rawUsage?.output_tokens ??
        rawUsage?.output_tokens_details?.text_tokens);
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
function numberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}
//# sourceMappingURL=openrouter.js.map