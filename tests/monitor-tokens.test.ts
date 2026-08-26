import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { buildThrottleTrace, recordTokenStep } from '../src/monitor/tokens.js';
import { parseTraces } from '../src/monitor/dashboard.js';

const TEST_DIR = '.nim-test-monitor-tokens';
const TEST_FILE = `${TEST_DIR}/traces.jsonl`;

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('token metrics accumulator (Task 8)', () => {
  it('buildThrottleTrace() produces a well-formed TraceRecord with a populated throttle field', () => {
    const trace = buildThrottleTrace({
      skill: 'cli.run',
      stepIndex: 5,
      tokensIn: 1000,
      tokensOut: 200,
      cacheReadTokens: 50000,
      cacheWriteTokens: 1000,
      costUsd: 0.015,
    });
    expect(trace.throttle).toEqual({
      stepIndex: 5,
      tokensIn: 1000,
      tokensOut: 200,
      cacheReadTokens: 50000,
      cacheWriteTokens: 1000,
      costUsd: 0.015,
    });
    expect(trace.status).toBe('success');
    expect(trace.tokensIn).toBe(1000);
    expect(trace.costEstimate).toBe(0.015);
  });

  it('recordTokenStep() appends a parseable row to the trace file', () => {
    recordTokenStep({ skill: 'cli.run', stepIndex: 1, tokensIn: 100, tokensOut: 20, cacheReadTokens: 5000, cacheWriteTokens: 100, costUsd: 0.001 }, TEST_FILE);
    expect(existsSync(TEST_FILE)).toBe(true);
    const traces = parseTraces(readFileSync(TEST_FILE, 'utf8'));
    expect(traces).toHaveLength(1);
    expect(traces[0]?.throttle?.stepIndex).toBe(1);
  });

  it('recordTokenStep() is append-only across multiple steps', () => {
    recordTokenStep({ skill: 'cli.run', stepIndex: 1, tokensIn: 100, tokensOut: 20, cacheReadTokens: 5000, cacheWriteTokens: 100, costUsd: 0.001 }, TEST_FILE);
    recordTokenStep({ skill: 'cli.run', stepIndex: 2, tokensIn: 200, tokensOut: 40, cacheReadTokens: 15000, cacheWriteTokens: 100, costUsd: 0.003 }, TEST_FILE);
    const traces = parseTraces(readFileSync(TEST_FILE, 'utf8'));
    expect(traces).toHaveLength(2);
    expect(traces.map((t) => t.throttle?.stepIndex)).toEqual([1, 2]);
  });

  it('additive field — existing non-throttle trace rows in the same file remain parseable alongside throttle rows', () => {
    const nonThrottleRow = { skill: 'other.skill', traceId: 'abc', startedAt: new Date().toISOString(), durationMs: 10, status: 'success' };
    recordTokenStep({ skill: 'cli.run', stepIndex: 1, tokensIn: 100, tokensOut: 20, cacheReadTokens: 5000, cacheWriteTokens: 100, costUsd: 0.001 }, TEST_FILE);
    appendFileSync(TEST_FILE, `${JSON.stringify(nonThrottleRow)}\n`);
    const traces = parseTraces(readFileSync(TEST_FILE, 'utf8'));
    expect(traces).toHaveLength(2);
    expect(traces[0]?.throttle).toBeDefined();
    expect(traces[1]?.throttle).toBeUndefined();
  });
});
