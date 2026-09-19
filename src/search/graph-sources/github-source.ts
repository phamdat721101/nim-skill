/**
 * src/search/graph-sources/github-source.ts
 * ----------------------------------------------
 * Opt-in GitHub ingestion source. Fetches real PR metadata (author, updated
 * timestamp, URL) beyond what git-source.ts's commit-derived PR stand-ins
 * can offer. Same disabled/missing-credential two-stage gate.
 */

import type { GraphIngestionResult, GraphIngestionSource, GraphNode } from './types.js';

export interface GitHubSourceConfig {
  enabled: boolean;
  baseUrlEnv?: string;
  tokenEnv?: string;
  owner?: string;
  repo?: string;
}

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  user?: { login?: string };
}

export class GitHubSource implements GraphIngestionSource {
  name = 'github';

  constructor(private readonly config: GitHubSourceConfig) {}

  async ingest(): Promise<GraphIngestionResult> {
    if (!this.config.enabled) {
      return {
        nodes: [],
        edges: [],
        disabledReason: `github source disabled: set harness.search.graph.github.enabled=true and the ${this.config.tokenEnv ?? 'NIM_SEARCH_GITHUB_TOKEN'} env var to enable`,
      };
    }

    const tokenEnvName = this.config.tokenEnv ?? 'NIM_SEARCH_GITHUB_TOKEN';
    const token = process.env[tokenEnvName];
    if (!token) {
      return {
        nodes: [],
        edges: [],
        disabledReason: `github source enabled but missing credential: set process.env.${tokenEnvName}`,
      };
    }

    const baseUrl = this.config.baseUrlEnv ? process.env[this.config.baseUrlEnv] ?? 'https://api.github.com' : 'https://api.github.com';
    const owner = this.config.owner ?? 'owner';
    const repo = this.config.repo ?? 'repo';

    try {
      const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        return { nodes: [], edges: [], disabledReason: `github source request failed: HTTP ${response.status}` };
      }
      const body = (await response.json()) as GitHubPull[];
      const nodes: GraphNode[] = body.map((pull) => ({
        id: `github-pr::${owner}/${repo}#${pull.number}`,
        type: 'PR',
        name: `#${pull.number}: ${pull.title}${pull.user?.login ? ` (@${pull.user.login})` : ''}`,
        uri: pull.html_url,
        digestSha256: ''.padEnd(64, '0'),
        lastModified: pull.updated_at,
      }));
      return { nodes, edges: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { nodes: [], edges: [], disabledReason: `github source request failed: ${message}` };
    }
  }
}
