/**
 * src/throttle/test-interceptor.ts
 * -----------------------------------
 * v0.16 `nim-throttle` Pillar 2 — Subprocess & Test Compaction Gating (PRD
 * 26 §4/Pillar 2, PRD 27 Task 2.1). Pattern-matches noisy build/test
 * commands and routes their raw output through the EXISTING
 * `nim-logcompact` `errors-only` strategy (`src/logcompact`) — this module
 * deliberately does not reimplement compaction; it is a thin command-match
 * + delegate layer, per the confirmed plan ("import src/logcompact, do not
 * reimplement compaction logic").
 */

import { createLogCompactHelper } from '../logcompact/index.js';
import type { CompactResult } from '../logcompact/types.js';
import type { ResolvedThrottleConfig } from './types.js';

/**
 * True when `command` matches one of the configured noisy patterns
 * (`subprocessCompaction.noisyPatterns`, e.g. `gradlew`, `npm test`,
 * `vitest`, `pytest`, `mvn`, `cargo test`). Case-insensitive substring match
 * — the same matching style already used by workrule's WR-04 rule (Task 5).
 */
export function isNoisyTestCommand(command: string, config: ResolvedThrottleConfig): boolean {
  if (!config.subprocessCompaction.enabled) return false;
  const lower = command.toLowerCase();
  return config.subprocessCompaction.noisyPatterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

/**
 * Compact `rawOutput` through `nim-logcompact`'s `errors-only` strategy
 * using `subprocessCompaction.maxOutputLines` as the line cap. Callers
 * should call `isNoisyTestCommand()` first — this function does not
 * re-check the command string, only compacts whatever text it is given.
 */
export function compactTestOutput(rawOutput: string, config: ResolvedThrottleConfig): CompactResult {
  const helper = createLogCompactHelper({
    strategy: 'errors-only',
    maxLines: config.subprocessCompaction.maxOutputLines,
    escalateOnEmpty: true,
  });
  return helper.compact(rawOutput);
}

/**
 * Convenience one-shot: given a command string and its raw output, decide
 * whether to compact and return either the original or compacted text plus
 * whether compaction was applied. This is the function `hooks/pre-tool.ts`
 * (Task 7) and `cli.ts run --throttle` (Task 4 demo) call.
 */
export function interceptTestCommand(
  command: string,
  rawOutput: string,
  config: ResolvedThrottleConfig,
): { compacted: boolean; output: string; result?: CompactResult } {
  if (!isNoisyTestCommand(command, config)) {
    return { compacted: false, output: rawOutput };
  }
  const result = compactTestOutput(rawOutput, config);
  return { compacted: true, output: result.text, result };
}
