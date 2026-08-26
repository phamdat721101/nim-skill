import { describe, it, expect } from 'vitest';
import { checkReadSlice } from '../src/throttle/read-slicer.js';
import { resolveThrottleConfig } from '../src/throttle/schema.js';

describe('read-slicer (Task 6) — 4-state matrix', () => {
  const config = resolveThrottleConfig({}); // maxFileLineRead = 200

  it('small file (<= maxFileLineRead): full read allowed, no range needed', () => {
    const decision = checkReadSlice({ totalLines: 150 }, config);
    expect(decision.allowed).toBe(true);
    expect(decision.suggestedRange).toBeUndefined();
  });

  it('large file, no range: blocked with a concrete suggested range', () => {
    const decision = checkReadSlice({ totalLines: 700 }, config);
    expect(decision.allowed).toBe(false);
    expect(decision.suggestedRange).toEqual({ startLine: 1, endLine: 200 });
  });

  it('large file, explicit in-bounds range within the clamp: allowed', () => {
    const decision = checkReadSlice({ totalLines: 700, range: { startLine: 1, endLine: 150 } }, config);
    expect(decision.allowed).toBe(true);
  });

  it('large file, out-of-bounds range: blocked', () => {
    const decision = checkReadSlice({ totalLines: 700, range: { startLine: 650, endLine: 750 } }, config);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/out of bounds/);
  });

  it('large file, oversized range (exceeds the clamp even if in bounds): blocked with a re-clamped suggestion', () => {
    const decision = checkReadSlice({ totalLines: 700, range: { startLine: 1, endLine: 500 } }, config);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/exceeds the 200-line clamp/);
    expect(decision.suggestedRange).toEqual({ startLine: 1, endLine: 200 });
  });

  it('respects a custom maxFileLineRead', () => {
    const custom = resolveThrottleConfig({ maxFileLineRead: 50 });
    expect(checkReadSlice({ totalLines: 40 }, custom).allowed).toBe(true);
    expect(checkReadSlice({ totalLines: 100 }, custom).allowed).toBe(false);
    expect(checkReadSlice({ totalLines: 100, range: { startLine: 1, endLine: 50 } }, custom).allowed).toBe(true);
  });

  it('a zero-line / empty file is always allowed', () => {
    expect(checkReadSlice({ totalLines: 0 }, config).allowed).toBe(true);
  });
});
