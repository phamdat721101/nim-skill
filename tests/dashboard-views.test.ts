import { describe, it, expect } from 'vitest';
import { summarizeSavings, summarizeCache } from '../src/monitor/dashboard.js';
import type { TraceRecord } from '../src/harness/types.js';

const base = (over: Partial<TraceRecord>): TraceRecord => ({
  skill: 's',
  traceId: 't',
  startedAt: new Date(0).toISOString(),
  durationMs: 1,
  status: 'success',
  ...over,
});

describe('dashboard --savings view', () => {
  it('reports no data when no ROI traces', () => {
    expect(summarizeSavings([base({})])).toMatch(/no token-ROI/);
  });

  it('aggregates net-negative tokens', () => {
    const out = summarizeSavings([
      base({ tokensSavedEstimate: 100, tokensSpentByHarness: 0, netTokens: -100 }),
      base({ tokensSavedEstimate: 50, tokensSpentByHarness: 0, netTokens: -50 }),
    ]);
    expect(out).toMatch(/tokens saved:\s+~150/);
    expect(out).toMatch(/net-negative ✓/);
  });
});

describe('dashboard --cache view', () => {
  it('reports no data when no cache traces', () => {
    expect(summarizeCache([base({})])).toMatch(/no cache traces/);
  });

  it('aggregates hit-rate + dollars and warns below break-even', () => {
    const out = summarizeCache([
      base({
        cache: { provider: 'anthropic', strategy: 'explicit', cachedTokens: 100, readTokens: 100, writeTokens: 100, tokensSaved: 100, dollarsSaved: 0.0001, hitRate: 0.5, breakEvenOk: false },
      }),
    ]);
    expect(out).toMatch(/hit-rate:/);
    expect(out).toMatch(/break-even/);
  });
});
