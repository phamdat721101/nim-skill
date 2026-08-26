import { describe, it, expect } from 'vitest';
import { TrajectoryGate, createTrajectoryGate } from '../src/throttle/trajectory.js';
import { resolveThrottleConfig } from '../src/throttle/schema.js';

describe('TrajectoryGate (Task 2) — 4-state matrix (PRD 26 §6)', () => {
  const config = resolveThrottleConfig({}); // maxStepsPerTurn=20, warningStepThreshold=18

  it('Happy — 8 tool calls on a focused feature: all allowed, no warning', () => {
    const gate = createTrajectoryGate(config);
    let lastResult;
    for (let i = 0; i < 8; i++) lastResult = gate.recordStep('read');
    expect(lastResult).toEqual({ allowed: true });
    expect(gate.snapshot().currentStep).toBe(8);
  });

  it('Empty — zero-tool command run: 0 steps counted, zero trajectory overhead', () => {
    const gate = createTrajectoryGate(config);
    expect(gate.snapshot()).toEqual({ currentStep: 0, maxSteps: 20 });
  });

  it('Boundary — step 18 warning threshold: emits warning, does not block', () => {
    const gate = createTrajectoryGate(config);
    let result;
    for (let i = 0; i < 18; i++) result = gate.recordStep('edit');
    expect(result?.allowed).toBe(true);
    expect(result?.warning).toMatch(/TRAJECTORY_WARNING/);
    expect(result?.warning).toContain('18/20');
  });

  it('Error/Breach — step 20 ceiling exceeded: intercepts with TRAJECTORY_CEILING_REACHED', () => {
    const gate = createTrajectoryGate(config);
    let result;
    for (let i = 0; i < 20; i++) result = gate.recordStep('write');
    expect(result?.allowed).toBe(false);
    expect(result?.reason).toMatch(/TRAJECTORY_CEILING_REACHED/);
  });

  it('reset() returns the gate to step 0 for a new turn', () => {
    const gate = new TrajectoryGate(config);
    for (let i = 0; i < 20; i++) gate.recordStep('write');
    expect(gate.snapshot().currentStep).toBe(20);
    gate.reset();
    expect(gate.snapshot().currentStep).toBe(0);
    expect(gate.recordStep('read')).toEqual({ allowed: true });
  });

  it('respects a custom maxStepsPerTurn/warningStepThreshold configuration', () => {
    const custom = resolveThrottleConfig({ maxStepsPerTurn: 5, warningStepThreshold: 3 });
    const gate = createTrajectoryGate(custom);
    expect(gate.recordStep('a')).toEqual({ allowed: true });
    expect(gate.recordStep('b')).toEqual({ allowed: true });
    expect(gate.recordStep('c').warning).toMatch(/3\/5/);
    expect(gate.recordStep('d').warning).toMatch(/4\/5/);
    expect(gate.recordStep('e').allowed).toBe(false);
  });
});
