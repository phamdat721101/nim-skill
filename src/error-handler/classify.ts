/**
 * src/error-handler/classify.ts
 * -----------------------------
 * Classify a thrown error into transient / permanent / critical (Taskade 2026
 * error-recovery discipline). Order matters: an explicit hint on the error
 * wins; then critical (auth/safety/data-loss) — never retried; then transient
 * (network/rate/timeout) — retryable; else permanent (bad input/logic).
 *
 * v0.13 — also runs the message through `lookupRemediation()` (remediation.ts)
 * and spreads a matched `{errorType, actionRequired}` onto the return value.
 * Optional 3rd param, additive-only: existing 2-arg call sites are unaffected.
 */

import type { ErrorClass } from '../harness/types.js';
import { lookupRemediation, type RemediationRule } from './remediation.js';

const CRITICAL = /\b(unauthorized|forbidden|permission denied|auth\w*|data[-\s]?loss|corrupt\w*)\b|\b40[13]\b/i;
const TRANSIENT = /\b(timeout|timed out|econnreset|econnrefused|etimedout|enotfound|network|rate[-\s]?limit\w*|too many requests|temporarily|unavailable)\b|\b(429|503|504)\b/i;

function messageOf(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function classify(
  err: unknown,
  expectedErrorPatterns?: readonly RegExp[] | null,
  remediationRules?: readonly RemediationRule[],
): { class: ErrorClass; message: string; errorType?: string; actionRequired?: string } {
  const message = messageOf(err);
  const remediation = lookupRemediation(message, remediationRules);

  // Explicit hint on the error object takes precedence.
  const hint = (err as { class?: ErrorClass } | null)?.class;
  if (hint === 'transient' || hint === 'permanent' || hint === 'critical' || hint === 'timeout') {
    return { class: hint, message, ...(remediation ?? {}) };
  }

  if (expectedErrorPatterns && !expectedErrorPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(message);
  })) return { class: 'ambiguous', message, ...(remediation ?? {}) };

  if (CRITICAL.test(message)) return { class: 'critical', message, ...(remediation ?? {}) };
  if (TRANSIENT.test(message)) return { class: 'transient', message, ...(remediation ?? {}) };
  return { class: 'permanent', message, ...(remediation ?? {}) };
}

export function isRetryable(cls: ErrorClass): boolean {
  return cls === 'transient';
}
