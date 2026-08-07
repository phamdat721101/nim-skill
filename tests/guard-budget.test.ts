import { describe, it, expect, vi } from 'vitest';
import { createBudgetHelper, BudgetExceededError } from '../src/guard/budget.js';
import { runHarnessed, HarnessExecutionError } from '../src/harness/runtime.js';
import type { SkillDef, SkillContext, HarnessConfig } from '../src/harness/types.js';

const ctx: SkillContext = { agentId: 'agent-1' };

function skill(over: Partial<SkillDef> & { harness: HarnessConfig; execute: SkillDef['execute'] }): SkillDef {
  return { name: 'demo', version: '0.0.0', ...over };
}

describe('createBudgetHelper (unit)', () => {
  it('accumulates spend() calls and stays quiet while under the cap', () => {
    const b = createBudgetHelper(1, () => false);
    expect(() => b.spend({ usd: 0.3 })).not.toThrow();
    expect(() => b.spend({ usd: 0.3 })).not.toThrow();
    expect(b.spentUsd()).toBeCloseTo(0.6, 5);
  });

  it('throws BudgetExceededError once cumulative spend crosses the cap', () => {
    const b = createBudgetHelper(1, () => false);
    b.spend({ usd: 0.5 });
    b.spend({ usd: 0.4 });
    expect(() => b.spend({ usd: 0.2 })).toThrow(BudgetExceededError);
  });

  it('accepts a token-denominated spend, converting via the shared pricing table', () => {
    const b = createBudgetHelper(1000, () => false);
    expect(() => b.spend({ tokens: 1000 })).not.toThrow();
    expect(b.spentUsd()).toBeGreaterThan(0);
  });

  it('timedOut() mirrors the injected isTimedOut callback', () => {
    let flag = false;
    const b = createBudgetHelper(5, () => flag);
    expect(b.timedOut()).toBe(false);
    flag = true;
    expect(b.timedOut()).toBe(true);
  });
});

describe('runHarnessed — ctx.budget.spend() live accumulation (Task 3)', () => {
  it('a skill calling ctx.budget.spend() repeatedly trips the cap on the over-budget call', async () => {
    const s = skill({
      harness: { guard: { taskBudgetUsd: 1 } },
      execute: (_input, runCtx) => {
        runCtx.budget?.spend({ usd: 0.4 });
        runCtx.budget?.spend({ usd: 0.4 });
        runCtx.budget?.spend({ usd: 0.4 }); // pushes cumulative to 1.2, over the $1 cap
        return { ok: true };
      },
    });
    await expect(runHarnessed(s, {}, ctx)).rejects.toBeInstanceOf(HarnessExecutionError);
  });

  it('a skill that never calls ctx.budget.spend() is completely unaffected (opt-in, not mandatory)', async () => {
    const exec = vi.fn(() => ({ ok: true }));
    const s = skill({ harness: { guard: { taskBudgetUsd: 1 } }, execute: exec });
    const r = await runHarnessed(s, {}, ctx);
    expect(r.trace.status).toBe('success');
    expect(exec).toHaveBeenCalled();
  });

  it('ctx.budget is undefined when no task budget is configured (byte-identical-off)', async () => {
    let sawBudget: unknown;
    const s = skill({
      harness: {},
      execute: (_input, runCtx) => {
        sawBudget = runCtx.budget;
        return { ok: true };
      },
    });
    await runHarnessed(s, {}, ctx);
    expect(sawBudget).toBeUndefined();
  });
});

