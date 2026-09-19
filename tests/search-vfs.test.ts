import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync, statSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VfsSerpManager } from '../src/search/vfs.js';

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nim-search-vfs-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const candidate = (i: number) => ({
  entity_id: `entity-${i}`,
  entity_type: 'Symbol',
  title: `Title ${i}`,
  uri: `file:///a${i}.ts`,
  gist: `gist ${i}`,
  score: i,
});

describe('VfsSerpManager.mountSerp', () => {
  it('writes a manifest.json and candidates.tsv for a mounted SERP', () => {
    const root = temp();
    const manager = new VfsSerpManager(root, 20, 24);
    const result = manager.mountSerp('find payment rail', [candidate(1), candidate(2)]);

    expect(existsSync(result.manifest_path)).toBe(true);
    expect(existsSync(result.candidates_tsv_path)).toBe(true);
    expect(result.query_hash).toMatch(/^q_[a-f0-9]{8}$/);

    const manifest = JSON.parse(readFileSync(result.manifest_path, 'utf8'));
    expect(manifest.query_hash).toBe(result.query_hash);
    expect(manifest.intent).toBe('find payment rail');
    expect(manifest.candidate_count).toBe(2);
    expect(typeof manifest.created_at).toBe('string');
    expect(new Date(manifest.created_at).toString()).not.toBe('Invalid Date');

    const tsv = readFileSync(result.candidates_tsv_path, 'utf8');
    const lines = tsv.trim().split('\n');
    expect(lines[0]).toBe('SCORE\tENTITY_ID\tTYPE\tURI\tGIST');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('entity-1');
  });

  it('evicts the oldest folder (LRU by mtime) once maxFolders would be exceeded', () => {
    const root = temp();
    const manager = new VfsSerpManager(root, 3, 24);
    const serpDir = join(root, '.nim', 'search_serp');

    const mounted: string[] = [];
    for (let i = 0; i < 4; i++) {
      const result = manager.mountSerp(`intent-${i}`, [candidate(i)]);
      mounted.push(result.serp_dir);
      // Ensure distinct mtimes across mounts for a deterministic LRU order.
      const past = new Date(Date.now() - (4 - i) * 10_000);
      utimesSync(result.serp_dir, past, past);
    }
    // Re-touch all EXCEPT the desired-oldest to guarantee ordering, then mount once more.
    const finalResult = manager.mountSerp('intent-final', [candidate(99)]);
    mounted.push(finalResult.serp_dir);

    const remaining = readdirSync(serpDir);
    expect(remaining).toHaveLength(3);
    expect(existsSync(finalResult.serp_dir)).toBe(true);
    // The very first mounted folder (oldest) must be gone.
    expect(existsSync(mounted[0]!)).toBe(false);
  });

  it('evicts a folder older than ttlHours even when folder count is under maxFolders', () => {
    const root = temp();
    const manager = new VfsSerpManager(root, 20, 1); // ttl = 1 hour
    const stale = manager.mountSerp('stale-intent', [candidate(1)]);

    // Backdate the stale folder's mtime to 2 hours ago (past the 1h TTL).
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(stale.serp_dir, twoHoursAgo, twoHoursAgo);

    const fresh = manager.mountSerp('fresh-intent', [candidate(2)]);

    expect(existsSync(stale.serp_dir)).toBe(false);
    expect(existsSync(fresh.serp_dir)).toBe(true);
  });
});

describe('VfsSerpManager.hydrateSnippets', () => {
  it('writes hydrated snippet files with source/node header comments and returns the hydrated dir', () => {
    const root = temp();
    const manager = new VfsSerpManager(root, 20, 24);
    const mounted = manager.mountSerp('hydrate test', [candidate(1)]);

    const hydratedDir = manager.hydrateSnippets(mounted.query_hash, [
      { nodeId: 'sym::getUserName', uri: 'file:///src/a.ts#L10', snippet: 'export function getUserName() {}' },
    ]);

    expect(existsSync(hydratedDir)).toBe(true);
    const files = readdirSync(hydratedDir);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(hydratedDir, files[0]!), 'utf8');
    expect(content).toContain('// Source: file:///src/a.ts#L10');
    expect(content).toContain('// Node: sym::getUserName');
    expect(content).toContain('export function getUserName() {}');
  });

  it('sanitizes nodeId into a safe filename', () => {
    const root = temp();
    const manager = new VfsSerpManager(root, 20, 24);
    const mounted = manager.mountSerp('sanitize test', [candidate(1)]);
    const hydratedDir = manager.hydrateSnippets(mounted.query_hash, [
      { nodeId: 'sym::a/b::weird name!', uri: 'file:///x.ts', snippet: 'const x = 1;' },
    ]);
    const files = readdirSync(hydratedDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.snippet\.ts$/);
    expect(files[0]).not.toMatch(/[/\\!]/);
  });
});
