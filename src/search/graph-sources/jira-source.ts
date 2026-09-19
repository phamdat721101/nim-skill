/**
 * src/search/graph-sources/jira-source.ts
 * ------------------------------------------
 * Opt-in Jira ingestion source. No network call at all unless BOTH
 * `enabled: true` AND the configured token env var is set — matches every
 * other opt-in graph source in this directory (same disabled/missing-cred
 * two-stage gate). Secrets are never embedded in config; only the env-var
 * NAME is configured, the value is read from `process.env` at call time
 * (same precedent as `process.env.NIM_TRACE_FILE`/`NIM_MEMORY_FILE` in
 * src/config.ts).
 */

import type { GraphIngestionResult, GraphIngestionSource, GraphNode } from './types.js';

export interface JiraSourceConfig {
  enabled: boolean;
  baseUrlEnv?: string;
  tokenEnv?: string;
}

interface JiraIssue {
  key: string;
  fields?: { summary?: string; updated?: string };
}

export class JiraSource implements GraphIngestionSource {
  name = 'jira';

  constructor(private readonly config: JiraSourceConfig) {}

  async ingest(): Promise<GraphIngestionResult> {
    if (!this.config.enabled) {
      return {
        nodes: [],
        edges: [],
        disabledReason: `jira source disabled: set harness.search.graph.jira.enabled=true and the ${this.config.tokenEnv ?? 'NIM_SEARCH_JIRA_TOKEN'} env var to enable`,
      };
    }

    const tokenEnvName = this.config.tokenEnv ?? 'NIM_SEARCH_JIRA_TOKEN';
    const baseUrlEnvName = this.config.baseUrlEnv ?? 'NIM_SEARCH_JIRA_BASE_URL';
    const token = process.env[tokenEnvName];
    const baseUrl = process.env[baseUrlEnvName];
    if (!token || !baseUrl) {
      return {
        nodes: [],
        edges: [],
        disabledReason: `jira source enabled but missing credential: set process.env.${tokenEnvName}${!baseUrl ? ` and process.env.${baseUrlEnvName}` : ''}`,
      };
    }

    try {
      const response = await fetch(`${baseUrl}/rest/api/2/search?jql=order+by+updated+desc`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        return { nodes: [], edges: [], disabledReason: `jira source request failed: HTTP ${response.status}` };
      }
      const body = (await response.json()) as { issues?: JiraIssue[] };
      const now = new Date().toISOString();
      const nodes: GraphNode[] = (body.issues ?? []).map((issue) => ({
        id: `jira::${issue.key}`,
        type: 'JiraIssue',
        name: `${issue.key}: ${issue.fields?.summary ?? ''}`,
        uri: `${baseUrl}/browse/${issue.key}`,
        digestSha256: ''.padEnd(64, '0'),
        lastModified: issue.fields?.updated ?? now,
      }));
      return { nodes, edges: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { nodes: [], edges: [], disabledReason: `jira source request failed: ${message}` };
    }
  }
}