describe('runHarnessed — AbortController duration cap + ctx.signal (Task 4)', () => {
  it('a skill that polls ctx.signal.aborted stops cooperatively past maxDurationMs, reporting status:error / errorClass:timeout', async () => {
    const s = skill({
      harness: { guard: { maxDurationMs: 30 } },
      execute: async (_input, runCtx) => {
        const start = Date.now();
        // Poll the signal in a loop; a well-behaved skill checks periodically.
        while (Date.now() - start < 500) {
          if (runCtx.signal?.aborted) throw new Error('aborted');
          await new Promise((r) => setTimeout(r, 5));
        }
        return { ok: true };
      },
    });
    try {
      await runHarnessed(s, {}, ctx);
      throw new Error('expected runHarnessed to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(HarnessExecutionError);
      const e = err as InstanceType<typeof HarnessExecutionError>;
      expect(e.error.class).toBe('timeout');
      expect(e.trace?.status).toBe('error');
      expect(e.trace?.errorClass).toBe('timeout');
    }
  });

  it('ctx.budget.timedOut() mirrors ctx.signal.aborted once the cap fires', async () => {
    let sawTimedOut = false;
    const s = skill({
      harness: { guard: { maxDurationMs: 30, taskBudgetUsd: 100 } },
      execute: async (_input, runCtx) => {
        await new Promise((r) => setTimeout(r, 150));
        sawTimedOut = runCtx.budget?.timedOut() ?? false;
        return { ok: true };
      },
    });
    await expect(runHarnessed(s, {}, ctx)).rejects.toBeInstanceOf(HarnessExecutionError);
    // The execute() body itself keeps running (cooperative, not preemptive) and
    // observes timedOut() === true once the cap has fired, even though the race
    // already rejected runHarnessed()'s own await.
    await new Promise((r) => setTimeout(r, 200));
    expect(sawTimedOut).toBe(true);
  });

  it('a skill that IGNORES ctx.signal keeps running past the cap (documented cooperative behavior, not a bug)', async () => {
    let finished = false;
    const s = skill({
      harness: { guard: { maxDurationMs: 20 } },
      execute: async () => {
        await new Promise((r) => setTimeout(r, 100)); // never checks ctx.signal
        finished = true;
        return { ok: true };
      },
    });
    await expect(runHarnessed(s, {}, ctx)).rejects.toBeInstanceOf(HarnessExecutionError);
    expect(finished).toBe(false); // runHarnessed already returned/rejected...
    await new Promise((r) => setTimeout(r, 120));
    expect(finished).toBe(true); // ...but the ignored skill body kept running underneath.
  });

  it('does not install a timer/controller when maxDurationMs is not configured (rollback contract)', async () => {
    let sawSignal: unknown = 'unset';
    const s = skill({
      harness: {},
      execute: (_input, runCtx) => {
        sawSignal = runCtx.signal;
        return { ok: true };
      },
    });
    await runHarnessed(s, {}, ctx);
    expect(sawSignal).toBeUndefined();
  });

  it('clears the timer on a normal fast success (no leaked handle)', async () => {
    const s = skill({ harness: { guard: { maxDurationMs: 5_000 } }, execute: () => ({ ok: true }) });
    const r = await runHarnessed(s, {}, ctx);
    expect(r.trace.status).toBe('success');
    // If the timer were not cleared, this process would be kept alive for 5s;
    // vitest's own afterEach/process teardown would hang. Reaching this
    // assertion at all is the practical proof for a unit-test context.
  });

  it('no timer handles leak across N repeated successful runs with maxDurationMs configured', async () => {
    const s = skill({ harness: { guard: { maxDurationMs: 5_000 } }, execute: () => ({ ok: true }) });
    const before = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? -1;
    for (let i = 0; i < 20; i++) await runHarnessed(s, {}, ctx);
    const after = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? -1;
    if (before >= 0 && after >= 0) {
      // Leaking would grow the handle count roughly linearly with the loop count (20);
      // a healthy clearTimeout keeps it flat (within a small constant slack).
      expect(after - before).toBeLessThan(5);
    }
  });
});

describe('runHarnessed — TraceRecord.budget (Task 5)', () => {
  it('a run with no taskBudget configured has NO budget field on its trace (rollback contract)', async () => {
    const s = skill({ harness: {}, execute: () => ({ ok: true }) });
    const { trace } = await runHarnessed(s, {}, ctx);
    expect(trace).not.toHaveProperty('budget');
  });

  it('a successful run with taskBudgetUsd configured reports capUsd/spentUsd/token-equivalents', async () => {
    const s = skill({
      harness: { guard: { taskBudgetUsd: 2 } },
      execute: (_input, runCtx) => {
        runCtx.budget?.spend({ usd: 0.5 });
        return { ok: true };
      },
    });
    const { trace } = await runHarnessed(s, {}, ctx);
    expect(trace.budget).toBeDefined();
    expect(trace.budget?.capUsd).toBe(2);
    expect(trace.budget?.spentUsd).toBeCloseTo(0.5, 5);
    expect(trace.budget?.capTokensEquivalent).toBeGreaterThan(0);
    expect(trace.budget?.timedOut).toBe(false);
  });

  it('a timed-out run reports budget.timedOut:true on its error trace', async () => {
    const s = skill({
      harness: { guard: { maxDurationMs: 20, taskBudgetUsd: 5 } },
      execute: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { ok: true };
      },
    });
    try {
      await runHarnessed(s, {}, ctx);
      throw new Error('expected rejection');
    } catch (err) {
      const e = err as InstanceType<typeof HarnessExecutionError>;
      expect(e.trace?.budget?.timedOut).toBe(true);
    }
  });
});

