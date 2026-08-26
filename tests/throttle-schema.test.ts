import { describe, it, expect } from 'vitest';
import { resolveThrottleConfig, throttleSchema } from '../src/throttle/schema.js';
import { resolveConfig } from '../src/config.js';

describe('nim-throttle schema (Task 1)', () => {
  it('fills every default per PRD 26 §4.1, with warningStepThreshold resolved to 18', () => {
    const resolved = resolveThrottleConfig({});
    expect(resolved.maxStepsPerTurn).toBe(20);
    expect(resolved.warningStepThreshold).toBe(18);
    expect(resolved.maxFileLineRead).toBe(200);
    expect(resolved.turnCostBudgetUsd).toBe(2.5);
    expect(resolved.subprocessCompaction.enabled).toBe(true);
    expect(resolved.subprocessCompaction.maxOutputLines).toBe(40);
    expect(resolved.subprocessCompaction.noisyPatterns).toEqual(
      expect.arrayContaining(['gradlew', 'mvn', 'npm test', 'vitest', 'pytest', 'cargo test']),
    );
  });

  it('honors explicit overrides', () => {
    const resolved = resolveThrottleConfig({ maxStepsPerTurn: 30, warningStepThreshold: 25, maxFileLineRead: 500, turnCostBudgetUsd: 5 });
    expect(resolved).toMatchObject({ maxStepsPerTurn: 30, warningStepThreshold: 25, maxFileLineRead: 500, turnCostBudgetUsd: 5 });
  });

  it('rejects warningStepThreshold >= maxStepsPerTurn', () => {
    expect(() => throttleSchema.parse({ maxStepsPerTurn: 10, warningStepThreshold: 10 })).toThrow();
    expect(() => throttleSchema.parse({ maxStepsPerTurn: 10, warningStepThreshold: 11 })).toThrow();
  });

  it('rejects out-of-range values', () => {
    expect(() => throttleSchema.parse({ maxStepsPerTurn: 0 })).toThrow();
    expect(() => throttleSchema.parse({ maxStepsPerTurn: 51 })).toThrow();
    expect(() => throttleSchema.parse({ maxFileLineRead: 10 })).toThrow();
    expect(() => throttleSchema.parse({ turnCostBudgetUsd: -1 })).toThrow();
  });

  it('resolveConfig() leaves throttle null when the block is absent (rollback contract)', () => {
    const resolved = resolveConfig({});
    expect(resolved.throttle).toBeNull();
  });

  it('resolveConfig() leaves throttle null when the block is explicitly false', () => {
    const resolved = resolveConfig({ throttle: false });
    expect(resolved.throttle).toBeNull();
  });

  it('resolveConfig() resolves throttle with defaults when the block is present but empty', () => {
    const resolved = resolveConfig({ throttle: {} });
    expect(resolved.throttle).not.toBeNull();
    expect(resolved.throttle?.maxStepsPerTurn).toBe(20);
  });
});
