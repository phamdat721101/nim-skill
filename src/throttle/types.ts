/**
 * src/throttle/types.ts
 * ----------------------
 * v0.16 `nim-throttle` — Token-Thrift & Trajectory-Budget Protocol (PRD 26/27).
 * Pure type definitions, zero I/O, mirrors the sibling-config-block pattern
 * every other harness layer follows (`GuardConfig`, `LogCompactConfig`, etc.
 * in `harness/types.ts`) — kept in this module's own `types.ts` rather than
 * folded into `harness/types.ts` because PRD 27 specifies `src/throttle/`
 * as a standalone module, not a nested harness layer file.
 */

/** Declarative `nim.json` input shape — every field optional, Zod fills defaults in `schema.ts`. */
export interface SubprocessCompactionConfig {
  enabled?: boolean;
  maxOutputLines?: number;
  noisyPatterns?: string[];
}

export interface ThrottleConfig {
  /** Hard ceiling of tool-execution steps allowed in one turn. Default: 20 (PRD 26 §4.1). */
  maxStepsPerTurn?: number;
  /**
   * Step count at which a wind-down warning is issued.
   * Resolved default: 18 — see `schema.ts`'s `DEFAULT_WARNING_STEP_THRESHOLD`
   * for why 18 (not the Zod-comment's literal 17) was chosen as the shipped
   * default; this JSDoc intentionally does not restate a specific number so
   * the two files cannot drift out of sync again.
   */
  warningStepThreshold?: number;
  /** Maximum allowed un-sliced file read line count. Default: 200 (PRD 26 §4.1). */
  maxFileLineRead?: number;
  /** Subprocess output compaction routing for noisy build/test commands (Pillar 2). */
  subprocessCompaction?: SubprocessCompactionConfig;
  /** USD cost budget per turn. Default: 2.50 (PRD 26 §4.1). */
  turnCostBudgetUsd?: number;
}

export interface ResolvedSubprocessCompaction {
  enabled: boolean;
  maxOutputLines: number;
  noisyPatterns: string[];
}

export interface ResolvedThrottleConfig {
  maxStepsPerTurn: number;
  warningStepThreshold: number;
  maxFileLineRead: number;
  subprocessCompaction: ResolvedSubprocessCompaction;
  turnCostBudgetUsd: number;
}

/** Live, in-memory per-turn counters (PRD 26 §4.2). Never persisted directly — `checkpoint.ts` snapshots it. */
export interface TrajectoryState {
  currentStep: number;
  maxSteps: number;
  turnTokensIn: number;
  turnTokensOut: number;
  turnCostUsd: number;
  checkpointRequired: boolean;
}

/** Result of `TrajectoryGate.recordStep()` — `allowed: false` means the ceiling was hit; a `warning` may still accompany `allowed: true`. */
export interface TrajectoryStepResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
}

/** The 3-line handoff PRD 26 Pillar 1 requires when the ceiling is hit (`checkpoint.ts`). */
export interface CheckpointSnapshot {
  /** ISO timestamp of the checkpoint write. */
  at: string;
  /** One-line summary of what the turn accomplished so far. */
  progress: string;
  /** One-line summary of what remains. */
  next: string;
  /** Steps consumed when the checkpoint was forced. */
  stepsUsed: number;
}
