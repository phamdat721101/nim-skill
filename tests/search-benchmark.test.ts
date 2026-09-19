/**
 * tests/search-benchmark.test.ts
 * ---------------------------------
 * Task 8/AS-SCP — real, measured tests for `runSearchBenchmark()`.
 *
 * Fixture-set test: a tiny isolated tmpdir copy of a few real repo files
 * (same pattern as tests/search-cli.test.ts) — fast, deterministic,
 * exercises the real `coreSearchOverview()` + `SpecCompiler.compile()`
 * code paths without walking the whole repo.
 *
 * Real-repo integration test: runs against `process.cwd()` for real (same
 * pattern as tests/search-graph.test.ts's `GitSource.ingest()` check) —
 * sanity-checks report shape only, never asserts an exact degenerate-gist
 * count against the real repo (that count is allowed to change as Task 7's
 * gist-extraction logic evolves).
 */

import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSearchBenchmark, runHallucinationGate, DEFAULT_BENCHMARK_QUERIES } from '../src/search/benchmark.js';

const REPO_ROOT = process.cwd();

let fixtureRoot: string;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nim-search-benchmark-'));
  mkdirSync(join(dir, 'src', 'search'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'src', 'search', 'bm25.ts'), join(dir, 'src', 'search', 'bm25.ts'));
  copyFileSync(join(REPO_ROOT, 'src', 'search', 'vfs.ts'), join(dir, 'src', 'search', 'vfs.ts'));
  copyFileSync(join(REPO_ROOT, 'src', 'search', 'compiler.ts'), join(dir, 'src', 'search', 'compiler.ts'));
  return dir;
}

describe('runSearchBenchmark — small fixture set', () => {
  afterEach(() => {
    if (fixtureRoot && existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('returns a well-shaped report for a small fixture query set', () => {
    fixtureRoot = makeFixture();
    const report = runSearchBenchmark(fixtureRoot, ['find the BM25 scoring function', 'find the VFS SERP eviction logic']);

    expect(report.workspace_root).toBeTruthy();
    expect(typeof report.generated_at).toBe('string');
    expect(report.queries).toHaveLength(2);
    for (const q of report.queries) {
      expect(typeof q.latency_ms).toBe('number');
      expect(q.latency_ms).toBeGreaterThanOrEqual(0);
      expect(typeof q.candidate_count).toBe('number');
      expect(typeof q.total_token_cost).toBe('number');
      expect(q.total_token_cost).toBeGreaterThanOrEqual(0);
      expect(typeof q.degenerate_gist_count).toBe('number');
      expect(q.degenerate_gist_count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(q.degenerate_gist_examples)).toBe(true);
    }
  });

  it('the hallucination-gate probe shows exactly 1 pass and 1 fail for the fixed real-vs-fake symbol pair', () => {
    fixtureRoot = makeFixture();
    const gate = runHallucinationGate(fixtureRoot);

    expect(gate.real_symbol_probe.attempted).toBe(true);
    expect(gate.fake_symbol_probe.attempted).toBe(true);
    expect(gate.real_symbol_probe.passed).toBe(true);
    expect(gate.fake_symbol_probe.passed).toBe(false);
    expect(gate.fake_symbol_probe.missing_symbols.length).toBeGreaterThan(0);
    expect(gate.pass_count).toBe(1);
    expect(gate.fail_count).toBe(1);
  });

  it('is included end-to-end inside runSearchBenchmark()\'s own report', () => {
    fixtureRoot = makeFixture();
    const report = runSearchBenchmark(fixtureRoot, ['find the BM25 scoring function']);
    expect(report.hallucination_gate.pass_count).toBe(1);
    expect(report.hallucination_gate.fail_count).toBe(1);
  });
});

describe('runSearchBenchmark — real integration against this repo (process.cwd())', () => {
  beforeAll(() => {
    // No build step required here — coreSearchOverview/SpecCompiler are called
    // directly as TS source via vitest, exactly like search-graph.test.ts's
    // real GitSource.ingest() check against this repo's real git history.
  });

  it('runs the default query battery against the real workspace and returns a sane, non-crashing shape', () => {
    const report = runSearchBenchmark(process.cwd(), DEFAULT_BENCHMARK_QUERIES);

    expect(report.queries).toHaveLength(DEFAULT_BENCHMARK_QUERIES.length);
    for (const q of report.queries) {
      expect(q.latency_ms).toBeGreaterThanOrEqual(0);
      expect(q.candidate_count).toBeGreaterThanOrEqual(0);
      expect(q.total_token_cost).toBeGreaterThanOrEqual(0);
      // Real repo's degenerate-gist count is NOT asserted to any specific
      // value (Task 7's gist logic may change it) — only that it's a
      // well-formed, non-negative number, per Task 8's own instruction.
      expect(q.degenerate_gist_count).toBeGreaterThanOrEqual(0);
    }
    expect(report.hallucination_gate.real_symbol_probe.attempted).toBe(true);
    expect(report.hallucination_gate.fake_symbol_probe.attempted).toBe(true);
    expect(report.hallucination_gate.pass_count + report.hallucination_gate.fail_count).toBe(2);
  }, 60_000);
});
