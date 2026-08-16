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

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BudgetHelper } from '../harness/types.js';
import { basePricePerToken } from '../cache/roi.js';

export class BudgetExceededError extends Error {
  constructor(readonly spentUsd: number, readonly capUsd: number) {
    super(`task budget exceeded: spent $${spentUsd.toFixed(6)} of a $${capUsd.toFixed(6)} cap`);
    this.name = 'BudgetExceededError';
  }
}

export class WeeklyBudgetExceededError extends Error {
  constructor(readonly spentTokens: number, readonly capTokens: number) {
    super(`weekly token budget exceeded: spent ${spentTokens} of a ${capTokens} cap`);
    this.name = 'WeeklyBudgetExceededError';
  }
}

interface WeeklyEntry { at: number; tokens: number }

/** Local append-only ledger. It applies a rolling seven-day window on every spend. */
export class WeeklyTokenLedger {
  constructor(private readonly capTokens: number, private readonly store: string) {}

  spentTokens(now = Date.now()): number {
    if (!existsSync(this.store)) return 0;
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    return readFileSync(this.store, 'utf8').split('\n').reduce((sum, line) => {
      try {
        const entry = JSON.parse(line) as WeeklyEntry;
        return entry.at >= cutoff && Number.isFinite(entry.tokens) ? sum + entry.tokens : sum;
      } catch {
        return sum;
      }
    }, 0);
  }

  spend(tokens: number): number {
    const total = this.spentTokens() + tokens;
    if (total > this.capTokens) throw new WeeklyBudgetExceededError(total, this.capTokens);
    mkdirSync(dirname(this.store), { recursive: true });
    appendFileSync(this.store, JSON.stringify({ at: Date.now(), tokens }) + '\n');
    return total;
  }

  snapshot(): { capTokens: number; spentTokens: number } {
    return { capTokens: this.capTokens, spentTokens: this.spentTokens() };
  }
}

/**
 * Build a live BudgetHelper for one run. `capUsd` is the SAME resolved
 * per-task cap (in USD) Task 2's pre-flight check compares against —
 * `spend()` accumulates independently of that pre-flight estimate (the
 * pre-flight check runs once before execute(); this tracks actual spend
 * during execute()), but against the identical ceiling.
 */
export function createBudgetHelper(
  capUsd: number,
  isTimedOut: () => boolean,
  weekly?: WeeklyTokenLedger,
): BudgetHelper {
  let spentUsd = 0;
  let spentTokens = 0;
  const pricePerToken = basePricePerToken('anthropic');

  return {
    spend(amount: { usd?: number; tokens?: number }): void {
      const tokens = amount.tokens ?? Math.round((amount.usd ?? 0) / pricePerToken);
      const usd = amount.usd ?? tokens * pricePerToken;
      if (weekly) weekly.spend(tokens);
      spentUsd += usd;
      spentTokens += tokens;
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
    spentTokens(): number {
      return spentTokens;
    },
    weekly(): { capTokens: number; spentTokens: number } | undefined {
      return weekly?.snapshot();
    },
  };
}
