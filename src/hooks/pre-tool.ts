/**
 * src/hooks/pre-tool.ts
 * -----------------------
 * v0.16 `nim-throttle` Pillar 1 + Pillar 3 — PreToolUse hook composition
 * (PRD 27 Task 3.2). Composes `TrajectoryGate.recordStep()` and
 * `read-slicer`'s `checkReadSlice()` decisions into per-host translation
 * functions with the SAME shapes as the existing `ClaudeCodeDecision`/
 * `KiroCliDecision` types in `src/hook-adapters/{claude-code,kiro-cli}.ts`.
 *
 * Per the confirmed implementation-plan review fix: this module does NOT
 * modify those two files' existing exported functions or signatures
 * (`toClaudeCodeDecision`, `toKiroCliDecision`) — it defines its own
 * sibling `toClaudeCodeThrottleDecision`/`toKiroCliThrottleDecision`
 * functions here, so nim-throttle's gating never couples to nim-workspace's
 * hook logic or its existing test suite (`tests/hook-adapters.test.ts`
 * stays untouched and unaffected).
 */

import type { TrajectoryStepResult } from '../throttle/types.js';
import type { ReadSliceDecision } from '../throttle/read-slicer.js';
import type { ClaudeCodeDecision, ClaudeCodePermissionDecision } from '../hook-adapters/claude-code.js';
import type { KiroCliDecision } from '../hook-adapters/kiro-cli.js';

/** A trajectory-ceiling block, a read-slice block, or a pass-through — this is the input this module's translators consume. */
export type ThrottleHookOutcome =
  | { kind: 'trajectory'; result: TrajectoryStepResult }
  | { kind: 'read-slice'; decision: ReadSliceDecision };

function isBlocked(outcome: ThrottleHookOutcome): boolean {
  return outcome.kind === 'trajectory' ? !outcome.result.allowed : !outcome.decision.allowed;
}

function reasonFor(outcome: ThrottleHookOutcome): string {
  if (outcome.kind === 'trajectory') return outcome.result.reason ?? outcome.result.warning ?? 'nim-throttle: trajectory gate';
  return outcome.decision.reason;
}

function warningFor(outcome: ThrottleHookOutcome): string | undefined {
  return outcome.kind === 'trajectory' ? outcome.result.warning : undefined;
}

/**
 * Evaluate a single tool call against BOTH the trajectory gate and the read
 * slicer (when a read request is present) and return the more severe of
 * the two `ThrottleHookOutcome`s (a block always wins over a mere warning).
 * A caller with no read request simply omits `readRequest`.
 */
export function evaluateToolCall(input: {
  trajectoryResult: TrajectoryStepResult;
  readSliceDecision?: ReadSliceDecision;
}): ThrottleHookOutcome {
  if (input.readSliceDecision && !input.readSliceDecision.allowed) {
    return { kind: 'read-slice', decision: input.readSliceDecision };
  }
  return { kind: 'trajectory', result: input.trajectoryResult };
}

/**
 * Claude Code PreToolUse translation — same `hookSpecificOutput` shape as
 * `toClaudeCodeDecision`, sibling function, own name.
 * `mode === 'strict'` -> deny; anything else -> ask (mirrors the existing
 * workspace adapter's mode semantics for consistency, applied to throttle's
 * own block cases only).
 */
export function toClaudeCodeThrottleDecision(outcome: ThrottleHookOutcome, mode: 'warn' | 'strict' | 'off' = 'strict'): ClaudeCodeDecision {
  const blocked = isBlocked(outcome);
  const warning = warningFor(outcome);
  let permissionDecision: ClaudeCodePermissionDecision = 'allow';
  if (blocked) permissionDecision = mode === 'strict' ? 'deny' : 'ask';
  else if (warning) permissionDecision = 'ask';

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: blocked ? reasonFor(outcome) : warning ?? 'nim-throttle: within trajectory budget',
      ...(warning && !blocked ? { additionalContext: warning } : {}),
    },
  };
}

/**
 * Kiro CLI PreToolUse translation — same exit-code/stdout/stderr shape as
 * `toKiroCliDecision`, sibling function, own name.
 */
export function toKiroCliThrottleDecision(outcome: ThrottleHookOutcome, mode: 'warn' | 'strict' | 'off' = 'strict'): KiroCliDecision {
  const blocked = isBlocked(outcome);
  const warning = warningFor(outcome);

  if (blocked) {
    if (mode === 'strict') {
      return { exitCode: 1, stdout: '', stderr: `nim-throttle: BLOCK — ${reasonFor(outcome)}\n` };
    }
    return { exitCode: 0, stdout: `nim-throttle: BLOCK (warn) — ${reasonFor(outcome)}\n`, stderr: '' };
  }

  if (warning) {
    return { exitCode: 0, stdout: `nim-throttle: ${warning}\n`, stderr: '' };
  }

  return { exitCode: 0, stdout: '', stderr: '' };
}
