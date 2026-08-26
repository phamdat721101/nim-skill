/**
 * src/monitor/tokens.ts
 * -----------------------
 * v0.16 `nim-throttle` Pillar 4 — Token Metrics Accumulator (PRD 26 §4/
 * Pillar 4, PRD 27 Task 4.1). Appends one `TraceRecord` per turn-step, with
 * its `throttle: ThrottleTrace` field populated, to the SAME `.nim/traces.jsonl`
 * file every other monitor trace already uses (`ResolvedMonitor.traceFile`,
 * default `.nim/traces.jsonl`) — additive rows in the existing format, not a
 * second trace file. Uses the same `FileSink`-style append-only JSONL write
 * as `src/monitor/sinks/file.ts`, but is invoked directly by throttle-aware
 * callers (the hook layer, `cli.ts run --throttle`) rather than through the
 * `Monitor`/`EventSink` fan-out, since a step-level throttle record is not
 * produced inside `runHarnessed()`'s own single-execute trace.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TraceRecord, ThrottleTrace } from '../harness/types.js';

export const DEFAULT_TOKENS_TRACE_FILE = process.env.NIM_TRACE_FILE ?? '.nim/traces.jsonl';

export interface TokenStepInput {
  skill: string;
  stepIndex: number;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/** Build a well-formed TraceRecord for one throttled turn-step. */
export function buildThrottleTrace(input: TokenStepInput): TraceRecord {
  const throttle: ThrottleTrace = {
    stepIndex: input.stepIndex,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    costUsd: input.costUsd,
  };
  return {
    skill: input.skill,
    traceId: randomUUID(),
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: 'success',
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costEstimate: input.costUsd,
    throttle,
  };
}

/** Append one throttle-step trace to the trace file (best-effort, mirrors every other local `.nim/*` store's non-throwing write discipline). */
export function recordTokenStep(input: TokenStepInput, traceFile: string = DEFAULT_TOKENS_TRACE_FILE): TraceRecord {
  const trace = buildThrottleTrace(input);
  try {
    mkdirSync(dirname(traceFile), { recursive: true });
    if (!existsSync(traceFile)) mkdirSync(dirname(traceFile), { recursive: true });
    appendFileSync(traceFile, `${JSON.stringify(trace)}\n`);
  } catch {
    /* best-effort — a telemetry write must never break the calling step */
  }
  return trace;
}
