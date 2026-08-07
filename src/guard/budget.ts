/**
 * src/guard/budget.ts
 * -------------------
 * v0.8 nim-guard — the `ctx.budget` helper: opt-in LIVE spend accumulation
 * on top of Task 2's pre-flight estimate (decision 5c — both layers exist;
 * this file is the second one). A skill that calls `ctx.budget.spend()` once
 * per LLM call reports real usage as it happens; once the running total
 * crosses the SAME per-task cap the pre-flight check used, further spend
 * throws `BudgetExceededError` so the harness can classify/stop cleanly.
 *
 * A skill that never calls `spend()` is completely unaffected (opt-in
 * instrumentation, not mandatory) — this file's only side effect is the
 * accumulator instance itself, created fresh per `runHarnessed()` call
 * (no shared/global state, unlike PolicyEnforcer's per-agent maps).
 */

import type { BudgetHelper } from '../harness/types.js';
import { basePricePerToken } from '../cache/roi.js';

export class BudgetExceededError extends Error {
  constructor(readonly spentUsd: number, readonly capUsd: number) {
    super(`task budget exceeded: spent $${spentUsd.toFixed(6)} of a $${capUsd.toFixed(6)} cap`);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Build a live BudgetHelper for one run. `capUsd` is the SAME resolved
 * per-task cap (in USD) Task 2's pre-flight check compares against —
 * `spend()` accumulates independently of that pre-flight estimate (the
 * pre-flight check runs once before execute(); this tracks actual spend
 * during execute()), but against the identical ceiling.
 */
export function createBudgetHelper(capUsd: number, isTimedOut: () => boolean): BudgetHelper {
  let spentUsd = 0;
  const pricePerToken = basePricePerToken('anthropic');

  return {
    spend(amount: { usd?: number; tokens?: number }): void {
      const usd = amount.usd ?? (amount.tokens ?? 0) * pricePerToken;
      spentUsd += usd;
      if (spentUsd > capUsd) {
        throw new BudgetExceededError(spentUsd, capUsd);
      }
    },
    timedOut(): boolean {
      return isTimedOut();
    },
    spentUsd(): number {
      return spentUsd;
    },
  };
}
