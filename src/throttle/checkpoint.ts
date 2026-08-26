/**
 * src/throttle/checkpoint.ts
 * ----------------------------
 * v0.16 `nim-throttle` Pillar 1 — the forced 3-line checkpoint snapshot PRD
 * 26 requires once `TrajectoryGate` hits the step ceiling (PRD 27 Task 1.3 /
 * "Checkpoint Handoff"). Deliberately reuses `nim-workspace`'s existing
 * liveness file (`docs/state/active_session.md`, same path convention as
 * `ResolvedWorkspaceConfig.livenessFile`'s default) rather than inventing a
 * second state file — this is a compact SIBLING entry to the full
 * multi-section `appendHandoff()` in `workspace/bootstrap.ts`, not a
 * replacement for it: a trajectory checkpoint is a mid-turn "pause and
 * resume" note (3 lines: progress / next / steps-used), while a workspace
 * handoff is the richer end-of-session record with goal/blocker/attempted.
 * Same append-only discipline (never truncates, never rewrites prior
 * entries) as every other `.nim/`/`docs/state/` writer in this codebase.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CheckpointSnapshot } from './types.js';

/** Default liveness-file path — identical string to `ResolvedWorkspaceConfig`'s own default (config.ts). */
export const DEFAULT_CHECKPOINT_PATH = 'docs/state/active_session.md';

function renderCheckpoint(snapshot: CheckpointSnapshot): string {
  return `\n## Throttle checkpoint ${snapshot.at}\n\n- Progress: ${snapshot.progress}\n- Next: ${snapshot.next}\n- Steps used: ${snapshot.stepsUsed}\n`;
}

/**
 * Build a snapshot from live inputs (no `at` timestamp required — this
 * function stamps it), matching `TrajectoryGate.snapshot()`'s step count.
 */
export function buildCheckpointSnapshot(input: { progress: string; next: string; stepsUsed: number }): CheckpointSnapshot {
  return {
    at: new Date().toISOString(),
    progress: input.progress,
    next: input.next,
    stepsUsed: input.stepsUsed,
  };
}

/** Append-only write of a checkpoint snapshot to `path` (default: the shared liveness file). Creates the file with a minimal header if it does not yet exist. */
export function writeCheckpoint(snapshot: CheckpointSnapshot, path: string = DEFAULT_CHECKPOINT_PATH): { path: string; appended: true } {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  if (!existsSync(resolved)) {
    writeFileSync(resolved, '# Active session\n\nRead the final `## Session`/`## Throttle checkpoint` entry as the current handoff state. This file is append-only.\n');
  }
  appendFileSync(resolved, renderCheckpoint(snapshot));
  return { path, appended: true };
}
