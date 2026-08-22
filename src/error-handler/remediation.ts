/**
 * src/error-handler/remediation.ts
 * ---------------------------------
 * Deterministic, pure remediation lookup — same regex-test discipline as
 * classify.ts's CRITICAL/TRANSIENT patterns, same "one concern, one file"
 * precedent as circuit-breaker.ts sitting beside classify.ts. Answers "given
 * this classified error's message, what specific category is it, and what
 * should the calling agent do next?" — a question `class` (transient/
 * permanent/critical/timeout/ambiguous) deliberately does not answer, because
 * `class` exists to drive retry/backoff/escalate policy, not agent behavior.
 *
 * v0.13 nim-error-handler. Zero I/O, no filesystem, no clock reads — pure
 * functions only.
 */

export interface RemediationRule {
  pattern: RegExp;
  errorType: string;
  actionRequired: string;
}

export const DEFAULT_REMEDIATION_TABLE: readonly RemediationRule[] = [
  {
    pattern: /\b(enoent|no such file|file not found|cannot find)\b/i,
    errorType: 'file-not-found',
    actionRequired: 'Stop guessing the path. List the parent directory to verify the exact name before retrying.',
  },
  {
    pattern: /\b(compilation failed|compile error|syntax error|type error)\b/i,
    errorType: 'compilation-failed',
    actionRequired: 'Read only the first reported failure location. Do not modify files unrelated to that location.',
  },
  {
    pattern: /\b(invalid (arguments?|schema)|malformed (input|request)|unexpected (token|argument))\b/i,
    errorType: 'tool-syntax-error',
    actionRequired: 'The arguments did not match the tool schema. Re-check required fields and types before retrying — do not repeat the same call unchanged.',
  },
  {
    pattern: /\bno matches? found|zero results?|0 (files|results) found\b/i,
    errorType: 'search-zero-results',
    actionRequired: 'A single zero-result search is not proof of absence. Verify with a second, independent method (e.g. a direct filesystem check) before concluding the target does not exist.',
  },
];

/**
 * Pure lookup — `extraRules` (if provided) is checked BEFORE
 * `DEFAULT_REMEDIATION_TABLE`, so a project-supplied rule can override a
 * default without forking this file. First matching rule wins. Returns
 * `undefined` when nothing matches — the byte-identical fallback callers
 * rely on.
 */
export function lookupRemediation(
  message: string,
  extraRules?: readonly RemediationRule[],
): { errorType: string; actionRequired: string } | undefined {
  const table = extraRules ? [...extraRules, ...DEFAULT_REMEDIATION_TABLE] : DEFAULT_REMEDIATION_TABLE;
  for (const rule of table) {
    if (rule.pattern.test(message)) return { errorType: rule.errorType, actionRequired: rule.actionRequired };
  }
  return undefined;
}
