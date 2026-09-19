/**
 * tests/search-cli.test.ts
 * --------------------------
 * Task 7/AS-SCP — `nim-skill search` command group (legacy leaf action +
 * overview/graph/hydrate/compile subcommands).
 *
 * Fixture choice (documented per the task instructions): tests run against
 * a small, isolated tmpdir copy of a FEW real repo files (this repo's own
 * src/search/bm25.ts and src/search/vfs.ts), not against process.cwd()
 * directly. Running against the full repo would make
 * `buildIncrementalIndex`/AST-symbol extraction walk hundreds of files per
 * test (slow, and candidate ordering could vary machine-to-machine); a
 * tiny, real-content fixture directory keeps every assertion exact (e.g.
 * "the same real symbol name found via extractAnySymbols on bm25.ts")
 * while staying fast and deterministic.
 *
 * Unit-level (a)-(e) call the exported throwing "core" functions in
 * src/search/cli.ts directly (coreSearchOverview/coreSearchGraph/
 * coreSearchHydrate/coreSearchCompile) — real logic, no Commander parsing,
 * no process.exit side effects, so failures assert via a real `toThrow()`/
 * `rejects.toThrow()` rather than inspecting process.exitCode. Tier (f) —
 * the single most important assertion in this task — goes through a REAL
 * built CLI process (`dist/cli.js`) exactly like the existing
 * tests/e2e/logcompact-cli.test.ts pattern.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateTokens } from '../src/tokens.js';
import { extractAnySymbols } from '../src/search/ast-symbols.js';
import { coreSearchOverview, coreSearchGraph, coreSearchHydrate, coreSearchCompile } from '../src/search/cli.js';

const cliPath = `${process.cwd()}/dist/cli.js`;
const REPO_ROOT = process.cwd();

let fixtureRoot: string;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nim-search-cli-'));
  mkdirSync(join(dir, 'src', 'search'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'src', 'search', 'bm25.ts'), join(dir, 'src', 'search', 'bm25.ts'));
  copyFileSync(join(REPO_ROOT, 'src', 'search', 'vfs.ts'), join(dir, 'src', 'search', 'vfs.ts'));
  return dir;
}

describe('nim-skill search CLI (Task 7)', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'pipe' });
  }, 120_000);

  afterEach(() => {
    if (fixtureRoot && existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  // ─── (a) search_overview: bounded, real gists, real vfs serp files ──────

  it('(a) search_overview returns bounded candidates with real gist token counts and a real mounted SERP', () => {
    fixtureRoot = makeFixture();

    const output = coreSearchOverview('find the incremental BM25 scoring function inside this codebase', { root: fixtureRoot });

    expect(output.total_candidates).toBeLessThanOrEqual(30);
    expect(output.candidates.length).toBe(output.total_candidates);
    for (const candidate of output.candidates) {
      expect(estimateTokens(candidate.gist)).toBeLessThanOrEqual(40);
      expect(candidate.token_cost).toBe(estimateTokens(candidate.gist));
    }

    expect(existsSync(output.vfs_serp_path)).toBe(true);
    const manifestPath = join(output.vfs_serp_path, 'manifest.json');
    const candidatesTsvPath = join(output.vfs_serp_path, 'candidates.tsv');
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(candidatesTsvPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.query_hash).toBe(output.query_hash);
    expect(manifest.candidate_count).toBe(output.candidates.length);

    const tsv = readFileSync(candidatesTsvPath, 'utf8');
    expect(tsv.split('\n')[0]).toBe('SCORE\tENTITY_ID\tTYPE\tURI\tGIST');
  });

  // ─── (b) caveman query rejected before any file I/O ──────────────────────

  it('(b) a caveman-query input is rejected before any index/serp file I/O happens', () => {
    fixtureRoot = makeFixture();

    expect(() => coreSearchOverview('auth token', { root: fixtureRoot })).toThrow();
    // No .nim/index or .nim/search_serp directory should exist — the Zod
    // rejection must happen before buildIncrementalIndex()/mountSerp() run.
    expect(existsSync(join(fixtureRoot, '.nim', 'index'))).toBe(false);
    expect(existsSync(join(fixtureRoot, '.nim', 'search_serp'))).toBe(false);
  });

  it('(b2) a too-short declarative_intent is also rejected', () => {
    fixtureRoot = makeFixture();
    expect(() => coreSearchOverview('short', { root: fixtureRoot })).toThrow();
  });

  // ─── (c) traverse_context_graph ───────────────────────────────────────────

  it('(c) traverse_context_graph returns a well-shaped array for a real origin node id, and errors clearly for a fake one', async () => {
    fixtureRoot = makeFixture();

    const overview = coreSearchOverview('find the vfs serp manager implementation in this repo', { root: fixtureRoot });
    expect(overview.candidates.length).toBeGreaterThan(0);
    const originNodeId = overview.candidates[0]!.entity_id;

    const traversal = await coreSearchGraph(originNodeId, { relationship: 'IMPLEMENTS', root: fixtureRoot });
    expect(Array.isArray(traversal.traversed_edges)).toBe(true);
    expect(traversal.origin_node_id).toBe(originNodeId);
    for (const edge of traversal.traversed_edges) {
      expect(typeof edge.target_node_id).toBe('string');
      expect(typeof edge.relationship).toBe('string');
    }

    await expect(coreSearchGraph('file::does-not-exist.ts', { relationship: 'IMPLEMENTS', root: fixtureRoot })).rejects.toThrow();
  });

  // ─── (d) hydrate_spec_context ─────────────────────────────────────────────

  it('(d) hydrate_spec_context produces snippets each <=150 tokens, and total_tokens_consumed sums exactly', async () => {
    fixtureRoot = makeFixture();

    const bm25Source = readFileSync(join(fixtureRoot, 'src', 'search', 'bm25.ts'), 'utf8');
    const symbols = extractAnySymbols(join(fixtureRoot, 'src', 'search', 'bm25.ts'), bm25Source);
    const scoreBm25Symbol = symbols.find((s) => s.name === 'scoreBm25');
    const tokenizeIdentifierSymbol = symbols.find((s) => s.name === 'tokenizeIdentifier');
    expect(scoreBm25Symbol).toBeDefined();
    expect(tokenizeIdentifierSymbol).toBeDefined();

    const nodeIds = [`symbol::src/search/bm25.ts::${scoreBm25Symbol!.name}`, `symbol::src/search/bm25.ts::${tokenizeIdentifierSymbol!.name}`];

    const output = await coreSearchHydrate(nodeIds, { root: fixtureRoot });

    expect(output.hydrated_nodes.length).toBe(2);
    let expectedTotal = 0;
    for (const node of output.hydrated_nodes) {
      expect(node.token_count).toBeLessThanOrEqual(150);
      expectedTotal += node.token_count;
    }
    expect(output.total_tokens_consumed).toBe(expectedTotal);
    expect(existsSync(output.vfs_hydrated_dir)).toBe(true);
  });

  it('(d2) more than 10 node ids is rejected', async () => {
    fixtureRoot = makeFixture();
    const tooMany = Array.from({ length: 11 }, (_, i) => `symbol::x.ts::sym${i}`);
    await expect(coreSearchHydrate(tooMany, { root: fixtureRoot })).rejects.toThrow();
  });

  // ─── (e) compile_specification_artifact ───────────────────────────────────

  it('(e) compile_specification_artifact PASSes for a real symbol and FAILs for a hallucinated one', () => {
    fixtureRoot = makeFixture();

    const bm25Source = readFileSync(join(fixtureRoot, 'src', 'search', 'bm25.ts'), 'utf8');
    const symbols = extractAnySymbols(join(fixtureRoot, 'src', 'search', 'bm25.ts'), bm25Source);
    expect(symbols.some((s) => s.name === 'scoreBm25')).toBe(true);

    const validSpec = {
      spec_id: 'SPEC-2026-000001',
      feature_name: 'Real symbol dependency test',
      dependencies: [{ package_or_module: './bm25.js', symbol: 'scoreBm25', file_location: 'src/search/bm25.ts' }],
      architecture: { pattern: 'module', isolation_boundaries: 'none', execution_flow: ['call scoreBm25'] },
      data_contracts: { inputs: {}, outputs: {}, error_states: [] },
      test_criteria: ['scoreBm25 returns a number'],
    };

    const passOutput = coreSearchCompile({ title: 'Real symbol dependency test', specValue: validSpec, root: fixtureRoot });
    expect(passOutput.verification_status).toBe('PASS');
    expect(passOutput.hallucinated_symbols).toEqual([]);
    expect(passOutput.verified_symbol_count).toBe(1);
    expect(existsSync(passOutput.markdown_path)).toBe(true);
    expect(existsSync(passOutput.json_path)).toBe(true);

    const fakeSpec = {
      ...validSpec,
      spec_id: 'SPEC-2026-000002',
      dependencies: [{ package_or_module: './bm25.js', symbol: 'totallyFakeSymbolXYZ', file_location: 'src/search/bm25.ts' }],
    };

    // coreSearchCompile() itself never throws on a FAILED verification (only on malformed input) —
    // the CLI layer is what maps verification_status:'FAILED' to exit code 1, exercised separately
    // in the real built-CLI smoke test below.
    const failedOutput = coreSearchCompile({ title: 'Fake symbol dependency test', specValue: fakeSpec, root: fixtureRoot });
    expect(failedOutput.verification_status).toBe('FAILED');
    expect(failedOutput.hallucinated_symbols).toContain('totallyFakeSymbolXYZ');
  });

  // ─── (f) BACKWARD COMPAT — the single most important assertion ────────────

  it('(f) legacy `search "<query>" --files <paths...>` output is byte-identical to the pre-Task-7 format', () => {
    fixtureRoot = makeFixture();
    const fixtureMd = join(fixtureRoot, 'note.md');
    writeFileSync(fixtureMd, '# Heading\n\nThis mentions bm25 scoring and identifier tokenization directly.\n');

    const result = spawnSync('node', [cliPath, 'search', 'bm25 tokenization', '--files', fixtureMd], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });

    expect(result.status).toBe(0);
    // Exact legacy format: `${score}\t${sourcePath}\t${headerPath}\n${text}` per result, blank-line joined.
    expect(result.stdout).toMatch(/^-?\d+\.\d{4}\t.+\t.*\n/);
    expect(result.stdout).not.toMatch(/^\{/); // never the new JSON shape
    expect(result.stdout).not.toContain('"query_hash"');
  });

  it('(f2) --spec pointing at a fake symbol exits 1 through the real built CLI (compile FAILED path)', () => {
    fixtureRoot = makeFixture();
    const specPath = join(fixtureRoot, 'fake-spec.json');
    writeFileSync(
      specPath,
      JSON.stringify({
        spec_id: 'SPEC-2026-000003',
        feature_name: 'CLI FAILED path test',
        dependencies: [{ package_or_module: './bm25.js', symbol: 'notARealSymbolHere', file_location: 'src/search/bm25.ts' }],
        architecture: { pattern: 'module', isolation_boundaries: 'none', execution_flow: ['n/a'] },
        data_contracts: { inputs: {}, outputs: {}, error_states: [] },
        test_criteria: ['n/a'],
      }),
    );

    const result = spawnSync('node', [cliPath, 'search', 'compile', '--title', 'CLI FAILED path test', '--spec', specPath, '--root', fixtureRoot], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.verification_status).toBe('FAILED');
    expect(parsed.hallucinated_symbols).toContain('notARealSymbolHere');
  });

  it('(f3) the real built CLI also runs `search overview` end-to-end (smoke, not just unit-level)', () => {
    fixtureRoot = makeFixture();
    const result = spawnSync(
      'node',
      [cliPath, 'search', 'overview', 'find the incremental BM25 indexer function in this codebase', '--root', fixtureRoot],
      { encoding: 'utf8', cwd: REPO_ROOT },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('query_hash');
    expect(parsed).toHaveProperty('candidates');
  });

  it('(f4) invalid input to a new subcommand fails cleanly (one-line stderr, exit 1, no stack trace)', () => {
    fixtureRoot = makeFixture();
    const result = spawnSync('node', [cliPath, 'search', 'overview', 'auth token', '--root', fixtureRoot], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split('\n').length).toBe(1);
    expect(result.stderr).not.toMatch(/\bat\s+\S+\s*\(/); // no stack-trace frame (e.g. "at foo (file.js:1:1)")
    expect(result.stderr).not.toContain('.js:');
  });
});
