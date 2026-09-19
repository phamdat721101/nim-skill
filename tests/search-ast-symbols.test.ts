import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractSymbols, extractSymbolsFallback } from '../src/search/ast-symbols.js';

describe('extractSymbols — real TypeScript source', () => {
  it('finds tokenize, buildCorpusStats, scoreBm25 as exported functions with plausible line ranges', () => {
    const filePath = join(process.cwd(), 'src/search/bm25.ts');
    const source = readFileSync(filePath, 'utf8');
    const symbols = extractSymbols(filePath, source);

    const names = symbols.map((s) => s.name);
    expect(names).toContain('tokenize');
    expect(names).toContain('buildCorpusStats');
    expect(names).toContain('scoreBm25');

    for (const expectedName of ['tokenize', 'buildCorpusStats', 'scoreBm25']) {
      const symbol = symbols.find((s) => s.name === expectedName);
      expect(symbol).toBeDefined();
      expect(symbol!.kind).toBe('function');
      expect(symbol!.isExported).toBe(true);
      expect(symbol!.lineStart).toBeGreaterThan(0);
      expect(symbol!.lineEnd).toBeGreaterThanOrEqual(symbol!.lineStart);
      expect(symbol!.digestSha256).toMatch(/^[a-f0-9]{64}$/);
    }

    // Line ranges should be in increasing order (declaration order in the file).
    const orderedStarts = ['tokenize', 'buildCorpusStats', 'scoreBm25'].map(
      (name) => symbols.find((s) => s.name === name)!.lineStart,
    );
    expect(orderedStarts[0]).toBeLessThan(orderedStarts[1]!);
    expect(orderedStarts[1]).toBeLessThan(orderedStarts[2]!);
  });

  it('extracts an exported interface and an exported class', () => {
    const source = `
export interface Foo {
  bar: string;
}

export class Baz {
  qux(): void {}
}
`;
    const symbols = extractSymbols('sample.ts', source);
    const foo = symbols.find((s) => s.name === 'Foo');
    const baz = symbols.find((s) => s.name === 'Baz');
    expect(foo?.kind).toBe('interface');
    expect(foo?.isExported).toBe(true);
    expect(baz?.kind).toBe('class');
    expect(baz?.isExported).toBe(true);
  });

  it('extracts one level of class-member methods', () => {
    const source = `
export class Widget {
  render(): string { return 'x'; }
  private helper(): void {}
}
`;
    const symbols = extractSymbols('widget.ts', source);
    const render = symbols.find((s) => s.name === 'render');
    expect(render?.kind).toBe('method');
    expect(render?.lineStart).toBeGreaterThan(0);
  });

  it('does not mark non-exported declarations as exported', () => {
    const source = `function internalOnly() { return 1; }`;
    const symbols = extractSymbols('internal.ts', source);
    const symbol = symbols.find((s) => s.name === 'internalOnly');
    expect(symbol?.isExported).toBe(false);
  });

  it('computes a stable sha256 digest per symbol source slice', () => {
    const source = `export function stableFn() { return 42; }`;
    const first = extractSymbols('a.ts', source);
    const second = extractSymbols('a.ts', source);
    expect(first[0]?.digestSha256).toBe(second[0]?.digestSha256);
  });
});

describe('extractSymbolsFallback — non-TS languages', () => {
  it('finds a Python function and class with confidence: low', () => {
    const pySource = 'def foo():\n    pass\n\nclass Bar:\n    pass\n';
    const symbols = extractSymbolsFallback('sample.py', pySource);
    const foo = symbols.find((s) => s.name === 'foo');
    const bar = symbols.find((s) => s.name === 'Bar');
    expect(foo?.kind).toBe('function');
    expect(foo?.confidence).toBe('low');
    expect(bar?.kind).toBe('class');
    expect(bar?.confidence).toBe('low');
  });

  it('finds a Go function via func-style declaration', () => {
    const goSource = 'package main\n\nfunc DoWork() error {\n\treturn nil\n}\n';
    const symbols = extractSymbolsFallback('sample.go', goSource);
    expect(symbols.some((s) => s.name === 'DoWork' && s.kind === 'function' && s.confidence === 'low')).toBe(true);
  });

  it('finds a Rust function via fn-style declaration', () => {
    const rsSource = 'pub fn compute(x: i32) -> i32 {\n    x + 1\n}\n';
    const symbols = extractSymbolsFallback('sample.rs', rsSource);
    expect(symbols.some((s) => s.name === 'compute' && s.kind === 'function' && s.confidence === 'low')).toBe(true);
  });

  it('finds a Solidity contract declaration', () => {
    const solSource = 'pragma solidity ^0.8.0;\n\ncontract Token {\n    uint256 public totalSupply;\n}\n';
    const symbols = extractSymbolsFallback('sample.sol', solSource);
    expect(symbols.some((s) => s.name === 'Token' && s.kind === 'class' && s.confidence === 'low')).toBe(true);
  });
});
