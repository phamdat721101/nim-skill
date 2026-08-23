import { readFileSync } from 'node:fs';
import { buildCorpusStats, scoreBm25, tokenize } from './bm25.js';
import { chunkMarkdown } from './chunk.js';
import type { MemoryChunk, SearchConfig, SearchHelper, SearchOpts, SearchResultEntry } from './types.js';

export function createSearchHelper(cfg: SearchConfig = {}): SearchHelper {
  const search = (query: string, chunks: MemoryChunk[], opts: SearchOpts = {}): SearchResultEntry[] => {
    const queryTokens = tokenize(query);
    const docs = chunks.map((chunk) => tokenize(chunk.text));
    const stats = buildCorpusStats(docs);
    const minScore = opts.minScore ?? cfg.minScore ?? 0;
    const topK = opts.topK ?? cfg.topK ?? 5;
    return chunks.map((chunk, index) => ({ ...chunk, score: scoreBm25(queryTokens, docs[index] ?? [], stats) }))
      .filter((entry) => entry.score >= minScore && entry.score > 0)
      .sort((a, b) => b.score - a.score || a.sourcePath.localeCompare(b.sourcePath))
      .slice(0, topK)
      .map(({ sourcePath, headerPath, text, score }) => ({ sourcePath, headerPath, text, score }));
  };
  return { search, searchFiles: (query, filePaths, opts) => search(query, filePaths.flatMap((path) => chunkMarkdown(path, readFileSync(path, 'utf8'))), opts) };
}

export { chunkMarkdown } from './chunk.js';
export { scoreBm25 } from './bm25.js';
export type { MemoryChunk, SearchConfig, SearchHelper, SearchOpts, SearchResultEntry, SearchTrace } from './types.js';
