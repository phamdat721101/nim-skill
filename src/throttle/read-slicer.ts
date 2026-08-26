/**
 * src/throttle/read-slicer.ts
 * ------------------------------
 * v0.16 `nim-throttle` Pillar 3 — Surgical Read Slicing (PRD 26 §4/Pillar 3,
 * PRD 27 Task 3.1). Detects a full-file read request whose line count
 * exceeds `maxFileLineRead` and requires an explicit `startLine`/`endLine`
 * range (<= `maxFileLineRead` lines) before allowing it.
 *
 * Result shape deliberately mirrors `WorkspaceCheckResult`
 * (`src/workspace/index.ts`: `{recommendation, reason, evidence}`-style) per
 * the confirmed plan ("same shape family... not a new ad hoc shape") without
 * importing that type directly — read-slicing is a throttle concern, not a
 * workspace-identity concern, so this module defines its own
 * `ReadSliceDecision` with the same allowed/reason/evidence shape rather
 * than taking a dependency on `nim-workspace`.
 */

import type { ResolvedThrottleConfig } from './types.js';

export interface ReadRange {
  startLine: number;
  endLine: number;
}

export interface ReadSliceDecision {
  allowed: boolean;
  reason: string;
  /** Present only when a request was blocked for lacking (or exceeding) a valid range. */
  suggestedRange?: ReadRange;
}

export interface ReadRequest {
  /** Total line count of the file being read (or about to be read). */
  totalLines: number;
  /** The requested range, if the caller already supplied one. Absent = a full-file read attempt. */
  range?: ReadRange;
}

/**
 * Decide whether a read request is allowed under `maxFileLineRead`. 4
 * states (PRD 27 Task 3.1 / plan's Task 6 matrix):
 *  - small file (totalLines <= maxFileLineRead): always allowed, no range needed.
 *  - large file, no range: BLOCKED with a suggested first-slice range.
 *  - large file, valid range (<= maxFileLineRead lines, in bounds): allowed.
 *  - large file, out-of-bounds or oversized range: BLOCKED.
 */
export function checkReadSlice(request: ReadRequest, config: ResolvedThrottleConfig): ReadSliceDecision {
  const { totalLines, range } = request;
  const limit = config.maxFileLineRead;

  if (totalLines <= limit) {
    return { allowed: true, reason: `File has ${totalLines} lines (<= ${limit}-line clamp) — full read allowed.` };
  }

  if (!range) {
    return {
      allowed: false,
      reason: `File has ${totalLines} lines, exceeding the ${limit}-line clamp. Provide an explicit startLine/endLine range (<= ${limit} lines), or grep first.`,
      suggestedRange: { startLine: 1, endLine: Math.min(limit, totalLines) },
    };
  }

  const { startLine, endLine } = range;
  const outOfBounds = startLine < 1 || endLine > totalLines || startLine > endLine;
  const oversized = endLine - startLine + 1 > limit;

  if (outOfBounds) {
    return {
      allowed: false,
      reason: `Requested range ${startLine}-${endLine} is out of bounds for a ${totalLines}-line file.`,
      suggestedRange: { startLine: 1, endLine: Math.min(limit, totalLines) },
    };
  }

  if (oversized) {
    return {
      allowed: false,
      reason: `Requested range ${startLine}-${endLine} (${endLine - startLine + 1} lines) exceeds the ${limit}-line clamp.`,
      suggestedRange: { startLine, endLine: Math.min(startLine + limit - 1, totalLines) },
    };
  }

  return { allowed: true, reason: `Requested range ${startLine}-${endLine} is within the ${limit}-line clamp.` };
}
