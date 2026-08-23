import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompactor, validateCompactionOutput } from '../src/compact/index.js';

const candidate = (taskName = 'first') => ({ updatedInvariants: ['keep source immutable', 'validate candidates'], archiveEntry: { date: '2026-08-23', taskName, rootCause: 'growth', resolution: 'distilled' }, resetScratchpad: 'clear next-session notes' });

describe('nim-compact', () => {
  it('writes a separate artifact and never changes source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nim-compact-')); const source = join(dir, 'source.md'); const output = join(dir, 'source.distilled.md');
    writeFileSync(source, 'append-only'); const before = readFileSync(source, 'utf8'); const mtime = statSync(source).mtimeMs;
    const helper = createCompactor({ maxInvariants: 2 });
    expect(helper.apply({ sourcePath: source, outputPath: output }, candidate())).toMatchObject({ written: true, invariantCount: 2, archiveEntryCount: 1 });
    expect(readFileSync(source, 'utf8')).toBe(before); expect(statSync(source).mtimeMs).toBe(mtime);
    helper.apply({ sourcePath: source, outputPath: output }, candidate('second'));
    expect(readFileSync(output, 'utf8')).toContain('Task: second');
    expect((readFileSync(output, 'utf8').match(/^## Archive Entry/gm) ?? [])).toHaveLength(2);
    expect(helper.readInvariants(output)).toEqual(['keep source immutable', 'validate candidates']);
  });

  it('rejects malformed output and source/output aliasing', () => {
    expect(() => validateCompactionOutput({ updatedInvariants: [], archiveEntry: {} })).toThrow();
    expect(() => createCompactor().apply({ sourcePath: 'same', outputPath: 'same' }, candidate())).toThrow();
  });
});
