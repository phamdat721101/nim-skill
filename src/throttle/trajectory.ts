/**
 * src/throttle/trajectory.ts
 * ----------------------------
 * v0.16 `nim-throttle` Pillar 1 — Micro-Turn Trajectory Budget (PRD 26 §4.2 /
 * PRD 27 Task 1.2). Pure, in-memory step counter with zero I/O — the CLI/hook
 * layer (`src/hooks/pre-tool.ts`, Task 7) owns calling `recordStep()` once per
 * tool invocation and `reset()` at the start of a new turn; this class does
 * not know about turns, hosts, or tools, only step counts.
 */

import type { ResolvedThrottleConfig } from './types.js';
import type { TrajectoryState, TrajectoryStepResult } from './types.js';

export class TrajectoryGate {
  private stepCount = 0;

  constructor(private readonly config: ResolvedThrottleConfig) {}

  /**
   * Record one tool-execution step. Returns `allowed: false` once the turn
   * has reached `maxStepsPerTurn` (the caller must force a checkpoint write
   * and end the turn); returns `allowed: true` with a `warning` once the
   * turn has reached `warningStepThreshold` but not yet the ceiling.
   */
  public recordStep(_toolName: string): TrajectoryStepResult {
    this.stepCount++;

    if (this.stepCount >= this.config.maxStepsPerTurn) {
      return {
        allowed: false,
        reason: `TRAJECTORY_CEILING_REACHED: Reached turn limit of ${this.config.maxStepsPerTurn} steps. Emit session checkpoint and end turn.`,
      };
    }

    if (this.stepCount >= this.config.warningStepThreshold) {
      return {
        allowed: true,
        warning: `TRAJECTORY_WARNING: Step ${this.stepCount}/${this.config.maxStepsPerTurn}. Conclude current sub-task and prepare checkpoint.`,
      };
    }

    return { allowed: true };
  }

  /** Start a fresh turn — resets the step counter to 0. */
  public reset(): void {
    this.stepCount = 0;
  }

  /** Read-only snapshot of the gate's current state, for checkpoint/telemetry consumers. */
  public snapshot(): Pick<TrajectoryState, 'currentStep' | 'maxSteps'> {
    return { currentStep: this.stepCount, maxSteps: this.config.maxStepsPerTurn };
  }
}

/** Convenience factory — mirrors every other primitive's `create*()` naming (createGuard, createWorkruleHelper, ...). */
export function createTrajectoryGate(config: ResolvedThrottleConfig): TrajectoryGate {
  return new TrajectoryGate(config);
}
