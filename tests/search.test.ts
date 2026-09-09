import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCorpusStats, scoreBm25, tokenize } from '../src/search/bm25.js';
import { chunkMarkdown } from '../src/search/chunk.js';
import { createSearchHelper } from '../src/search/index.js';
import { runHarnessed } from '../src/harness/runtime.js';

describe('nim-search', () => {
  it('tokenizes punctuation and ranks lexical overlap', () => {
    expect(tokenize('Hello, WORLD!')).toEqual(['hello', 'world']);
    const stats = buildCorpusStats([['payment', 'rail'], ['unrelated']]);
    expect(scoreBm25(['payment'], ['payment', 'rail'], stats)).toBeGreaterThan(0);
    expect(scoreBm25(['payment'], ['unrelated'], stats)).toBe(0);
  });

  it('creates self-describing chunks and splits overflow by paragraphs', () => {
    const large = Array.from({ length: 40 }, (_, i) => `paragraph ${i} ${'word '.repeat(15)}`).join('\n\n');
    const chunks = chunkMarkdown('memory.md', `## Incident\n${large}\n\n### Resolution\nkeep the audit trail` , { maxTokens: 50, minTokens: 10 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]?.headerPath).toEqual(['Incident']);
    expect(chunks.every((chunk) => chunk.text.startsWith('[Source: memory.md >'))).toBe(true);
    expect(chunks.at(-1)?.headerPath).toEqual(['Incident', 'Resolution']);
  });

  it('caps ranked results and searches files', () => {
    const helper = createSearchHelper({ topK: 1 });
    const chunks = chunkMarkdown('a.md', '## Payment\npayment rail crashed')
      .concat(chunkMarkdown('b.md', '## Other\ngardening notes'));
    expect(helper.search('payment rail', chunks)).toHaveLength(1);
    expect(helper.search('missing', chunks, { minScore: 0 })).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), 'nim-search-'));
    const file = join(dir, 'memory.md'); writeFileSync(file, '## Lesson\npayment rail crash resolution');
    expect(helper.searchFiles('payment', [file])).toHaveLength(1);
  });

  it('splits JSONL and support-log table entries before ranking them', () => {
    const jsonl = '{"what":"first repeated hook failure"}\n{"what":"auditor blocks fourth attempt"}';
    const table = '| at | effect |\n|---|---|\n| one | hooks failure |\n| two | auditor replan |';
    expect(chunkMarkdown('lessons.jsonl', jsonl, { minTokens: 1, maxTokens: 100 })).toHaveLength(2);
    expect(chunkMarkdown('agent-support-log.md', table, { minTokens: 1, maxTokens: 100 })).toHaveLength(3);
  });

  it('injects ctx.search only when configured and records the query trace', async () => {
    const result = await runHarnessed({ name: 'search-skill', version: 'test', harness: { search: {} }, execute: (_input, ctx) => {
      const chunks = chunkMarkdown('memory.md', '## Lesson\npayment rail crash');
      return { count: ctx.search!.search('payment', chunks).length };
    } }, {}, { agentId: 'test' });
    expect(result.output.count).toBe(1);
    expect(result.trace.search).toMatchObject({ query: 'payment', chunkCount: 1, returnedCount: 1 });
  });
});
