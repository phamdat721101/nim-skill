import { describe, it, expect } from 'vitest';
import { createCacheHelper } from '../src/cache/index.js';
import { pickAdapter, parseUsage } from '../src/cache/adapters.js';
import { computeRoi } from '../src/cache/roi.js';
import { resolveConfig } from '../src/config.js';
import type { CacheBlock } from '../src/harness/types.js';

const S: CacheBlock[] = [{ text: 'x'.repeat(8000) }]; // ~2000 tokens > floor
const D: CacheBlock[] = [{ text: 'question?' }];

describe('C2 assemble', () => {
  it('disabled helper = plain concat, no markers (byte-identical)', () => {
    const { helper } = createCacheHelper(null);
    const { payload, meta } = helper.assemble(S, D);
    expect(payload).toEqual([...S, ...D]);
    expect(meta.markersApplied).toBe(false);
  });

  it('orders static-first/dynamic-last and applies explicit markers above the floor', () => {
    const cfg = resolveConfig({ cache: { provider: 'anthropic', strategy: 'explicit' } }).cache;
    const { helper } = createCacheHelper(cfg);
    const { payload, meta } = helper.assemble(S, D);
    expect(payload[payload.length - 1]).toEqual(D[0]); // dynamic last
    expect(meta.markersApplied).toBe(true);
    expect((payload[0] as Record<string, unknown>).cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  it('skips markers below the min-token floor', () => {
    const cfg = resolveConfig({ cache: { provider: 'anthropic', strategy: 'explicit', minTokens: 100000 } }).cache;
    const { helper } = createCacheHelper(cfg);
    const { meta } = helper.assemble(S, D);
    expect(meta.belowMinTokens).toBe(true);
    expect(meta.markersApplied).toBe(false);
  });

  it('prefix strategy never applies inline markers', () => {
    const cfg = resolveConfig({ cache: { provider: 'anthropic', strategy: 'prefix' } }).cache;
    const { meta } = createCacheHelper(cfg).helper.assemble(S, D);
    expect(meta.markersApplied).toBe(false);
  });
});

describe('C3 adapters', () => {
  it('parses Anthropic-shape usage', () => {
    const u = parseUsage({ cache_read_input_tokens: 900, cache_creation_input_tokens: 100 });
    expect(u).toMatchObject({ readTokens: 900, writeTokens: 100, known: true });
  });

  it('parses OpenAI-shape cached_tokens (implicit)', () => {
    expect(parseUsage({ prompt_tokens_details: { cached_tokens: 512 } }).readTokens).toBe(512);
  });

  it('parses Gemini cachedContentTokenCount', () => {
    expect(parseUsage({ usageMetadata: { cachedContentTokenCount: 300 } }).readTokens).toBe(300);
  });

  it('degrades safely on an unknown shape (0-saved, known:false)', () => {
    expect(parseUsage({ some_new_field: 5 })).toEqual({ cachedTokens: 0, readTokens: 0, writeTokens: 0, known: false });
  });

  it('auto-detects provider from base-url', () => {
    expect(pickAdapter('auto', { baseUrl: 'https://api.anthropic.com' }).id).toBe('anthropic');
    expect(pickAdapter('auto', { baseUrl: 'https://dashscope.aliyuncs.com' }).id).toBe('qwen');
    expect(pickAdapter('auto', { baseUrl: 'https://generativelanguage.googleapis.com' }).id).toBe('gemini');
    expect(pickAdapter('auto', { baseUrl: 'https://unknown.example' }).id).toBe('implicit');
    expect(pickAdapter('minimax').id).toBe('anthropic'); // MiniMax reuses Anthropic
  });
});

describe('C4 cache-ROI', () => {
  const opts = { provider: 'anthropic' as const, strategy: 'explicit' as const, breakEvenReads: 2, prices: {} };

  it('computes tokens/dollars saved + hit-rate for a high-hit run', () => {
    const roi = computeRoi({ cachedTokens: 9000, readTokens: 9000, writeTokens: 1000, known: true }, opts);
    expect(roi.tokensSaved).toBe(9000);
    expect(roi.hitRate).toBeCloseTo(0.9, 2);
    expect(roi.breakEvenOk).toBe(true);
    expect(roi.dollarsSaved).toBeGreaterThan(0);
  });

  it('flags break-even failure on a low-reuse run (1 read / 1 write)', () => {
    const roi = computeRoi({ cachedTokens: 100, readTokens: 100, writeTokens: 100, known: true }, opts);
    expect(roi.breakEvenOk).toBe(false);
  });
});
