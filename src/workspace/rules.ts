/**
 * src/workspace/rules.ts
 * -----------------------
 * Pure `(..., cfg) -> CheckResult` functions, same discipline as
 * `src/baseline/rules.ts` — zero I/O, no filesystem, no clock reads beyond
 * the explicit `nowMs` parameter callers pass in.
 */

import type { CheckResult } from '../harness/types.js';

/** Escape a literal string for safe embedding inside a RegExp source. Shared by config.ts and workspace/index.ts. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Single source of truth for the `offStackByPath` fallback derivation —
 * `research/` mapped to a RegExp of the declared stack names (`$never$`
 * when `stack` is empty, matching nothing). Called from BOTH
 * `resolveWorkspaceConfig` (config.ts, the normal nim.json-driven path) and
 * `createWorkspaceGuard` (workspace/index.ts's `ensureOffStackByPath`
 * fallback for callers constructing a `ResolvedWorkspaceConfig`-shaped
 * object directly without `offStackByPath`, e.g. tests) so the derivation
 * logic itself is never duplicated.
 */
export function deriveOffStackByPath(stack: readonly string[]): Record<string, RegExp> {
  const pattern = stack.length > 0 ? stack.map((s) => escapeRegExp(s)).join('|') : '$never$';
  return { 'research/': new RegExp(`^(${pattern})$`, 'i') };
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Calendar-day key (UTC) — used to compare "today" vs. a file's mtime day, ignoring time-of-day. */
function calendarDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function weekdayName(ms: number): string {
  return WEEKDAY_NAMES[new Date(ms).getUTCDay()] ?? 'Sun';
}

/**
 * WS-LOCATION — does the proposed file path's declared subject-matter scope
 * match the content's detected signal cluster? `offStackByPath` maps a path
 * prefix to the RegExp of stack names allowed at that prefix (e.g.
 * `{ "research/": /^(typescript|web3|solidity)$/ }`). `contentSignalCluster`
 * is null when no off-stack cluster was detected (nothing to check against —
 * degrades to pass, matching invariant #4's "no signal, proceed").
 */
export function checkLocationMatch(
  filePath: string,
  contentSignalCluster: string[] | null,
  offStackByPath: Record<string, RegExp>,
): CheckResult {
  if (!contentSignalCluster || contentSignalCluster.length === 0) {
    return { strategy: 'WS-LOCATION', pass: true };
  }
  const prefix = Object.keys(offStackByPath).find((p) => filePath.startsWith(p));
  if (!prefix) return { strategy: 'WS-LOCATION', pass: true };
  const allowed = offStackByPath[prefix];
  if (!allowed) return { strategy: 'WS-LOCATION', pass: true };
  const mismatched = contentSignalCluster.filter((stack) => !allowed.test(stack));
  if (mismatched.length === 0) return { strategy: 'WS-LOCATION', pass: true };
  return {
    strategy: 'WS-LOCATION',
    pass: false,
    reason: `'${filePath}' is scoped to ${allowed.source}, but content clusters signal for: ${mismatched.join(', ')}`,
  };
}

/**
 * WS-STALE — is the liveness file's mtime from a prior calendar day, on a
 * calendar day the cadence grammar declares as an expected-refresh day?
 * Never blocks (see 04 §2.1) — a process signal, not a content signal.
 */
export function checkStaleness(
  livenessFileMtimeMs: number,
  nowMs: number,
  cadenceDays: readonly string[],
): CheckResult {
  if (cadenceDays.length === 0) return { strategy: 'WS-STALE', pass: true };
  const today = weekdayName(nowMs);
  if (!cadenceDays.includes(today)) return { strategy: 'WS-STALE', pass: true };
  if (calendarDayKey(livenessFileMtimeMs) === calendarDayKey(nowMs)) {
    return { strategy: 'WS-STALE', pass: true };
  }
  return {
    strategy: 'WS-STALE',
    pass: false,
    reason: `liveness file was last refreshed on ${calendarDayKey(livenessFileMtimeMs)}, but today (${today}) is a declared cadence day — re-run the workspace sync step before proceeding`,
  };
}
