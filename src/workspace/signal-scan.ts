/**
 * src/workspace/signal-scan.ts
 * ------------------------------
 * Off-stack signal-term clustering. Reuses `checkTaskSpecific`'s exact
 * sliding-window + >=N-clustered-terms algorithm from src/baseline/rules.ts
 * (IMPORTED, not copied — nim-skill's own "shared code is imported, never
 * duplicated" principle #5). `checkTaskSpecific`'s window/threshold params
 * are optional (default 8/3) specifically so this caller can pass its own
 * configured `clusterWindow`/`clusterThreshold` without a parallel
 * hand-written clustering loop. The only new logic here is: iterate the
 * workspace-configured off-stack term lists (one per candidate "other
 * stack"), skip any stack name already present in the workspace's own
 * declared stack (that isn't "off-stack" at all), and surface the first
 * cluster found.
 */

import { checkTaskSpecific } from '../baseline/rules.js';
import type { CheckResult } from '../harness/types.js';

export interface StackSignalConfig {
  [stackName: string]: readonly string[];
}

/**
 * Scans `text` for a clustered block of terms belonging to a stack NOT in
 * `declaredStack`. Returns the first matching stack + its evidence, or null
 * when no off-stack cluster is found (including when the only cluster that
 * would match is for a stack the workspace already declares as its own).
 */
export function scanOffStackSignal(
  text: string,
  declaredStack: readonly string[],
  offStackSignalTerms: StackSignalConfig,
  windowLines: number = 8,
  threshold: number = 3,
): { matchedStack: string; evidence: CheckResult } | null {
  const declared = new Set(declaredStack.map((s) => s.toLowerCase()));
  for (const [stackName, terms] of Object.entries(offStackSignalTerms)) {
    if (declared.has(stackName.toLowerCase())) continue; // not "off-stack" if it's the workspace's own stack
    if (terms.length === 0) continue;
    const result = checkTaskSpecific(text, terms, windowLines, threshold);
    if (!result.pass) {
      return { matchedStack: stackName, evidence: { ...result, strategy: 'WS-SIGNAL' } };
    }
  }
  return null;
}
