import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { createTrajectoryGate } from '../src/throttle/trajectory.js';
import { resolveThrottleConfig } from '../src/throttle/schema.js';

describe('nim-throttle end-to-end delivery verification (Task 10)', () => {
  it('rollback contract — an absent throttle block resolves to null exactly like every other harness layer', () => {
    const resolved = resolveConfig({
      guard: { taskBudgetUsd: 5 },
      enforcer: { strategies: ['nonempty'], mode: 'strict' },
    });
    expect(resolved.throttle).toBeNull();
    // sibling layers unaffected — throttle wiring is additive-only
    expect(resolved.guard).not.toBeNull();
    expect(resolved.enforcer).not.toBeNull();
  });

  it('rollback contract — resolveConfig({}) with throttle omitted is byte-identical to a config with throttle:false', () => {
    const withoutBlock = resolveConfig({});
    const withFalse = resolveConfig({ throttle: false });
    expect(withoutBlock.throttle).toBe(withFalse.throttle); // both null
    expect(withoutBlock).toEqual(withFalse);
  });

  /**
   * PRD 26 §1's cost model: an unbroken trajectory of N steps accumulates
   * cache-read volume V_cache = N*C0 + Δc*N(N+1)/2 ≈ O(N²), because every
   * step re-reads the ENTIRE accumulated context (base + all prior steps'
   * output). Splitting into micro-turns of size `maxStepsPerTurn`, each
   * turn's accumulated context resets at the checkpoint boundary, so total
   * cache-read volume across the same N steps becomes the SUM of each
   * bounded micro-turn's own (much smaller) quadratic term — asymptotically
   * O(N) in the number of turns for a fixed per-turn ceiling, not O(N²)
   * over the whole trajectory.
   *
   * This test does not call a real LLM; it simulates the exact
   * accumulation formula PRD 26 §1 states, gated by whether
   * TrajectoryGate.recordStep() would have forced a checkpoint (reset) at
   * each step — i.e. it measures the STRUCTURAL effect of the trajectory
   * gate on the cost model's own terms, not a live token count.
   */
  function simulateCacheReadVolume(totalSteps: number, baseContextTokens: number, deltaPerStep: number, resetEveryNSteps: number | null): number {
    let volume = 0;
    let contextSoFar = baseContextTokens;
    let stepsSinceReset = 0;
    for (let i = 1; i <= totalSteps; i++) {
      volume += contextSoFar;
      contextSoFar += deltaPerStep;
      stepsSinceReset += 1;
      if (resetEveryNSteps !== null && stepsSinceReset >= resetEveryNSteps) {
        contextSoFar = baseContextTokens; // checkpoint: context resets, next turn starts fresh
        stepsSinceReset = 0;
      }
    }
    return volume;
  }

  it('unbroken trajectory (no checkpoint) grows cache-read volume quadratically with step count', () => {
    const v50 = simulateCacheReadVolume(50, 15_000, 1_500, null);
    const v100 = simulateCacheReadVolume(100, 15_000, 1_500, null);
    const v200 = simulateCacheReadVolume(200, 15_000, 1_500, null);
    // Quadratic growth: doubling N should more than TRIPLE the volume (true
    // asymptotic limit is 4x; a non-negligible base-context term pulls the
    // observed ratio below 4x at these finite sizes, but it stays well
    // above the ~2x a linear relationship would produce).
    const ratio100to50 = v100 / v50;
    const ratio200to100 = v200 / v100;
    expect(ratio100to50).toBeGreaterThan(3.0);
    expect(ratio200to100).toBeGreaterThan(3.0);
  });

  it('a forced checkpoint every maxStepsPerTurn steps bounds total cache-read volume to linear growth in step count', () => {
    const config = resolveThrottleConfig({}); // maxStepsPerTurn = 20
    const v50 = simulateCacheReadVolume(50, 15_000, 1_500, config.maxStepsPerTurn);
    const v100 = simulateCacheReadVolume(100, 15_000, 1_500, config.maxStepsPerTurn);
    const v200 = simulateCacheReadVolume(200, 15_000, 1_500, config.maxStepsPerTurn);
    // Linear growth: doubling N should roughly DOUBLE the volume (bounded
    // per-turn quadratic term is now a constant, repeated N/maxSteps times).
    const ratio100to50 = v100 / v50;
    const ratio200to100 = v200 / v100;
    expect(ratio100to50).toBeLessThan(2.5);
    expect(ratio200to100).toBeLessThan(2.5);
  });

  it('at N=214 (the real PRD 26 incident size), checkpointing every 20 steps reduces total cache-read volume by a large, measurable margin', () => {
    const config = resolveThrottleConfig({});
    const unbroken = simulateCacheReadVolume(214, 15_000, 1_500, null);
    const checkpointed = simulateCacheReadVolume(214, 15_000, 1_500, config.maxStepsPerTurn);
    const reductionPct = ((unbroken - checkpointed) / unbroken) * 100;
    // PRD 26 §1 claims "up to 78%" reduction splitting 200 steps into 20-step
    // micro-turns — assert a large reduction in the same direction/order of
    // magnitude, not the exact 78% (this simulation's constants are
    // illustrative, not the real measured incident's exact per-step deltas).
    expect(reductionPct).toBeGreaterThan(70);
  });

  it('TrajectoryGate genuinely forces a block at exactly the configured ceiling, which is the real mechanism the simulation above assumes', () => {
    const config = resolveThrottleConfig({});
    const gate = createTrajectoryGate(config);
    const results = [];
    for (let i = 0; i < 25; i++) results.push(gate.recordStep('tool'));
    const blockedAt = results.findIndex((r) => !r.allowed) + 1; // 1-indexed step number
    expect(blockedAt).toBe(config.maxStepsPerTurn);
  });
});
