/**
 * src/workrule/rules/wr04.ts
 * ----------------------------
 * v0.16 `nim-throttle` Pillar 2 — WR-04 mandatory-filter linter rule (PRD 27
 * Task 2.2). WR-04 ("partial reads, no new files unless essential") already
 * exists as a self-check QUESTION in `workrule/types.ts` — this module adds
 * a mechanical, evidence-based CHECK on top of that same rule id: it warns
 * when a raw, un-filtered `./gradlew test` (no `--tests`) shows up more than
 * once in the project's own tracked-memory history
 * (`.nim/agent-support-log.md`, read via the EXISTING `workrule/store.ts`
 * reader — no second store, per the confirmed plan).
 *
 * This module does not itself decide what counts as "invoked" — it can only
 * see what was logged. Callers (a hook, a CLI command) are responsible for
 * calling `nim-skill workrule log` with the raw command in `effect` when a
 * test command runs, the same way any other primitive's usage is tracked
 * today.
 */

import type { WorkruleStore } from '../store.js';

export interface Wr04Finding {
  triggered: boolean;
  message?: string;
  occurrences: number;
}

const UNFILTERED_GRADLE_TEST = /\.\/gradlew\s+test(?!\S)/i;
const HAS_TEST_FILTER = /--tests\b/i;

/** True when `commandText` looks like a raw, un-filtered `./gradlew test` invocation. */
export function isUnfilteredGradleTest(commandText: string): boolean {
  return UNFILTERED_GRADLE_TEST.test(commandText) && !HAS_TEST_FILTER.test(commandText);
}

/**
 * Scan the workrule store's history for repeated unfiltered `./gradlew
 * test` invocations recorded in `effect` text. Triggers at 2+ occurrences
 * (PRD 27 Task 2.2: "warning when raw ./gradlew test is invoked... during
 * iterative loops" — a single run is not yet a loop; a second one is).
 */
export function checkWr04MandatoryFilter(store: WorkruleStore): Wr04Finding {
  const occurrences = store.readAll().filter((entry) => isUnfilteredGradleTest(entry.effect)).length;
  if (occurrences < 2) return { triggered: false, occurrences };
  return {
    triggered: true,
    occurrences,
    message: `[WR-04] Detected ${occurrences} raw, un-filtered "./gradlew test" runs logged this project. Use --tests <SpecificTest> during iterative loops to avoid re-running the full suite (nim-throttle Pillar 2).`,
  };
}
