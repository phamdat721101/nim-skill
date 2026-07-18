/**
 * src/lessons/index.ts
 * ----------------------
 * `createLessonsHelper(cfg)` — the two invocation surfaces nim-lessons ships
 * (04 §3.3): a runtime `ctx.lessons` helper for skills running through
 * `runHarnessed()` (check() before execute, capture() from inside execute on
 * a caught failure), AND a standalone CLI path for hook-native queries that
 * never go through runHarnessed() at all. Both share this one factory —
 * `src/cli.ts` calls it directly, `src/harness/runtime.ts` injects it into ctx.
 */

import { randomUUID } from 'node:crypto';
import { createLessonsStore, type LessonsStoreConfig } from './store.js';
import { matchesShape } from './match.js';
import type { Lesson, TriggerShape } from './types.js';

export interface LessonsHelper {
  check(shape: TriggerShape): Lesson[];
  capture(entry: Omit<Lesson, 'id' | 'capturedAt'>): Lesson;
}

export function createLessonsHelper(cfg: LessonsStoreConfig): LessonsHelper {
  const store = createLessonsStore(cfg);
  return {
    check(shape: TriggerShape): Lesson[] {
      return store.readAll().filter((lesson) => matchesShape(shape, lesson.triggerShape));
    },
    capture(entry: Omit<Lesson, 'id' | 'capturedAt'>): Lesson {
      const lesson: Lesson = { ...entry, id: randomUUID(), capturedAt: new Date().toISOString() };
      store.append(lesson);
      return lesson;
    },
  };
}
