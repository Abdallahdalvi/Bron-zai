/**
 * aiActions.ts
 *
 * Implements Skyvern-style high-level AI browser commands:
 *   - act(prompt)      → take screenshot, LLM decides action, execute it
 *   - extract(prompt)  → take screenshot, LLM extracts structured data
 *   - validate(prompt) → take screenshot, LLM answers true/false
 *
 * These act as a Vision-LLM layer on top of Bron's existing Electron primitives.
 */

import type { AgentAutomationController } from './agentAutomation';
import type { OpenRouterOptions } from './openrouter';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Lightweight vision LLM call — no agent action parsing, just raw JSON response */
async function callVisionLLM(
  opts: OpenRouterOptions,
  systemPrompt: string,
  userText: string,
  screenshotDataUrl: string,
): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Bron AI Actions',
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.1,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: screenshotDataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Vision LLM error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? '');
}

function extractJSON(raw: string): any {
  // Strip markdown code fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1].trim() : raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in LLM response');
  return JSON.parse(text.slice(start, end + 1));
}

// ─────────────────────────────────────────────────────────────────────
// act(prompt) — Perform a natural language action on the current page
// ─────────────────────────────────────────────────────────────────────
const ACT_SYSTEM = `You are an expert browser automation agent. 
Given a screenshot of a web browser and an instruction, determine the ONE best atomic action to perform.
Only use coordinates that are clearly visible and interactable on screen.

Respond with ONLY a JSON object:
{
  "action": "click_at" | "fill" | "press_key" | "hover_at" | "scroll" | "select_option",
  "x": <number, pixel x if click_at/hover_at>,
  "y": <number, pixel y if click_at/hover_at>,
  "selector": "<CSS selector if fill/select_option>",
  "value": "<text to fill or option value>",
  "key": "<key name if press_key, e.g. Enter, Tab, Escape>",
  "direction": "<'up'|'down'|'left'|'right' if scroll>",
  "reason": "<brief explanation>"
}

Rules:
- For buttons/links, use click_at with the CENTER pixel coordinates visible in the screenshot.
- For inputs, prefer fill with the selector.
- If a form needs submitting, use press_key with key "Enter" or click_at on the Submit button.
- Never hallucinate coordinates outside the visible viewport.`;

export async function act(
  bc: AgentAutomationController,
  opts: OpenRouterOptions,
  prompt: string,
): Promise<string> {
  const screenshot = await bc.getScreenshot();
  if (!screenshot) return 'act() failed: could not capture screenshot';

  let raw: string;
  try {
    raw = await callVisionLLM(opts, ACT_SYSTEM, `Instruction: ${prompt}`, screenshot);
  } catch (e: any) {
    return `act() LLM error: ${e.message}`;
  }

  let spec: any;
  try {
    spec = extractJSON(raw);
  } catch {
    return `act() parse error — LLM returned: ${raw.slice(0, 300)}`;
  }

  const { action, x, y, selector, value, key, direction } = spec;
  try {
    switch (action) {
      case 'click_at':
        return await bc.clickAt(Number(x), Number(y));
      case 'hover_at':
        return await bc.hoverAt(Number(x), Number(y));
      case 'fill':
        return await bc.typeText(String(selector || ''), String(value || ''));
      case 'press_key':
        return await bc.pressKey(String(key || 'Enter'));
      case 'scroll':
        return await bc.scroll(String(direction || 'down'));
      case 'select_option':
        return await bc.selectOption(String(selector || ''), String(value || ''));
      default:
        return `act() unknown action: ${action}`;
    }
  } catch (e: any) {
    return `act() execution error: ${e.message}`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// extract(prompt, schema?) — Extract structured data from the page
// ─────────────────────────────────────────────────────────────────────
const EXTRACT_SYSTEM = `You are a data extraction agent for a web browser.
Given a screenshot of a web page and an extraction instruction, extract the requested information.
Return ONLY a valid JSON object matching the requested schema.
Do not add commentary. Do not wrap in markdown unless asked.
If data is not found, return null for that field.`;

export async function extract(
  bc: AgentAutomationController,
  opts: OpenRouterOptions,
  prompt: string,
  schema?: Record<string, unknown>,
): Promise<string> {
  const screenshot = await bc.getScreenshot();
  if (!screenshot) return JSON.stringify({ error: 'extract() failed: could not capture screenshot' });

  const schemaHint = schema
    ? `\n\nReturn JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`
    : '\n\nReturn the extracted data as a JSON object.';

  let raw: string;
  try {
    raw = await callVisionLLM(opts, EXTRACT_SYSTEM, `Extract: ${prompt}${schemaHint}`, screenshot);
  } catch (e: any) {
    return JSON.stringify({ error: `extract() LLM error: ${e.message}` });
  }

  // Try to parse as JSON; if not valid, return raw text
  try {
    const parsed = extractJSON(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw.trim();
  }
}

// ─────────────────────────────────────────────────────────────────────
// validate(prompt) — Assert page state, returns "true"/"false" + reason
// ─────────────────────────────────────────────────────────────────────
const VALIDATE_SYSTEM = `You are a browser state validation agent.
Given a screenshot of a web browser and a yes/no question, answer with a JSON object.
Respond ONLY with:
{
  "result": true | false,
  "reason": "<brief explanation of what you see>"
}`;

export async function validate(
  bc: AgentAutomationController,
  opts: OpenRouterOptions,
  prompt: string,
): Promise<string> {
  const screenshot = await bc.getScreenshot();
  if (!screenshot) return JSON.stringify({ result: false, reason: 'validate() failed: no screenshot' });

  let raw: string;
  try {
    raw = await callVisionLLM(opts, VALIDATE_SYSTEM, `Question: ${prompt}`, screenshot);
  } catch (e: any) {
    return JSON.stringify({ result: false, reason: `validate() LLM error: ${e.message}` });
  }

  try {
    const parsed = extractJSON(raw);
    return JSON.stringify(parsed);
  } catch {
    // Best-effort: check if the response contains true/false
    const lower = raw.toLowerCase();
    const result = lower.includes('true') && !lower.includes('false') ? true : false;
    return JSON.stringify({ result, reason: raw.slice(0, 200) });
  }
}
