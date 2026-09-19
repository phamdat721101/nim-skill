/**
 * src/search/indexer.ts
 * ----------------------
 * Incremental, persistent BM25 index over a workspace's text files. Walks
 * the tree (skipping node_modules/.git/dist/build like src/architect/index.ts's
 * `walk()`), skips oversized/binary-looking files, tokenizes with the
 * identifier-aware `tokenizeIdentifier()`, and persists a JSON index keyed
 * by absolute file path so a re-run can skip re-tokenizing unchanged files
 * (compared by recorded mtime).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildCorpusStats, tokenizeIdentifier, type CorpusStats } from './bm25.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
const MAX_FILE_BYTES = 500 * 1024;
const MAX_AVG_LINE_LENGTH = 500;

export interface PersistedIndex {
  files: string[];
  fileTokens: Record<string, string[]>;
  fileMtimes: Record<string, number>;
  corpusStats: { docCount: number; avgDocLength: number; documentFrequency: Record<string, number> };
}

export interface IncrementalIndexResult {
  files: string[];
  corpusStats: CorpusStats;
  indexPath: string;
}

/**
 * Additive export (Task 7/AS-SCP) — the exact same directory walker
 * `buildIncrementalIndex()` already used internally, now reusable by
 * src/search/cli.ts's `graph`/`compile` subcommands so the node_modules/
 * .git/dist/build exclusion logic is never duplicated a third time. No
 * existing export's signature or behavior changes.
 */
export function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Binary-looking = contains a null byte or fails to decode as valid UTF-8. */
function looksBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const decoded = buffer.toString('utf8');
  // Re-encoding a valid UTF-8 decode must round-trip byte-for-byte;
  // a mismatch signals the original bytes were not valid UTF-8.
  return !Buffer.from(decoded, 'utf8').equals(buffer);
}

/**
 * Additive export (Task 7/AS-SCP) — same oversized/binary-content exclusion
 * `buildIncrementalIndex()` already applies per-file, reusable by cli.ts's
 * graph/compile symbol-extraction walk so that logic is never duplicated.
 */
export function shouldSkip(filePath: string): { skip: boolean; content?: string } {
  const stat = statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) return { skip: true };
  const buffer = readFileSync(filePath);
  if (looksBinary(buffer)) return { skip: true };
  const content = buffer.toString('utf8');
  const lines = content.split('\n');
  const avgLineLength = lines.length ? content.length / lines.length : 0;
  if (avgLineLength > MAX_AVG_LINE_LENGTH) return { skip: true };
  return { skip: false, content };
}

function loadExisting(indexPath: string): PersistedIndex | null {
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as PersistedIndex;
  } catch {
    return null;
  }
}

/**
 * Build or refresh a persistent BM25 index for `workspaceRoot`. Files whose
 * mtime matches the previously recorded value reuse their stored tokens
 * instead of being re-read/re-tokenized.
 */
export function buildIncrementalIndex(
  workspaceRoot: string,
  indexPath = join(workspaceRoot, '.nim', 'index', 'search_index.json'),
): IncrementalIndexResult {
  const existing = loadExisting(indexPath);
  const candidateFiles = walk(workspaceRoot).filter((filePath) => filePath !== indexPath);

  const fileTokens: Record<string, string[]> = {};
  const fileMtimes: Record<string, number> = {};
  const files: string[] = [];

  for (const filePath of candidateFiles) {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const mtimeMs = stat.mtimeMs;
    const previousMtime = existing?.fileMtimes[filePath];
    const previousTokens = existing?.fileTokens[filePath];

    if (previousMtime !== undefined && previousMtime === mtimeMs && previousTokens) {
      files.push(filePath);
      fileTokens[filePath] = previousTokens;
      fileMtimes[filePath] = mtimeMs;
      continue;
    }

    let result;
    try {
      result = shouldSkip(filePath);
    } catch {
      continue;
    }
    if (result.skip || result.content === undefined) continue;

    files.push(filePath);
    fileTokens[filePath] = tokenizeIdentifier(result.content);
    fileMtimes[filePath] = mtimeMs;
  }

  const docs = files.map((filePath) => fileTokens[filePath] ?? []);
  const corpusStats = buildCorpusStats(docs);

  const persisted: PersistedIndex = {
    files,
    fileTokens,
    fileMtimes,
    corpusStats: {
      docCount: corpusStats.docCount,
      avgDocLength: corpusStats.avgDocLength,
      documentFrequency: Object.fromEntries(corpusStats.documentFrequency),
    },
  };

  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, JSON.stringify(persisted, null, 2), 'utf8');

  return { files, corpusStats, indexPath };
}
