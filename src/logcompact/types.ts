/**
 * src/logcompact/types.ts
 * ------------------------
 * `nim-logcompact` — compresses raw subprocess/tool output (stdout/stderr,
 * log tails) BEFORE it reaches an agent's context. Distinct verb from
 * `nim-context` (which budgets/warns on a run's total token size): this
 * module shrinks one string's content, `nim-context` gates a run's overall
 * size. Same "distinct verb, own module" precedent that already separates
 * `context`/`memory`/`cache` — see AGENTS.md.
 */

export type CompactStrategy = 'cap' | 'errors-only' | 'incremental';

export interface LogCompactConfig {
  /** Max lines kept after filtering (or shown in an incremental summary). Default 100. */
  maxLines?: number;
  /** Default 'errors-only' — the highest-value default per the cited evidence (bswen.com 2026-03-02). */
  strategy?: CompactStrategy;
  /** If filtering yields nothing, fall back to a capped-but-unfiltered slice rather than hiding output. Default true. */
  escalateOnEmpty?: boolean;
}

export interface CompactResult {
  text: string;
  originalChars: number;
  compactedChars: number;
  /** 0-100, rounded. Never negative — a result larger than its input still reports 0, not a negative number. */
  reductionPct: number;
}

export interface LogCompactHelper {
  compact(raw: string): CompactResult;
}
