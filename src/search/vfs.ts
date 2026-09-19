/**
 * src/search/vfs.ts
 * ------------------
 * Dynamic VFS SERP (Search-Engine-Results-Page) mount engine. Materializes
 * a search result set as an on-disk, LRU+TTL-bounded folder under
 * `.nim/search_serp/{query_hash}/` so downstream tools (agents, editors) can
 * read a stable snapshot instead of re-querying — and "hydrate" individual
 * snippet nodes into standalone files for direct inspection/opening.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface SerpCandidate {
  entity_id: string;
  entity_type: string;
  title: string;
  uri: string;
  gist: string;
  score: number;
}

export interface MountSerpResult {
  query_hash: string;
  serp_dir: string;
  manifest_path: string;
  candidates_tsv_path: string;
}

export interface HydrateSnippet {
  nodeId: string;
  uri: string;
  snippet: string;
}

/** Filesystem-safe slug for a node id used as part of a hydrated filename. */
function sanitizeNodeId(nodeId: string): string {
  return nodeId.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
}

export class VfsSerpManager {
  private readonly serpRoot: string;

  constructor(
    private readonly workspaceRoot: string = process.cwd(),
    private readonly maxFolders: number = 20,
    private readonly ttlHours: number = 24,
  ) {
    this.serpRoot = join(this.workspaceRoot, '.nim', 'search_serp');
  }

  private listFolders(): Array<{ name: string; path: string; mtimeMs: number }> {
    if (!existsSync(this.serpRoot)) return [];
    return readdirSync(this.serpRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const path = join(this.serpRoot, entry.name);
        return { name: entry.name, path, mtimeMs: statSync(path).mtimeMs };
      });
  }

  /** LRU (by mtime) + TTL eviction, run BEFORE a new folder is written. */
  private evict(): void {
    const folders = this.listFolders();
    const ttlMs = this.ttlHours * 60 * 60 * 1000;
    const now = Date.now();

    for (const folder of folders) {
      if (now - folder.mtimeMs > ttlMs) {
        rmSync(folder.path, { recursive: true, force: true });
      }
    }

    const remaining = this.listFolders().sort((a, b) => a.mtimeMs - b.mtimeMs);
    // Reserve room for the ONE folder about to be written.
    const overflow = remaining.length - (this.maxFolders - 1);
    for (let i = 0; i < overflow; i++) {
      rmSync(remaining[i]!.path, { recursive: true, force: true });
    }
  }

  mountSerp(intent: string, candidates: SerpCandidate[]): MountSerpResult {
    if (this.maxFolders > 0) this.evict();

    const query_hash = `q_${createHash('sha256').update(intent).digest('hex').slice(0, 8)}`;
    const serp_dir = join(this.serpRoot, query_hash);
    mkdirSync(serp_dir, { recursive: true });

    const manifest_path = join(serp_dir, 'manifest.json');
    const manifest = {
      query_hash,
      intent,
      created_at: new Date().toISOString(),
      candidate_count: candidates.length,
    };
    writeFileSync(manifest_path, JSON.stringify(manifest, null, 2), 'utf8');

    const candidates_tsv_path = join(serp_dir, 'candidates.tsv');
    const header = 'SCORE\tENTITY_ID\tTYPE\tURI\tGIST';
    const rows = candidates.map(
      (c) => `${c.score}\t${c.entity_id}\t${c.entity_type}\t${c.uri}\t${c.gist.replace(/\t/g, ' ')}`,
    );
    writeFileSync(candidates_tsv_path, [header, ...rows].join('\n') + '\n', 'utf8');

    return { query_hash, serp_dir, manifest_path, candidates_tsv_path };
  }

  hydrateSnippets(queryHash: string, snippets: HydrateSnippet[]): string {
    const serp_dir = join(this.serpRoot, queryHash);
    const hydrated_dir = join(serp_dir, 'hydrated');
    mkdirSync(hydrated_dir, { recursive: true });

    for (const snippet of snippets) {
      const fileName = `${sanitizeNodeId(snippet.nodeId)}.snippet.ts`;
      const filePath = join(hydrated_dir, fileName);
      const content = `// Source: ${snippet.uri}\n// Node: ${snippet.nodeId}\n\n${snippet.snippet}\n`;
      writeFileSync(filePath, content, 'utf8');
    }

    return hydrated_dir;
  }
}

/** Re-export for callers that only need the manifest shape read back off disk. */
export function readManifest(manifestPath: string): { query_hash: string; intent: string; created_at: string; candidate_count: number } {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}
