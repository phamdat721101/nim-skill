import { describe, it, expect } from 'vitest';
import { evaluateToolCall, toClaudeCodeThrottleDecision, toKiroCliThrottleDecision } from '../src/hooks/pre-tool.js';
import { createTrajectoryGate } from '../src/throttle/trajectory.js';
import { checkReadSlice } from '../src/throttle/read-slicer.js';
import { resolveThrottleConfig } from '../src/throttle/schema.js';

describe('hooks/pre-tool.ts (Task 7) — sibling decision functions', () => {
  const config = resolveThrottleConfig({});

  it('trajectory ceiling block -> Claude Code deny (strict mode)', () => {
    const gate = createTrajectoryGate(config);
    let result;
    for (let i = 0; i < 20; i++) result = gate.recordStep('write');
    const outcome = evaluateToolCall({ trajectoryResult: result! });
    const decision = toClaudeCodeThrottleDecision(outcome, 'strict');
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput.permissionDecisionReason).toMatch(/TRAJECTORY_CEILING_REACHED/);
  });

  it('trajectory ceiling block -> Claude Code ask (warn mode)', () => {
    const gate = createTrajectoryGate(config);
    let result;
    for (let i = 0; i < 20; i++) result = gate.recordStep('write');
    const outcome = evaluateToolCall({ trajectoryResult: result! });
    const decision = toClaudeCodeThrottleDecision(outcome, 'warn');
    expect(decision.hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('trajectory warning (not yet ceiling) -> Claude Code ask + additionalContext', () => {
    const gate = createTrajectoryGate(config);
    let result;
    for (let i = 0; i < 18; i++) result = gate.recordStep('edit');
    const outcome = evaluateToolCall({ trajectoryResult: result! });
    const decision = toClaudeCodeThrottleDecision(outcome, 'strict');
    expect(decision.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(decision.hookSpecificOutput.additionalContext).toMatch(/TRAJECTORY_WARNING/);
  });

  it('trajectory ceiling block -> Kiro CLI exit 1 + stderr (strict mode)', () => {
    const gate = createTrajectoryGate(config);
    let result;
    for (let i = 0; i < 20; i++) result = gate.recordStep('write');
    const outcome = evaluateToolCall({ trajectoryResult: result! });
    const decision = toKiroCliThrottleDecision(outcome, 'strict');
    expect(decision.exitCode).toBe(1);
    expect(decision.stderr).toMatch(/BLOCK/);
  });

  it('read-slice block (unsliced large read) -> Claude Code deny with a concrete reason', () => {
    const gate = createTrajectoryGate(config);
    const stepResult = gate.recordStep('read'); // step 1, allowed
    const sliceDecision = checkReadSlice({ totalLines: 700 }, config);
    const outcome = evaluateToolCall({ trajectoryResult: stepResult, readSliceDecision: sliceDecision });
    expect(outcome.kind).toBe('read-slice');
    const decision = toClaudeCodeThrottleDecision(outcome, 'strict');
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput.permissionDecisionReason).toMatch(/200-line clamp/);
  });

  it('read-slice block -> Kiro CLI exit 1 + stderr', () => {
    const gate = createTrajectoryGate(config);
    const stepResult = gate.recordStep('read');
    const sliceDecision = checkReadSlice({ totalLines: 700 }, config);
    const outcome = evaluateToolCall({ trajectoryResult: stepResult, readSliceDecision: sliceDecision });
    const decision = toKiroCliThrottleDecision(outcome, 'strict');
    expect(decision.exitCode).toBe(1);
    expect(decision.stderr).toMatch(/200-line clamp/);
  });

  it('a within-bounds read + within-budget step -> allow on both hosts', () => {
    const gate = createTrajectoryGate(config);
    const stepResult = gate.recordStep('read');
    const sliceDecision = checkReadSlice({ totalLines: 100 }, config);
    const outcome = evaluateToolCall({ trajectoryResult: stepResult, readSliceDecision: sliceDecision });
    expect(toClaudeCodeThrottleDecision(outcome).hookSpecificOutput.permissionDecision).toBe('allow');
    expect(toKiroCliThrottleDecision(outcome)).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('a read-slice block takes precedence over an in-budget trajectory step (block always wins)', () => {
    const gate = createTrajectoryGate(config);
    const stepResult = gate.recordStep('read'); // well within budget
    const sliceDecision = checkReadSlice({ totalLines: 900, range: { startLine: 1, endLine: 500 } }, config);
    const outcome = evaluateToolCall({ trajectoryResult: stepResult, readSliceDecision: sliceDecision });
    expect(outcome.kind).toBe('read-slice');
    expect(toClaudeCodeThrottleDecision(outcome).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
