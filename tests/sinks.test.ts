import { describe, it, expect, vi } from 'vitest';
import { ConsoleSink } from '../src/monitor/sinks/console.js';
import { SentrySink } from '../src/monitor/sinks/sentry.js';
import { newTraceId } from '../src/monitor/wrap.js';
import type { TraceRecord } from '../src/harness/types.js';

const trace = (over: Partial<TraceRecord> = {}): TraceRecord => ({
  skill: 's', traceId: newTraceId(), startedAt: new Date().toISOString(), durationMs: 5, status: 'success', ...over,
});

describe('ConsoleSink', () => {
  it('prints a compact line and never throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new ConsoleSink();
    expect(() => sink.emit(trace({ status: 'error', errorClass: 'transient', healCount: 2, verifyPassed: false }))).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[nim] s'));
    spy.mockRestore();
  });
});

describe('SentrySink', () => {
  it('is a no-op for non-error traces', async () => {
    await expect(new SentrySink().emit(trace({ status: 'success' }))).resolves.toBeUndefined();
  });

  it('is a no-op when SENTRY_DSN is unset', async () => {
    const prev = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    await expect(new SentrySink().emit(trace({ status: 'error' }))).resolves.toBeUndefined();
    if (prev !== undefined) process.env.SENTRY_DSN = prev;
  });

  it('degrades to no-op when @sentry/node is absent (DSN set)', async () => {
    const prev = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    await expect(new SentrySink().emit(trace({ status: 'error' }))).resolves.toBeUndefined();
    if (prev === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = prev;
  });
});
