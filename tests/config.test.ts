import { describe, it, expect } from 'vitest';
import { resolveConfig, mergeHarness, loadNimJson } from '../src/config.js';

describe('resolveConfig', () => {
  it('disables every layer when config is empty (no-op passthrough)', () => {
    const r = resolveConfig({});
    expect(r.guard).toBeNull();
    expect(r.errorHandler).toBeNull();
    expect(r.enforcer).toBeNull();
    expect(r.monitor).toBeNull();
  });

  it('treats an explicit `false` block as disabled', () => {
    const r = resolveConfig({ guard: false, monitor: false });
    expect(r.guard).toBeNull();
    expect(r.monitor).toBeNull();
  });

  it('fills guard defaults for a present block', () => {
    const r = resolveConfig({ guard: { maxCostUsd: 0.5 } });
    expect(r.guard).toEqual({
      maxCostUsd: 0.5,
      ratePerMin: 60,
      allowTools: ['*'],
      injection: 'strict',
    });
  });

  it('resolves the authoritative nim.json example', () => {
    const r = resolveConfig({
      guard: { maxCostUsd: 0.5, ratePerMin: 30, allowTools: ['*'], injection: 'strict' },
      errorHandler: { retries: 3, backoff: 'exp-jitter', circuitBreaker: { failN: 5, cooldownMs: 60000 } },
      enforcer: { strategies: [{ kind: 'schema', required: ['id'] }, { kind: 'nonempty' }], maxHeals: 3, strict: true },
      monitor: { exporters: ['console'] },
    });
    expect(r.guard?.ratePerMin).toBe(30);
    expect(r.errorHandler?.circuitBreaker?.failN).toBe(5);
    expect(r.errorHandler?.circuitBreaker?.windowSize).toBe(20); // default filled
    expect(r.enforcer?.mode).toBe('strict');
    expect(r.enforcer?.strategies).toHaveLength(2);
    expect(r.monitor?.exporters).toEqual(['console']);
  });

  it('derives enforcer mode from the legacy `strict` boolean', () => {
    expect(resolveConfig({ enforcer: { strict: false } }).enforcer?.mode).toBe('warn');
    expect(resolveConfig({ enforcer: { strict: true } }).enforcer?.mode).toBe('strict');
    expect(resolveConfig({ enforcer: {} }).enforcer?.mode).toBe('strict');
  });

  it('disables the enforcer when mode is off', () => {
    expect(resolveConfig({ enforcer: { mode: 'off' } }).enforcer).toBeNull();
  });

  it('clamps maxHeals to 0..5', () => {
    expect(resolveConfig({ enforcer: { maxHeals: 99 } }).enforcer?.maxHeals).toBe(5);
    expect(resolveConfig({ enforcer: { maxHeals: -4 } }).enforcer?.maxHeals).toBe(0);
  });

  it('normalizes bare-string strategy shorthand to objects', () => {
    const r = resolveConfig({ enforcer: { strategies: ['nonempty', 'json'] } });
    expect(r.enforcer?.strategies).toEqual([{ kind: 'nonempty' }, { kind: 'json' }]);
  });

  it('honors circuitBreaker:false', () => {
    expect(resolveConfig({ errorHandler: { circuitBreaker: false } }).errorHandler?.circuitBreaker).toBeNull();
  });

  it('throws on an invalid config (bad injection value)', () => {
    // @ts-expect-error deliberately invalid
    expect(() => resolveConfig({ guard: { injection: 'loose' } })).toThrow();
  });
});

describe('mergeHarness', () => {
  it('lets the override win per-layer', () => {
    const merged = mergeHarness({ guard: { ratePerMin: 10 } }, { guard: { ratePerMin: 99 } });
    expect(resolveConfig(merged).guard?.ratePerMin).toBe(99);
  });
});

describe('loadNimJson', () => {
  it('returns an empty config when nim.json is absent', () => {
    expect(loadNimJson('/nonexistent-dir-xyz')).toEqual({});
  });
});
