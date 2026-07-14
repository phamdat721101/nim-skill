/**
 * src/monitor/wrap.ts
 * -------------------
 * Timing + trace assembly around an execution. `wrap()` is the standalone
 * convenience (times a thunk, captures a basic trace, returns the value or
 * rethrows). The full harness builds a richer TraceRecord itself and calls
 * monitor.capture() directly — this file owns the timing/id primitives both use.
 *
 * Ported from HyperMove `observability/wrap.ts`, decoupled from NextRequest.
 */

import { randomUUID } from 'node:crypto';
import type { TraceRecord, RunStatus, ErrorClass, CacheTrace } from '../harness/types.js';
import type { Monitor } from './capture.js';

export function newTraceId(): string {
  return randomUUID();
}

export interface TraceInit {
  skill: string;
  traceId?: string;
  startedAt?: number;
}

export interface TraceFields {
  status: RunStatus;
  durationMs: number;
  errorClass?: ErrorClass;
  verifyPassed?: boolean;
  healCount?: number;
  tokensIn?: number;
  tokensOut?: number;
  costEstimate?: number;
  tokensSavedEstimate?: number;
  tokensSpentByHarness?: number;
  netTokens?: number;
  cache?: CacheTrace;
}

/** Assemble a TraceRecord from an init + measured fields. */
export function buildTrace(init: Required<Pick<TraceInit, 'skill' | 'traceId'>> & { startedAt: number }, fields: TraceFields): TraceRecord {
  return {
    skill: init.skill,
    traceId: init.traceId,
    startedAt: new Date(init.startedAt).toISOString(),
    durationMs: fields.durationMs,
    status: fields.status,
    ...(fields.errorClass !== undefined ? { errorClass: fields.errorClass } : {}),
    ...(fields.verifyPassed !== undefined ? { verifyPassed: fields.verifyPassed } : {}),
    ...(fields.healCount !== undefined ? { healCount: fields.healCount } : {}),
    ...(fields.tokensIn !== undefined ? { tokensIn: fields.tokensIn } : {}),
    ...(fields.tokensOut !== undefined ? { tokensOut: fields.tokensOut } : {}),
    ...(fields.costEstimate !== undefined ? { costEstimate: fields.costEstimate } : {}),
    ...(fields.tokensSavedEstimate !== undefined ? { tokensSavedEstimate: fields.tokensSavedEstimate } : {}),
    ...(fields.tokensSpentByHarness !== undefined ? { tokensSpentByHarness: fields.tokensSpentByHarness } : {}),
    ...(fields.netTokens !== undefined ? { netTokens: fields.netTokens } : {}),
    ...(fields.cache !== undefined ? { cache: fields.cache } : {}),
  };
}

/**
 * Standalone convenience: time `fn`, capture a basic trace, return its value.
 * On throw, capture an error trace then rethrow (transparent wrapper).
 */
export async function wrap<T>(monitor: Monitor, skill: string, fn: () => Promise<T> | T): Promise<T> {
  const traceId = newTraceId();
  const startedAt = Date.now();
  try {
    const value = await fn();
    monitor.capture(buildTrace({ skill, traceId, startedAt }, { status: 'success', durationMs: Date.now() - startedAt }));
    return value;
  } catch (err) {
    monitor.capture(buildTrace({ skill, traceId, startedAt }, { status: 'error', durationMs: Date.now() - startedAt }));
    throw err;
  }
}
