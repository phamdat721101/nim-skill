/**
 * src/context/index.ts
 * --------------------
 * U1 `nim-context` — the "see" verb at runtime. A per-run token budget helper
 * injected as `ctx.context`. Deterministic (~0 model tokens): it only compares
 * an estimate against a configured ceiling and returns the policy action.
 *
 * `null` config ⇒ a no-op helper whose budget() is always 'ok' — byte-identical
 * to a bare run (rollback contract).
 */

import type { ResolvedContext } from '../config.js';
import type { ContextHelper, BudgetAction } from '../harness/types.js';

/** Thrown when a run's estimated context exceeds the budget and onExceed='block'. */
export class ContextBudgetError extends Error {
  constructor(
    readonly estimatedTokens: number,
    readonly maxInputTokens: number,
  ) {
    super(`context budget exceeded: ~${estimatedTokens} > ${maxInputTokens} tokens (estimate)`);
    this.name = 'ContextBudgetError';
  }
}

class ActiveContext implements ContextHelper {
  constructor(private readonly cfg: ResolvedContext) {}

  budget(estimatedTokens: number): { action: BudgetAction; overBudget: boolean } {
    if (estimatedTokens <= this.cfg.maxInputTokens) return { action: 'ok', overBudget: false };
    if (this.cfg.onExceed === 'block') {
      throw new ContextBudgetError(estimatedTokens, this.cfg.maxInputTokens);
    }
    return { action: this.cfg.onExceed === 'compact' ? 'compact' : 'warn', overBudget: true };
  }
}

class DisabledContext implements ContextHelper {
  budget(): { action: BudgetAction; overBudget: boolean } {
    return { action: 'ok', overBudget: false };
  }
}

export function createContextHelper(cfg: ResolvedContext | null): ContextHelper {
  return cfg ? new ActiveContext(cfg) : new DisabledContext();
}
