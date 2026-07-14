/**
 * src/tokens.ts
 * -------------
 * One approximate token estimator, shared by U3 token-ROI and nim-cache
 * assembly. Deliberately a single source of truth (no per-module copy).
 *
 * Heuristic: ~4 chars per token. This is an ESTIMATE, never a billed truth —
 * every caller labels it as approximate. No tokenizer dependency (local-first).
 */

const CHARS_PER_TOKEN = 4;

/** Approximate tokens for a string. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Approximate tokens for any serializable value (strings measured directly). */
export function estimateTokensOf(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return estimateTokens(value);
  try {
    return estimateTokens(JSON.stringify(value) ?? '');
  } catch {
    return 0;
  }
}
