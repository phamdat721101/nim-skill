import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHelper } from '../src/memory/index.js';
import { SecretFieldError } from '../src/security/secrets.js';
import { createLogCompactHelper } from '../src/logcompact/index.js';
import { WeeklyBudgetExceededError, WeeklyTokenLedger } from '../src/guard/budget.js';
import { runHarnessed } from '../src/harness/runtime.js';
import { cleanNimArtifacts } from './helpers.js';

const memoryConfig = {
  verifyCache: true,
  priors: true,
  ttlMs: 60_000,
  store: '.nim/payment-memory.jsonl',
  sessionStore: '.nim/payment-sessions.jsonl',
};

describe('typed external session memory', () => {
  afterEach(() => cleanNimArtifacts());

  it('persists a profile-scoped HyperMove session across a helper restart', () => {
    const first = createMemoryHelper(memoryConfig);
    first.setSession('hypermove', {
      agentId: 'agent-a', sessionId: 'paid-session', walletAddress: '0xpublic', quoteId: 'quote-a',
      expiresAt: new Date(Date.now() + 60_000).toISOString(), lastRunId: 'run-a',
    }, { profile: 'operator-a' });

    const restarted = createMemoryHelper(memoryConfig);
    expect(restarted.getSession('hypermove', { profile: 'operator-a' })).toMatchObject({
      provider: 'hypermove', agentId: 'agent-a', sessionId: 'paid-session', quoteId: 'quote-a', lastRunId: 'run-a',
    });
    expect(restarted.getSession('hypermove', { profile: 'operator-b' })).toBeUndefined();
  });

  it('expires and clears sessions deterministically', () => {
    const memory = createMemoryHelper(memoryConfig);
    memory.setSession('hypermove', { sessionId: 'expired' }, { ttlMs: -1 });
    expect(memory.getSession('hypermove')).toBeUndefined();
    memory.setSession('hypermove', { sessionId: 'active' });
    memory.clearSession('hypermove');
    expect(memory.getSession('hypermove')).toBeUndefined();
  });

  it('rejects secret-shaped fields and redacts compacted output', () => {
    const memory = createMemoryHelper(memoryConfig);
    expect(() => memory.setSession('hypermove', { sessionId: 's', privateKey: 'do-not-store' } as never)).toThrow(SecretFieldError);
    const compact = createLogCompactHelper({ strategy: 'cap', maxLines: 10 });
    expect(compact.compact('ERROR privateKey=do-not-store').text).toContain('privateKey=[REDACTED]');
    expect(compact.compact('ERROR privateKey=do-not-store').text).not.toContain('do-not-store');
  });

  it('models a recovered payment workflow: reuse valid state and clear provider mismatch', () => {
    const memory = createMemoryHelper(memoryConfig);
    memory.setSession('hypermove', { agentId: 'agent-a', sessionId: 's1', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const recovered = createMemoryHelper(memoryConfig).getSession('hypermove');
    expect(recovered?.sessionId).toBe('s1'); // caller rechecks this before signing
    memory.clearSession('hypermove'); // provider/status mismatch or settlement failure
    expect(memory.getSession('hypermove')).toBeUndefined();
  });
});

describe('weekly token ledger', () => {
  afterEach(() => cleanNimArtifacts());

  it('persists rolling usage and rejects a cap breach before recording it', () => {
    const ledger = new WeeklyTokenLedger(100, '.nim/payment-weekly-budget.jsonl');
    expect(ledger.spend(60)).toBe(60);
    expect(new WeeklyTokenLedger(100, '.nim/payment-weekly-budget.jsonl').spentTokens()).toBe(60);
    expect(() => ledger.spend(41)).toThrow(WeeklyBudgetExceededError);
    expect(ledger.spentTokens()).toBe(60);
  });

  it('reports weekly usage in a harness trace', async () => {
    const result = await runHarnessed({
      name: 'weekly-budget-test', version: '1', harness: {
        guard: { taskBudgetTokens: 100, weeklyTokenBudget: 50, weeklyBudgetStore: '.nim/payment-weekly-budget.jsonl' },
      },
      execute: (_input, ctx) => {
        ctx.budget?.spend({ tokens: 20 });
        return { ok: true };
      },
    }, {}, { agentId: 'test' });
    expect(result.trace.budget?.weekly).toEqual({ capTokens: 50, spentTokens: 20 });
  });
});
