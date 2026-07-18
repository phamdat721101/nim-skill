/**
 * src/lessons/types.ts
 * ---------------------
 * `nim-lessons` — the auto-captured, queryable error/lesson log. Structurally
 * different from `nim-memory` (which caches an unchanged output's verify
 * verdict): a `Lesson` answers "has a similarly-SHAPED action previously
 * failed, for a reason that generalizes beyond this one output's content?"
 * Data-only, serializable (JSONL-appendable), same discipline as every other
 * harness type in `harness/types.ts`.
 */

/** The shape a proposed action is matched against — deterministic, not semantic. */
export interface TriggerShape {
  toolName: string;
  pathGlob: string;
  contentSignal: string | null;
}

export interface Lesson {
  id: string;
  capturedAt: string;
  triggerShape: TriggerShape;
  whatWentWrong: string;
  correctPattern: string;
  severity: 'info' | 'warning' | 'critical';
  source: 'manual' | 'auto';
}
