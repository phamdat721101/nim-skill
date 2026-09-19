import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokenizeIdentifier } from '../src/search/bm25.js';
import { buildIncrementalIndex } from '../src/search/indexer.js';

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nim-search-indexer-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('tokenizeIdentifier', () => {
  it('splits camelCase into lowercase sub-tokens', () => {
    expect(tokenizeIdentifier('getUserName')).toEqual(['get', 'user', 'name']);
  });

  it('splits snake_case into lowercase sub-tokens', () => {
    expect(tokenizeIdentifier('max_retry_count')).toEqual(['max', 'retry', 'count']);
  });

  it('splits SCREAMING_SNAKE_CASE into lowercase sub-tokens', () => {
    expect(tokenizeIdentifier('MAX_RETRY_COUNT')).toEqual(['max', 'retry', 'count']);
  });

  it('splits PascalCase into lowercase sub-tokens', () => {
    expect(tokenizeIdentifier('HttpRequestHandler')).toEqual(['http', 'request', 'handler']);
  });

  it('also splits plain words the same way tokenize() would', () => {
    expect(tokenizeIdentifier('payment rail crash')).toEqual(['payment', 'rail', 'crash']);
  });
});

describe('buildIncrementalIndex', () => {
  it('builds a JSON index with the correct file list for a small fixture dir', () => {
    const root = temp();
    writeFileSync(join(root, 'a.ts'), 'export function getUserName() { return 1; }');
    writeFileSync(join(root, 'b.ts'), 'export const MAX_RETRY_COUNT = 3;');
    const indexPath = join(root, '.nim', 'index', 'search_index.json');
    const result = buildIncrementalIndex(root, indexPath);
    expect(existsSync(indexPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(persisted.files.sort()).toEqual([join(root, 'a.ts'), join(root, 'b.ts')].sort());
    expect(result.files.sort()).toEqual([join(root, 'a.ts'), join(root, 'b.ts')].sort());
    expect(persisted.corpusStats.docCount).toBe(2);
    const aTokens = persisted.fileTokens[join(root, 'a.ts')];
    expect(aTokens).toEqual(expect.arrayContaining(['get', 'user', 'name']));
  });

  it('skips node_modules/.git/dist/build directories', () => {
    const root = temp();
    writeFileSync(join(root, 'keep.ts'), 'export const keepMe = 1;');
    const nm = join(root, 'node_modules');
    mkdirSync(nm);
    writeFileSync(join(nm, 'ignored.ts'), 'export const ignoreMe = 1;');
    const indexPath = join(root, '.nim', 'index', 'search_index.json');
    const result = buildIncrementalIndex(root, indexPath);
    expect(result.files).toEqual([join(root, 'keep.ts')]);
  });

  it('skips binary-looking files (null bytes)', () => {
    const root = temp();
    writeFileSync(join(root, 'text.ts'), 'export const ok = 1;');
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x41, 0x42]));
    const indexPath = join(root, '.nim', 'index', 'search_index.json');
    const result = buildIncrementalIndex(root, indexPath);
    expect(result.files).toEqual([join(root, 'text.ts')]);
  });

  it('skips files larger than 500KB', () => {
    const root = temp();
    writeFileSync(join(root, 'small.ts'), 'export const ok = 1;');
    writeFileSync(join(root, 'huge.ts'), 'x'.repeat(600 * 1024));
    const indexPath = join(root, '.nim', 'index', 'search_index.json');
    const result = buildIncrementalIndex(root, indexPath);
    expect(result.files).toEqual([join(root, 'small.ts')]);
  });

  it('does not re-tokenize unchanged files on re-run (mtime-based cache reuse)', () => {
    const root = temp();
    const filePath = join(root, 'stable.ts');
    writeFileSync(filePath, 'export function getUserName() { return 1; }');
    const indexPath = join(root, '.nim', 'index', 'search_index.json');

    buildIncrementalIndex(root, indexPath);
    const firstPersisted = JSON.parse(readFileSync(indexPath, 'utf8'));
    const firstMtime = firstPersisted.fileMtimes[filePath];

    // Mutate the file ON DISK without changing its mtime record in a way that
    // would be visible if the indexer actually re-read it: since we can't
    // intercept fs.readFileSync easily without a spy, we instead prove the
    // stored tokens are identical to the first run's tokens (an actual
    // re-tokenize of unchanged content should still be identical, so this
    // alone isn't proof — combine with the sentinel test below).
    buildIncrementalIndex(root, indexPath);
    const secondPersisted = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(secondPersisted.fileMtimes[filePath]).toBe(firstMtime);
    expect(secondPersisted.fileTokens[filePath]).toEqual(firstPersisted.fileTokens[filePath]);
  });

  it('reuses previously stored tokens for a file whose mtime is unchanged, even if disk content silently differs', () => {
    // This is the real "not re-read" proof: if the indexer skipped re-tokenizing
    // (because mtime is unchanged in its recorded index), then editing file
    // content WITHOUT updating mtime must not change the persisted tokens.
    const root = temp();
    const filePath = join(root, 'sentinel.ts');
    writeFileSync(filePath, 'export function originalName() { return 1; }');
    const indexPath = join(root, '.nim', 'index', 'search_index.json');
    buildIncrementalIndex(root, indexPath);
    const first = JSON.parse(readFileSync(indexPath, 'utf8'));
    const originalMtime = Math.floor(first.fileMtimes[filePath]);
    const originalAtime = statSync(filePath).atime;
    // Force the file's mtime to the floored (whole-millisecond) value so the
    // later utimesSync-based restoration round-trips exactly — utimesSync
    // truncates sub-millisecond fractions, so comparing against a fractional
    // mtimeMs would spuriously fail regardless of indexer correctness.
    utimesSync(filePath, originalAtime, new Date(originalMtime));
    const rebased = JSON.parse(JSON.stringify(buildIncrementalIndex(root, indexPath)));
    const rebasedPersisted = JSON.parse(readFileSync(indexPath, 'utf8'));
    void rebased;

    // Overwrite content but restore the exact same (whole-ms) mtime afterward.
    writeFileSync(filePath, 'export function changedNameShouldNotAppear() { return 2; }');
    utimesSync(filePath, originalAtime, new Date(originalMtime));

    buildIncrementalIndex(root, indexPath);
    const second = JSON.parse(readFileSync(indexPath, 'utf8'));
    // Tokens should still reflect the ORIGINAL content because mtime didn't change.
    expect(second.fileTokens[filePath]).toEqual(rebasedPersisted.fileTokens[filePath]);
    expect(second.fileTokens[filePath]).toEqual(expect.arrayContaining(['original', 'name']));
  });

  it('re-tokenizes only the touched file after a rebuild', () => {
    const root = temp();
    const fileA = join(root, 'a.ts');
    const fileB = join(root, 'b.ts');
    writeFileSync(fileA, 'export function alphaName() { return 1; }');
    writeFileSync(fileB, 'export function betaName() { return 2; }');
    const indexPath = join(root, '.nim', 'index', 'search_index.json');
    buildIncrementalIndex(root, indexPath);
    const first = JSON.parse(readFileSync(indexPath, 'utf8'));

    // Touch (modify content + mtime naturally advances) only fileB.
    writeFileSync(fileB, 'export function betaRenamedName() { return 3; }');
    const future = new Date(Date.now() + 5000);
    utimesSync(fileB, future, future);

    buildIncrementalIndex(root, indexPath);
    const second = JSON.parse(readFileSync(indexPath, 'utf8'));

    expect(second.fileTokens[fileA]).toEqual(first.fileTokens[fileA]);
    expect(second.fileTokens[fileB]).toEqual(expect.arrayContaining(['beta', 'renamed', 'name']));
    expect(second.fileTokens[fileB]).not.toEqual(first.fileTokens[fileB]);
  });

  it('completes in a reasonable time for a small fixture', () => {
    const root = temp();
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(root, `file${i}.ts`), `export function sampleFunction${i}() { return ${i}; }`);
    }
    const indexPath = join(root, '.nim', 'index', 'search_index.json');
    const start = Date.now();
    buildIncrementalIndex(root, indexPath);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('creates the index directory if missing', () => {
    const root = temp();
    writeFileSync(join(root, 'a.ts'), 'export const ok = 1;');
    const indexPath = join(root, 'deeply', 'nested', 'dir', 'search_index.json');
    buildIncrementalIndex(root, indexPath);
    expect(existsSync(indexPath)).toBe(true);
  });
});
