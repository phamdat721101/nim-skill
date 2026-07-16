import { describe, it, expect } from 'vitest';
import { tightenFor } from '../src/profile/tiers.js';
import { FRONTIER_PATTERNS, VERIFIED_SEED_PATTERNS } from '../src/profile/patterns.js';
import { detectTier, applyProfile } from '../src/profile/index.js';
import { readFileSync } from 'node:fs';
import type { HarnessConfig } from '../src/harness/types.js';

const input: HarnessConfig = {
  enforcer: { mode: 'warn', maxHeals: 2 },
  errorHandler: { circuitBreaker: { failN: 5 } },
  guard: { injection: 'off' },
};

describe('tightenFor — the exact §9 worked example', () => {
  it('frontier tier is a byte-identical no-op passthrough', () => {
    expect(tightenFor('frontier', input)).toEqual(input);
  });

  it('open-weight-verified raises maxHeals by 1, changes nothing else', () => {
    const out = tightenFor('open-weight-verified', input);
    expect(out.enforcer).toMatchObject({ mode: 'warn', maxHeals: 3 });
    expect(out.guard).toEqual({ injection: 'off' });
    expect(out.errorHandler).toEqual({ circuitBreaker: { failN: 5 } });
  });

  it('open-weight-untested tightens mode, injection, and failN; maxHeals untouched', () => {
    const out = tightenFor('open-weight-untested', input);
    expect(out.enforcer).toMatchObject({ mode: 'strict', maxHeals: 2 });
    expect(out.guard).toEqual({ injection: 'strict' });
    expect(out.errorHandler).toEqual({ circuitBreaker: { failN: 4 } });
  });

  it('never-loosen invariant: an already-strict config stays strict under untested tier', () => {
    const strict: HarnessConfig = { enforcer: { mode: 'strict' } };
    const out = tightenFor('open-weight-untested', strict);
    expect(out.enforcer).toEqual({ mode: 'strict' });
  });

  it('never-loosen invariant: already-strict guard.injection stays strict', () => {
    const strict: HarnessConfig = { guard: { injection: 'strict' } };
    const out = tightenFor('open-weight-untested', strict);
    expect(out.guard).toEqual({ injection: 'strict' });
  });
});

describe('patterns', () => {
  it('FRONTIER_PATTERNS matches known frontier names, not unrelated strings', () => {
    expect(FRONTIER_PATTERNS.some((re) => re.test('claude-opus-4.8'))).toBe(true);
    expect(FRONTIER_PATTERNS.some((re) => re.test('claude-sonnet-4.6'))).toBe(true);
    expect(FRONTIER_PATTERNS.some((re) => re.test('gpt-5.4'))).toBe(true);
    expect(FRONTIER_PATTERNS.some((re) => re.test('random-model-x'))).toBe(false);
  });

  it('VERIFIED_SEED_PATTERNS matches the illustrative glm/minimax examples', () => {
    expect(VERIFIED_SEED_PATTERNS.some((re) => re.test('glm-5.2'))).toBe(true);
    expect(VERIFIED_SEED_PATTERNS.some((re) => re.test('minimax-m3'))).toBe(true);
    expect(VERIFIED_SEED_PATTERNS.some((re) => re.test('random-model-x'))).toBe(false);
  });
});

describe('detectTier — resolution order', () => {
  it('explicit tier always wins even with a conflicting hint', () => {
    expect(detectTier({ tier: 'open-weight-verified', modelHint: 'claude-opus-4.8' })).toBe('open-weight-verified');
  });

  it('hint matches a frontier pattern', () => {
    expect(detectTier({ modelHint: 'claude-opus-4.8' })).toBe('frontier');
  });

  it('hint matches a verified pattern', () => {
    expect(detectTier({ modelHint: 'glm-5.2' })).toBe('open-weight-verified');
  });

  it('no hint at all defaults to the strictest tier, not the loosest', () => {
    expect(detectTier({})).toBe('open-weight-untested');
  });

  it('unrecognized hint also defaults to open-weight-untested (safe degrade)', () => {
    expect(detectTier({ modelHint: 'some-unknown-model-v9' })).toBe('open-weight-untested');
  });

  it('user-extended verifiedModelPatterns is honored', () => {
    expect(detectTier({ modelHint: 'my-org-model-x', verifiedModelPatterns: ['^my-org-'] })).toBe('open-weight-verified');
  });
});

describe('applyProfile — composition wrapper', () => {
  it('returns the resolved tier alongside the tightened harness config', () => {
    const { harness, tier } = applyProfile(input, { modelHint: 'glm-5.2' });
    expect(tier).toBe('open-weight-verified');
    expect(harness.enforcer).toMatchObject({ maxHeals: 3 });
  });

  it('frontier profile leaves the harness config byte-identical', () => {
    const { harness, tier } = applyProfile(input, { modelHint: 'claude-opus-4.8' });
    expect(tier).toBe('frontier');
    expect(harness).toEqual(input);
  });

  it('does not add a 6th step to runHarnessed\'s pipeline (byte-unchanged runtime.ts)', () => {
    const src = readFileSync('src/harness/runtime.ts', 'utf8');
    const stepMarkers = src.match(/①|②|③|④|⑤/g) ?? [];
    const uniqueMarkers = new Set(stepMarkers);
    expect(uniqueMarkers.size).toBeLessThanOrEqual(5);
    expect(uniqueMarkers.has('⑥' as never)).toBe(false);
  });
});
