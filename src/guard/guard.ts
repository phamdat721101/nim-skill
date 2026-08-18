/**
 * src/guard/guard.ts
 * ------------------
 * The safety gate that runs BEFORE a skill executes. Two responsibilities:
 *   validate(input)   — Zod schema (optional) + agentjacking injection scan
 *   checkPolicy(ctx)  — cost cap / rate limit / tool allowlist
 * Both throw GuardError on breach, so a buggy/malicious skill body never runs.
 *
 * Reuses the shared injection heuristic (never duplicated) and the bounded
 * PolicyEnforcer. Decoupled from any web framework — operates on plain input.
 */

import type { ZodType } from 'zod';
import type { ResolvedGuard } from '../config.js';
import { scanPayload } from './injection.js';
import { PolicyEnforcer } from './policy.js';
import { checkProposal } from './propose.js';

export type GuardReason =
  | 'invalid_input'
  | 'prompt_injection'
  | 'tool_not_allowed'
  | 'rate_limited'
  | 'cost_cap_exceeded'
  | 'task_budget_exceeded'
  | 'proposal_required'
  | 'cost_gate_blocked';

export class GuardError extends Error {
  constructor(readonly reason: GuardReason, message?: string) {
    super(message ?? reason);
    this.name = 'GuardError';
  }
}

export interface GuardPolicyContext {
  agentId: string;
  tool?: string;
  /** Fed into the existing CUMULATIVE/rolling maxCostUsd window (unchanged v0.1-v0.7 semantics). */
  costUsd?: number;
  /** v0.8 — fed into the per-task (non-cumulative, resets every call) taskBudgetUsd check. Independent of `costUsd` (decision 4). */
  taskCostUsd?: number;
  /** v0.9 — the task's description text, used to look up its proposal artifact when `guard.propose.require` is true. Checked BEFORE cost/rate/budget (deterministic ordering — see propose.test.ts). */
  taskDescription?: string;
}

export interface Guard {
  /** Zod-validate (if a schema is given) + injection scan. Throws GuardError. */
  validate<T>(input: T, schema?: ZodType<T>): T;
  /** Cost cap / rate / allowlist. Throws GuardError on breach. */
  checkPolicy(ctx: GuardPolicyContext): void;
}

class ActiveGuard implements Guard {
  private readonly policy: PolicyEnforcer;

  constructor(private readonly cfg: ResolvedGuard) {
    this.policy = new PolicyEnforcer({
      maxCostUsd: cfg.maxCostUsd,
      ratePerMin: cfg.ratePerMin,
      allowTools: cfg.allowTools,
      taskBudgetUsd: cfg.taskBudget?.usd ?? null,
    });
  }

  validate<T>(input: T, schema?: ZodType<T>): T {
    let value = input;
    if (schema) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        throw new GuardError('invalid_input', parsed.error.message);
      }
      value = parsed.data;
    }
    if (this.cfg.injection === 'strict' && scanPayload(value)) {
      throw new GuardError('prompt_injection', 'input matched an injection heuristic');
    }
    return value;
  }

  checkPolicy(ctx: GuardPolicyContext): void {
    // v0.9 nim-propose — checked FIRST, before cost/rate/budget (deterministic
    // ordering, regression-tested in propose.test.ts): a task with no approved
    // plan should surface `proposal_required`, not an unrelated budget/cost
    // denial that happens to also apply to the same call.
    if (this.cfg.propose) {
      const result = checkProposal(ctx.taskDescription ?? '', this.cfg.propose);
      if (!result.approved) {
        throw new GuardError('proposal_required', `proposal ${result.reason} for task`);
      }
    }
    const reason = this.policy.check(ctx.agentId, ctx.tool, ctx.costUsd ?? 0, ctx.taskCostUsd ?? 0);
    if (reason) {
      const code = reason.startsWith('tool_not_allowed')
        ? 'tool_not_allowed'
        : (reason as GuardReason);
      throw new GuardError(code, reason);
    }
  }
}

class DisabledGuard implements Guard {
  validate<T>(input: T): T {
    return input;
  }
  checkPolicy(): void {
    /* no-op passthrough */
  }
}

/** Build a guard from resolved config. `null` ⇒ disabled (no-op passthrough). */
export function createGuard(cfg: ResolvedGuard | null): Guard {
  return cfg ? new ActiveGuard(cfg) : new DisabledGuard();
}
