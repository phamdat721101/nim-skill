import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecCompiler, SpecEnvelopeZodSchema, type SpecEnvelope } from '../src/search/compiler.js';
import { verifyOrHeal } from '../src/enforcer/output-enforcer.js';
import type { EnforceConfig } from '../src/enforcer/output-enforcer.js';

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nim-search-compiler-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function baseSpec(overrides: Partial<SpecEnvelope> = {}): SpecEnvelope {
  return {
    spec_id: 'SPEC-2026-0001',
    feature_name: 'Payment retries',
    dependencies: [{ package_or_module: 'src/search/bm25.ts', symbol: 'tokenize', file_location: 'src/search/bm25.ts' }],
    architecture: {
      pattern: 'pipeline',
      isolation_boundaries: 'search module only',
      execution_flow: ['tokenize', 'score', 'rank'],
    },
    data_contracts: {
      inputs: { query: 'string' },
      outputs: { results: 'array' },
      error_states: ['empty-query'],
    },
    test_criteria: ['tokenize returns lowercase tokens'],
    ...overrides,
  };
}

describe('SpecEnvelopeZodSchema', () => {
  it('validates a well-formed spec envelope', () => {
    expect(() => SpecEnvelopeZodSchema.parse(baseSpec())).not.toThrow();
  });

  it('rejects a malformed spec_id', () => {
    expect(() => SpecEnvelopeZodSchema.parse(baseSpec({ spec_id: 'not-a-spec-id' }))).toThrow();
  });
});

describe('SpecCompiler.compile', () => {
  it('compiles a valid spec whose dependency symbol IS known, writing both files', () => {
    const root = temp();
    const compiler = new SpecCompiler(root);
    const knownSymbols = new Set(['tokenize', 'buildCorpusStats']);
    const result = compiler.compile(baseSpec(), knownSymbols);

    expect(result.valid).toBe(true);
    expect(result.missingSymbols).toEqual([]);
    expect(existsSync(result.jsonPath)).toBe(true);
    expect(existsSync(result.markdownPath)).toBe(true);

    const json = JSON.parse(readFileSync(result.jsonPath, 'utf8'));
    expect(json.spec_id).toBe('SPEC-2026-0001');

    const markdown = readFileSync(result.markdownPath, 'utf8');
    expect(markdown).toContain('Payment retries');
    expect(markdown).toContain('pipeline');
    expect(markdown).toContain('tokenize');
    expect(markdown).toContain('tokenize returns lowercase tokens');
  });

  it('blocks a spec whose dependency symbol is NOT known, writing no files', () => {
    const root = temp();
    const compiler = new SpecCompiler(root);
    const knownSymbols = new Set(['buildCorpusStats']); // 'tokenize' is missing
    const spec = baseSpec({ spec_id: 'SPEC-2026-0002' });
    const result = compiler.compile(spec, knownSymbols);

    expect(result.valid).toBe(false);
    expect(result.missingSymbols).toHaveLength(1);
    expect(result.missingSymbols[0]).toBe('tokenize (declared in src/search/bm25.ts)');
    expect(result.jsonPath).toBe('');
    expect(result.markdownPath).toBe('');
    expect(existsSync(join(root, '.nim', 'specs', 'SPEC-2026-0002.json'))).toBe(false);
    expect(existsSync(join(root, '.nim', 'specs', 'SPEC-2026-0002.md'))).toBe(false);
  });

  it('does not let a zod validation exception leak raw — malformed spec fails cleanly', () => {
    const root = temp();
    const compiler = new SpecCompiler(root);
    const malformed = { spec_id: 'bad-id' } as unknown as SpecEnvelope;
    expect(() => compiler.compile(malformed, new Set())).not.toThrow();
    const result = compiler.compile(malformed, new Set());
    expect(result.valid).toBe(false);
  });
});

describe('enforcer spec-envelope strategy', () => {
  const strict = (strategies: EnforceConfig['strategies'], maxHeals = 0): EnforceConfig => ({
    strategies,
    maxHeals,
    mode: 'strict',
  });

  it('fails verification for a spec with a missing dependency symbol, exposing missingSymbols', async () => {
    const root = temp();
    const cfg = strict([
      { kind: 'spec-envelope', workspaceRoot: root, knownSymbols: ['buildCorpusStats'] } as unknown as EnforceConfig['strategies'][number],
    ]);
    const output = { spec: baseSpec({ spec_id: 'SPEC-2026-0003' }) };
    const result = await verifyOrHeal(output as unknown as Record<string, unknown>, cfg);
    expect(result.verified).toBe(false);
    expect(result.checks[0]?.reason).toMatch(/tokenize/);
  });

  it('passes verification for a spec whose dependency symbol resolves', async () => {
    const root = temp();
    const cfg = strict([
      { kind: 'spec-envelope', workspaceRoot: root, knownSymbols: ['tokenize', 'buildCorpusStats'] } as unknown as EnforceConfig['strategies'][number],
    ]);
    const output = { spec: baseSpec({ spec_id: 'SPEC-2026-0004' }) };
    const result = await verifyOrHeal(output as unknown as Record<string, unknown>, cfg);
    expect(result.verified).toBe(true);
  });
});
