/**
 * src/profile/patterns.ts
 * -------------------------
 * Built-in name-pattern seed lists for tier detection. Explicitly illustrative
 * and user-extendable, not authoritative (docs/prd/12-final-prd-v04.md §6,
 * P4-13; pre-mortem T3) — a stale pattern degrades safely (see index.ts's
 * resolution order: no match ⇒ open-weight-untested, the strictest tier).
 */

/** Known frontier models with independently strong baseline instruction-following. */
export const FRONTIER_PATTERNS: readonly RegExp[] = [
  /^claude-opus-/i,
  /^claude-sonnet-4\.[6-9]/i,
  /^claude-sonnet-[5-9]/i,
  /^gpt-5\.[4-9]/i,
  /^gpt-[6-9]/i,
];

/** Illustrative seed list of open-weight models with cited evidence of tying/beating a frontier baseline. */
export const VERIFIED_SEED_PATTERNS: readonly RegExp[] = [/^glm-5/i, /^minimax-m3/i];
