import { AgentAction, VALID_ACTIONS } from '../shared/types';

/** Sensitive-data keywords that must never appear in a remember value. */
const SENSITIVE_PATTERNS = [
  /password/i,
  /passwd/i,
  /otp/i,
  /secret/i,
  /token/i,
  /credit.?card/i,
  /cvv/i,
  /ssn/i,
  /social.?security/i,
  /bank.?account/i,
  /routing.?number/i,
  /pin\b/i,
];

/**
 * Only flag actions that are ACTUAL financial transactions, not product page links.
 * "Buy now" on a product listing page is just navigation — not a purchase.
 */
const RISKY_ACTIONS_TARGETS = [
  /checkout/i,
  /payment/i,
  /place\s+order/i,
  /confirm\s+(?:purchase|order|payment)/i,
  /submit.*(?:application|form)/i,
  /sign.*(?:contract|agreement)/i,
  /transfer.*(?:fund|money)/i,
  /pay\s+now/i,
  /complete\s+(?:purchase|order)/i,
];

export interface SafetyResult {
  safe: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

/** Validate an agent action before execution. */
export function validateAction(action: AgentAction): SafetyResult {
  // 1. Action must be in the allowed list
  if (!VALID_ACTIONS.includes(action.action as any)) {
    return { safe: false, reason: `Unknown action: "${action.action}"` };
  }

  // 2. No storing sensitive data
  if (action.action === 'remember') {
    for (const pat of SENSITIVE_PATTERNS) {
      if (pat.test(action.value) || pat.test(action.target)) {
        return {
          safe: false,
          reason: 'Blocked: agent attempted to store sensitive data (passwords, tokens, etc.).',
        };
      }
    }
  }

  // 3. No typing sensitive data
  if (action.action === 'type') {
    for (const pat of SENSITIVE_PATTERNS) {
      if (pat.test(action.value)) {
        return {
          safe: false,
          reason: 'Blocked: agent attempted to type sensitive data.',
        };
      }
    }
  }

  // 4. Risky click / navigation — only on checkout/payment pages, not product pages
  if (action.action === 'click' || action.action === 'open_url') {
    const combined = `${action.target} ${action.value} ${action.reason}`;
    for (const pat of RISKY_ACTIONS_TARGETS) {
      if (pat.test(combined)) {
        return {
          safe: true,
          requiresConfirmation: true,
          reason: `This action may involve a financial commitment: "${action.target}". Please confirm.`,
        };
      }
    }
  }

  // 5. Block javascript: and data: URLs
  if (action.action === 'open_url') {
    const url = (action.target || action.value || '').trim().toLowerCase();
    if (url.startsWith('javascript:') || url.startsWith('data:')) {
      return { safe: false, reason: 'Blocked: unsafe URL scheme.' };
    }
  }

  return { safe: true };
}
