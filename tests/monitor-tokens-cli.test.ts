import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { recordTokenStep } from '../src/monitor/tokens.js';
import { renderTokensDashboard } from '../src/cli/commands/monitor.js';
import { summarizeTokens, parseTraces } from '../src/monitor/dashboard.js';

const TEST_DIR = '.nim-test-monitor-tokens-cli';
const TEST_FILE = `${TEST_DIR}/traces.jsonl`;

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('monitor --tokens CLI (Task 9)', () => {
  it('renders a friendly message when no trace file exists yet', () => {
    const output = renderTokensDashboard({ file: TEST_FILE });
    expect(output).toMatch(/no trace file at/);
  });

  it('renders a friendly message when the trace file exists but has no throttle traces', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_FILE, `${JSON.stringify({ skill: 'other', traceId: 'x', startedAt: new Date().toISOString(), durationMs: 1, status: 'success' })}\n`);
    const output = renderTokensDashboard({ file: TEST_FILE });
    expect(output).toMatch(/no throttle traces yet/);
  });

  it('renders a ranked task table from seeded traces, matching PRD 26 incident-table shape', () => {
    recordTokenStep({ skill: 'task-a', stepIndex: 1, tokensIn: 1000, tokensOut: 200, cacheReadTokens: 500000, cacheWriteTokens: 10000, costUsd: 0.15 }, TEST_FILE);
    recordTokenStep({ skill: 'task-a', stepIndex: 2, tokensIn: 1200, tokensOut: 250, cacheReadTokens: 600000, cacheWriteTokens: 5000, costUsd: 0.18 }, TEST_FILE);
    recordTokenStep({ skill: 'task-b', stepIndex: 1, tokensIn: 500, tokensOut: 100, cacheReadTokens: 50000, cacheWriteTokens: 5000, costUsd: 0.01 }, TEST_FILE);

    const output = renderTokensDashboard({ file: TEST_FILE });
    expect(output).toMatch(/nim monitor \(tokens\)/);
    expect(output).toMatch(/task-a/);
    expect(output).toMatch(/task-b/);
    expect(output).toMatch(/total cost:/);
    expect(output).toMatch(/total cache reads:/);
    // task-a (higher cost) should be ranked before task-b
    expect(output.indexOf('task-a')).toBeLessThan(output.indexOf('task-b'));
  });

  it('summarizeTokens() computes correct cache hit-rate per task', () => {
    recordTokenStep({ skill: 'task-a', stepIndex: 1, tokensIn: 100, tokensOut: 20, cacheReadTokens: 90, cacheWriteTokens: 10, costUsd: 0.001 }, TEST_FILE);
    const parsed = parseTraces(readFileSync(TEST_FILE, 'utf8'));
    const output = summarizeTokens(parsed);
    expect(output).toMatch(/hit-rate=90%/);
  });
});
