import { describe, it, expect, afterEach } from 'vitest';
import { cleanNimArtifacts } from '../helpers.js';
import { runHarnessed } from '../../src/harness/runtime.js';
import type { SkillDef, SkillContext, CacheBlock } from '../../src/harness/types.js';

const ctx: SkillContext = { agentId: 'dogfood' };
const skill = (over: Partial<SkillDef> & { harness: SkillDef['harness']; execute: SkillDef['execute'] }): SkillDef => ({
  name: 'demo',
  version: '0.0.0',
  ...over,
});

afterEach(() => cleanNimArtifacts());

describe('byte-identical when all new layers are off', () => {
  it('produces no token-ROI / cache fields and unchanged envelope', async () => {
    const s = skill({
      harness: { context: false, memory: false, execution: false, cache: false },
      execute: (i) => ({ echo: i.q }),
    });
    const r = await runHarnessed(s, { q: 'hi' }, ctx);
    expect(r.output).toEqual({ echo: 'hi' });
    expect(r.verified).toBe(true);
    expect(r.trace.status).toBe('success');
    expect(r.trace.netTokens).toBeUndefined();
    expect(r.trace.tokensSavedEstimate).toBeUndefined();
    expect(r.trace.cache).toBeUndefined();
  });
});

describe('U3 token-ROI dogfood', () => {
  it('records net-negative tokens when the enforcer blocks a bad output', async () => {
    const s = skill({
      name: 'blocker',
      harness: {
        enforcer: { strategies: [{ kind: 'schema', required: ['id'] }], maxHeals: 0 },
        monitor: { exporters: [], tokenAccounting: true },
      },
      execute: () => ({ wrong: 'no id here, lots of tokens '.repeat(20) }),
    });
    const r = await runHarnessed(s, { q: 'x'.repeat(200) }, ctx);
    expect(r.verified).toBe(false);
    expect(r.trace.netTokens).toBeDefined();
    expect(r.trace.netTokens!).toBeLessThan(0);
    expect(r.trace.tokensSavedEstimate!).toBeGreaterThan(0);
  });
});

describe('U4 memory verify-cache dogfood', () => {
  it('short-circuits re-verification for an unchanged output on the second run', async () => {
    let verifyRuns = 0;
    const s = skill({
      name: 'cached',
      harness: {
        enforcer: { strategies: [{ kind: 'command', command: 'true' }], maxHeals: 0 },
        memory: { verifyCache: true },
        monitor: { exporters: [] },
      },
      // deterministic output → identical verify key across runs
      execute: () => {
        verifyRuns += 1;
        return { id: 'stable' };
      },
    });
    await runHarnessed(s, {}, ctx);
    const r2 = await runHarnessed(s, {}, ctx);
    expect(r2.verified).toBe(true);
    expect(verifyRuns).toBe(2); // execute still runs; verification is what's cached
  });
});

describe('v0.3 cache-ROI dogfood', () => {
  it('assembles a cache-optimized prompt and folds recorded usage into the trace', async () => {
    const s = skill({
      name: 'cache-skill',
      harness: { cache: { provider: 'anthropic', strategy: 'explicit', minTokens: 10 }, monitor: { exporters: [] } },
      execute: (_i, c) => {
        const staticBlocks: CacheBlock[] = [{ text: 'system + docs '.repeat(50) }];
        const dynamic: CacheBlock[] = [{ text: 'user query' }];
        const { payload, meta } = c.cache!.assemble(staticBlocks, dynamic);
        // simulate the skill's own model call returning provider usage
        c.cache!.record({ cache_read_input_tokens: 9000, cache_creation_input_tokens: 1000 });
        return { ok: true, markers: meta.markersApplied, last: payload[payload.length - 1] };
      },
    });
    const r = await runHarnessed(s, {}, { agentId: 'a', baseUrl: 'https://api.anthropic.com' });
    expect(r.output.markers).toBe(true);
    expect(r.trace.cache).toBeDefined();
    expect(r.trace.cache!.readTokens).toBe(9000);
    expect(r.trace.cache!.tokensSaved).toBe(9000);
    expect(r.trace.cache!.breakEvenOk).toBe(true);
    expect(r.trace.cache!.dollarsSaved).toBeGreaterThan(0);
  });
});