describe('runHarnessed — v0.8 full integration + rollback contract (Task 6)', () => {
  it('exercises pre-flight budget deny, live spend() trip, and cooperative timeout in one suite', async () => {
    // 1) Pre-flight deny: a huge input against a near-zero cap, before execute() runs.
    const exec1 = vi.fn(() => ({ ok: true }));
    const denySkill = skill({ harness: { guard: { taskBudgetUsd: 0.000001 } }, execute: exec1 });
    await expect(runHarnessed(denySkill, { blob: 'x'.repeat(50_000) }, ctx)).rejects.toThrow(/task_budget_exceeded/);
    expect(exec1).not.toHaveBeenCalled();

    // 2) Live spend() trip: execute() runs, but repeated ctx.budget.spend() calls cross the cap mid-run.
    const spendSkill = skill({
      harness: { guard: { taskBudgetUsd: 1 } },
      execute: (_input, runCtx) => {
        runCtx.budget?.spend({ usd: 0.6 });
        runCtx.budget?.spend({ usd: 0.6 }); // 1.2 > 1.0 cap
        return { ok: true };
      },
    });
    await expect(runHarnessed(spendSkill, {}, ctx)).rejects.toBeInstanceOf(HarnessExecutionError);

    // 3) Cooperative timeout: a skill that polls ctx.signal stops and reports errorClass 'timeout'.
    const timeoutSkill = skill({
      harness: { guard: { maxDurationMs: 25 } },
      execute: async (_input, runCtx) => {
        const start = Date.now();
        while (Date.now() - start < 300) {
          if (runCtx.signal?.aborted) throw new Error('aborted');
          await new Promise((r) => setTimeout(r, 5));
        }
        return { ok: true };
      },
    });
    try {
      await runHarnessed(timeoutSkill, {}, ctx);
      throw new Error('expected rejection');
    } catch (err) {
      const e = err as InstanceType<typeof HarnessExecutionError>;
      expect(e.error.class).toBe('timeout');
    }

    // 4) Rollback contract: a guard config with NONE of the v0.8 fields set STILL
    // gets the documented $5 default taskBudget (that's the intended default,
    // not a rollback break) — ctx.budget is injected and the trace carries a
    // budget field. The precise byte-identical-off case ("no guard block at
    // all" ⇒ no signal, no budget, no budget trace) is covered by the
    // dedicated test right after this one.
    let sawSignal: unknown = 'unset';
    let sawBudget: unknown = 'unset';
    const plainSkill = skill({
      harness: { guard: { ratePerMin: 30, allowTools: ['*'] } },
      execute: (_input, runCtx) => {
        sawSignal = runCtx.signal;
        sawBudget = runCtx.budget;
        return { echo: 'hi' };
      },
    });
    const r = await runHarnessed(plainSkill, {}, ctx);
    expect(r.trace.status).toBe('success');
    expect(r.output).toEqual({ echo: 'hi' });
    // A present guard block resolves BOTH v0.8 defaults (taskBudget=$5,
    // maxDurationMs=300_000ms) — so ctx.signal IS populated too, by design.
    expect(sawSignal).toBeDefined();
    expect(sawBudget).toBeDefined(); // guard block present ⇒ $5 default taskBudget ⇒ ctx.budget IS injected
    expect(r.trace.budget?.capUsd).toBe(5);
  });

  it('rollback contract, precise: an absent guard block is byte-identical to pre-v0.8 (no signal, no budget, no budget trace)', async () => {
    let sawSignal: unknown = 'unset';
    let sawBudget: unknown = 'unset';
    const s = skill({
      harness: {},
      execute: (_input, runCtx) => {
        sawSignal = runCtx.signal;
        sawBudget = runCtx.budget;
        return { echo: 'hi' };
      },
    });
    const r = await runHarnessed(s, {}, ctx);
    expect(r.trace.status).toBe('success');
    expect(sawSignal).toBeUndefined();
    expect(sawBudget).toBeUndefined();
    expect(r.trace).not.toHaveProperty('budget');
  });
});
