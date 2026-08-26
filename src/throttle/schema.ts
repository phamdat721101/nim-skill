/**
 * src/throttle/schema.ts
 * ------------------------
 * v0.16 `nim-throttle` — Zod validation + default-resolution for the
 * `throttle` nim.json block (PRD 26 §4.1 / PRD 27 Task 1.1). Mirrors
 * `config.ts`'s per-layer schema + `resolve*()` pair exactly (see
 * `guardSchema`/`resolveGuard`) so `throttle` composes into `nim.json` the
 * same way every other harness layer does. Absent block ⇒ `resolveConfig()`
 * never calls `resolveThrottleConfig` ⇒ `null` ⇒ byte-identical no-op
 * (rollback contract, AGENTS.md Principle 4).
 *
 * Resolved-default note (17 vs 18 warning threshold): PRD 26 §4.1's own
 * `ThrottleConfigSchema` code comment says `.default(17)`, but PRD 26 §3's
 * architecture narration ("At Step 18 (Warning Threshold)") and PRD 27 Task
 * 1.3's test description ("Boundary 17/18 steps warning") both describe the
 * warning firing at the 18th step. Shipping `18` as the resolved default —
 * documented here once so this doesn't silently re-drift between the PRD
 * text and the implementation.
 */

import { z } from 'zod';
import type { ThrottleConfig, ResolvedThrottleConfig } from './types.js';

const DEFAULT_MAX_STEPS_PER_TURN = 20;
const DEFAULT_WARNING_STEP_THRESHOLD = 18;
const DEFAULT_MAX_FILE_LINE_READ = 200;
const DEFAULT_MAX_OUTPUT_LINES = 40;
const DEFAULT_TURN_COST_BUDGET_USD = 2.5;
const DEFAULT_NOISY_PATTERNS = ['gradlew', 'mvn', 'npm test', 'vitest', 'pytest', 'cargo test'];

const subprocessCompactionSchema = z.object({
  enabled: z.boolean().optional(),
  maxOutputLines: z.number().int().positive().optional(),
  noisyPatterns: z.array(z.string().min(1)).optional(),
});

export const throttleSchema = z
  .object({
    maxStepsPerTurn: z.number().int().min(1).max(50).optional(),
    warningStepThreshold: z.number().int().min(1).optional(),
    maxFileLineRead: z.number().int().min(50).max(1000).optional(),
    subprocessCompaction: subprocessCompactionSchema.optional(),
    turnCostBudgetUsd: z.number().positive().optional(),
  })
  .refine((c) => c.warningStepThreshold === undefined || c.maxStepsPerTurn === undefined || c.warningStepThreshold < c.maxStepsPerTurn, {
    message: 'throttle: warningStepThreshold must be less than maxStepsPerTurn',
    path: ['warningStepThreshold'],
  });

export type ThrottleSchemaInput = z.infer<typeof throttleSchema>;

/** Validate + fill defaults for the `throttle` harness block. Mirrors `resolveGuard`'s shape exactly. */
export function resolveThrottleConfig(c: ThrottleConfig): ResolvedThrottleConfig {
  const parsed = throttleSchema.parse(c);
  return {
    maxStepsPerTurn: parsed.maxStepsPerTurn ?? DEFAULT_MAX_STEPS_PER_TURN,
    warningStepThreshold: parsed.warningStepThreshold ?? DEFAULT_WARNING_STEP_THRESHOLD,
    maxFileLineRead: parsed.maxFileLineRead ?? DEFAULT_MAX_FILE_LINE_READ,
    subprocessCompaction: {
      enabled: parsed.subprocessCompaction?.enabled ?? true,
      maxOutputLines: parsed.subprocessCompaction?.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES,
      noisyPatterns: parsed.subprocessCompaction?.noisyPatterns ?? DEFAULT_NOISY_PATTERNS,
    },
    turnCostBudgetUsd: parsed.turnCostBudgetUsd ?? DEFAULT_TURN_COST_BUDGET_USD,
  };
}
