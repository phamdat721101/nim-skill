import { describe, it, expect } from 'vitest';
import { summarizeSavings, summarizeCache, summarizeBudget, summarizeLogCompact, summarizeProposal } from '../src/monitor/dashboard.js';
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

describe('dashboard --logcompact view (v0.9 nim-logcompact)', () => {
  it('reports no data when no logCompact traces', () => {
    expect(summarizeLogCompact([base({})])).toMatch(/no logCompact traces/);
  });

  it('aggregates original/compacted chars and average reduction%', () => {
    const out = summarizeLogCompact([
      base({ logCompact: { originalChars: 1000, compactedChars: 100, reductionPct: 90 } }),
      base({ logCompact: { originalChars: 2000, compactedChars: 400, reductionPct: 80 } }),
    ]);
    expect(out).toMatch(/original chars:\s+3000/);
    expect(out).toMatch(/compacted chars:\s+500/);
    expect(out).toMatch(/avg reduction:\s+85%/);
  });
});

describe('dashboard --propose view (v0.9 nim-propose)', () => {
  it('reports no data when no proposal traces', () => {
    expect(summarizeProposal([base({})])).toMatch(/no proposal traces/);
  });

  it('aggregates approved vs denied counts and deny-reason breakdown', () => {
    const out = summarizeProposal([
      base({ proposal: { required: true, approved: true } }),
      base({ proposal: { required: true, approved: false, reason: 'no_proposal' } }),
      base({ proposal: { required: true, approved: false, reason: 'approval_expired' } }),
    ]);
    expect(out).toMatch(/approved:\s+1\/3/);
    expect(out).toMatch(/denied:\s+2\/3/);
    expect(out).toMatch(/no_proposal=1/);
    expect(out).toMatch(/approval_expired=1/);
  });
});

describe('dashboard --budget view (v0.8 nim-guard)', () => {
  it('reports no data when no budget traces', () => {
    expect(summarizeBudget([base({})])).toMatch(/no budget traces/);
  });

  it('aggregates spend vs cap and counts timeouts', () => {
    const out = summarizeBudget([
      base({ budget: { capUsd: 5, spentUsd: 1.5, capTokensEquivalent: 1_000_000, spentTokensEquivalent: 300_000, timedOut: false } }),
      base({ budget: { capUsd: 5, spentUsd: 5.2, capTokensEquivalent: 1_000_000, spentTokensEquivalent: 1_040_000, timedOut: true } }),
    ]);
    expect(out).toMatch(/total spent:\s+~\$6\.700000/);
    expect(out).toMatch(/timeouts:\s+1\/2/);
    expect(out).toMatch(/⏱ TIMEOUT/);
  });

  it('renders a distinct row for a timed-out run without throwing', () => {
    expect(() =>
      summarizeBudget([base({ budget: { capUsd: 1, spentUsd: 1, capTokensEquivalent: 100, spentTokensEquivalent: 100, timedOut: true } })]),
    ).not.toThrow();
  });
});
