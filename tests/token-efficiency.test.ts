import { describe, it, expect, afterEach } from 'vitest';
import { cleanNimArtifacts } from './helpers.js';
import { computeTokenRoi } from '../src/monitor/roi.js';
import { createContextHelper, ContextBudgetError } from '../src/context/index.js';
import { createMemoryHelper, verifyKey } from '../src/memory/index.js';
import { toTerminal, assertTerminal, SerializeGuardError } from '../src/serialize/index.js';
import { estimateTokens } from '../src/tokens.js';

describe('U3 computeTokenRoi', () => {
  it('credits a full avoided run on guard denial (net-negative)', () => {
    const r = computeTokenRoi({ status: 'denied', heals: 0, baselineTokens: 100 });
    expect(r.tokensSavedEstimate).toBe(100);
    expect(r.tokensSpentByHarness).toBe(0);
    expect(r.netTokens).toBe(-100);
  });

  it('credits an avoided blind-retry loop on permanent error', () => {
    expect(computeTokenRoi({ status: 'error', errorClass: 'permanent', heals: 0, baselineTokens: 50 }).netTokens).toBe(-50);
  });

  it('credits a blocked bad output (verified:false)', () => {
    expect(computeTokenRoi({ status: 'success', verified: false, heals: 1, baselineTokens: 40 }).tokensSavedEstimate).toBe(40);
  });

  it('claims nothing for a clean verified success', () => {
    expect(computeTokenRoi({ status: 'success', verified: true, heals: 0, baselineTokens: 100 }).tokensSavedEstimate).toBe(0);
  });
});

describe('U1 context budget', () => {
  it('is always ok when disabled (passthrough)', () => {
    expect(createContextHelper(null).budget(1e9)).toEqual({ action: 'ok', overBudget: false });
  });

  it("warns/compacts/blocks per onExceed", () => {
    expect(createContextHelper({ progressive: true, maxInputTokens: 10, onExceed: 'warn', lean: false }).budget(50))
      .toEqual({ action: 'warn', overBudget: true });
    expect(createContextHelper({ progressive: true, maxInputTokens: 10, onExceed: 'compact', lean: false }).budget(50).action)
      .toBe('compact');
    expect(() =>
      createContextHelper({ progressive: true, maxInputTokens: 10, onExceed: 'block', lean: false }).budget(50),
    ).toThrow(ContextBudgetError);
  });

  it('is ok under budget', () => {
    expect(createContextHelper({ progressive: true, maxInputTokens: 100, onExceed: 'block', lean: false }).budget(estimateTokens('hi')).action).toBe('ok');
  });
});

describe('U4 memory-lite verify cache', () => {
  const store = '.nim/test-memory.jsonl';
  const cfg = { verifyCache: true, priors: true, ttlMs: 60_000, store };

  it('hits on an identical output+strategies key, misses on TTL expiry', () => {
    const m = createMemoryHelper(cfg);
    const key = verifyKey({ id: 'x' }, [{ kind: 'schema', required: ['id'] }]);
    expect(m.getVerify(key)).toBeUndefined();
    m.setVerify(key, true);
    expect(m.getVerify(key)).toBe(true);

    const expired = createMemoryHelper({ ...cfg, ttlMs: -1, store: '.nim/test-memory-exp.jsonl' });
    expired.setVerify('k', true);
    expect(expired.getVerify('k')).toBeUndefined();
  });

  it('stores + reads priors; disabled helper is a no-op', () => {
    const m = createMemoryHelper(cfg);
    m.setPrior('invoice', { approach: 'sum-check' });
    expect(m.getPrior('invoice')).toEqual({ approach: 'sum-check' });
    expect(createMemoryHelper(null).getVerify('k')).toBeUndefined();
  });

  afterEach(() => cleanNimArtifacts());
});

describe('U5b terminal-only serialization', () => {
  it('defaults to JSON', () => {
    expect(toTerminal({ a: 1 })).toBe('{"a":1}');
  });

  it('tabularizes a uniform array (real key de-dup reduction)', () => {
    const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
    const toon = toTerminal(rows, 'toon');
    expect(toon).toBe('id,name\n1,a\n2,b');
    expect(toon.length).toBeLessThan(JSON.stringify(rows).length);
    expect(toTerminal(rows, 'tron')).toBe('id|name\n1|a\n2|b');
  });

  it('enforces terminal-only guardrail for non-JSON formats', () => {
    expect(() => assertTerminal('toon', false)).toThrow(SerializeGuardError);
    expect(() => toTerminal([{ a: 1 }], 'toon', false)).toThrow(SerializeGuardError);
    expect(assertTerminal('json', false)).toBeUndefined(); // json always allowed
  });
});
