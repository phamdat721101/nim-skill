/**
 * src/search/graph-sources/git-source.ts
 * -----------------------------------------
 * Git-native ingestion source for the AS-SCP context graph. Shells out to
 * `git log` via `execFileSync` (never a shell-interpolated `exec`, to avoid
 * injection) and parses commits into Author/PR/CodeFile nodes plus
 * OWNED_BY/DISCUSSED_IN edges. There is no real PR API available without a
 * GitHub token, so each commit stands in for a PR node — labeled clearly as
 * commit-derived via its `name`/`uri`, while still using the schema's `PR`
 * type. Never throws: an unavailable git binary or a non-repo workspace
 * yields an empty result with a `disabledReason`.
 */

import { execFileSync } from 'node:child_process';
import type { GraphEdge, GraphIngestionResult, GraphIngestionSource, GraphNode } from './types.js';

const RECORD_SEPARATOR = '\u0001';
const FIELD_SEPARATOR = '\u0002';

interface ParsedCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  subject: string;
  files: string[];
}

function parseGitLog(raw: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  for (const record of raw.split(RECORD_SEPARATOR)) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const [header, ...fileLines] = trimmed.split('\n');
    const [hash, authorName, authorEmail, subject] = (header ?? '').split(FIELD_SEPARATOR);
    if (!hash) continue;
    const files = fileLines.map((line) => line.trim()).filter(Boolean);
    commits.push({ hash, authorName: authorName ?? 'unknown', authorEmail: authorEmail ?? 'unknown', subject: subject ?? '', files });
  }
  return commits;
}

export class GitSource implements GraphIngestionSource {
  name = 'git';

  constructor(private readonly workspaceRoot: string = process.cwd()) {}

  async ingest(): Promise<GraphIngestionResult> {
    let raw: string;
    try {
      raw = execFileSync(
        'git',
        ['log', `--pretty=format:${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%s`, '--name-only'],
        { cwd: this.workspaceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      return { nodes: [], edges: [], disabledReason: 'not a git repository or git unavailable' };
    }

    const commits = parseGitLog(raw);
    if (commits.length === 0) {
      return { nodes: [], edges: [], disabledReason: 'not a git repository or git unavailable' };
    }

    const nodesById = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const now = new Date().toISOString();

    for (const commit of commits) {
      const shortHash = commit.hash.slice(0, 7);
      const authorId = `author::${commit.authorEmail}`;
      const prId = `pr::${shortHash}`;

      if (!nodesById.has(authorId)) {
        nodesById.set(authorId, {
          id: authorId,
          type: 'Author',
          name: commit.authorName,
          uri: `mailto:${commit.authorEmail}`,
          digestSha256: ''.padEnd(64, '0'),
          lastModified: now,
        });
      }

      // PR node stands in for a real PR — there is no PR API without GitHub,
      // so this is explicitly a commit-derived node (name/uri make that clear).
      nodesById.set(prId, {
        id: prId,
        type: 'PR',
        name: `commit ${shortHash}: ${commit.subject}`,
        uri: `git-commit://${commit.hash}`,
        digestSha256: commit.hash.padEnd(64, '0').slice(0, 64),
        lastModified: now,
      });

      for (const filePath of commit.files) {
        const fileId = `file::${filePath}`;
        if (!nodesById.has(fileId)) {
          nodesById.set(fileId, {
            id: fileId,
            type: 'CodeFile',
            name: filePath,
            uri: `file://${filePath}`,
            digestSha256: ''.padEnd(64, '0'),
            lastModified: now,
          });
        }

        edges.push({
          sourceId: fileId,
          targetId: authorId,
          relationship: 'OWNED_BY',
          metadata: { confidence: 1, createdAt: now, gitCommit: commit.hash },
        });
        edges.push({
          sourceId: fileId,
          targetId: prId,
          relationship: 'DISCUSSED_IN',
          metadata: { confidence: 1, createdAt: now, gitCommit: commit.hash },
        });
      }
    }

    return { nodes: [...nodesById.values()], edges };
  }
}
