import type { Lesson } from './types.js';
import { matchesGlob, matchesShape } from './match.js';

export interface CostGatePolicy {
  tools: string[];
  lookbackHours: number;
}

export interface CostedAction {
  toolName: string;
  actionKey: string;
}

/** Finds the recent costly failure that makes a proposed action unsafe to repeat. */
export function findCostedActionMatch(
  action: CostedAction,
  policy: CostGatePolicy,
  lessons: Lesson[],
  now = Date.now(),
): Lesson | undefined {
  if (!policy.tools.some((pattern) => matchesGlob(action.toolName, pattern))) return undefined;
  const oldest = now - policy.lookbackHours * 60 * 60 * 1000;
  return lessons.find(
    (lesson) =>
      lesson.outcome === 'wasted_spend' &&
      lesson.triggerShape.actionKey === action.actionKey &&
      new Date(lesson.capturedAt).getTime() >= oldest &&
      matchesShape(
        { toolName: action.toolName, pathGlob: '*', contentSignal: null, actionKey: action.actionKey },
        lesson.triggerShape,
      ),
  );
}
