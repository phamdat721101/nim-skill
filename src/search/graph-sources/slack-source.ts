/**
 * src/search/graph-sources/slack-source.ts
 * --------------------------------------------
 * Opt-in Slack ingestion source. Same disabled/missing-credential two-stage
 * gate as jira-source.ts/github-source.ts — no network call unless enabled
 * AND the configured token env var is set.
 */

import type { GraphIngestionResult, GraphIngestionSource, GraphNode } from './types.js';

export interface SlackSourceConfig {
  enabled: boolean;
  baseUrlEnv?: string;
  tokenEnv?: string;
  /** Slack conversation/channel id to read history from. */
  channelId?: string;
}

interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
}

export class SlackSource implements GraphIngestionSource {
  name = 'slack';

  constructor(private readonly config: SlackSourceConfig) {}

  async ingest(): Promise<GraphIngestionResult> {
    if (!this.config.enabled) {
      return {
        nodes: [],
        edges: [],
        disabledReason: `slack source disabled: set harness.search.graph.slack.enabled=true and the ${this.config.tokenEnv ?? 'NIM_SEARCH_SLACK_TOKEN'} env var to enable`,
      };
    }

    const tokenEnvName = this.config.tokenEnv ?? 'NIM_SEARCH_SLACK_TOKEN';
    const token = process.env[tokenEnvName];
    if (!token) {
      return {
        nodes: [],
        edges: [],
        disabledReason: `slack source enabled but missing credential: set process.env.${tokenEnvName}`,
      };
    }

    const baseUrl = this.config.baseUrlEnv ? process.env[this.config.baseUrlEnv] ?? 'https://slack.com/api' : 'https://slack.com/api';
    const channel = this.config.channelId ?? 'general';

    try {
      const response = await fetch(`${baseUrl}/conversations.history?channel=${encodeURIComponent(channel)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        return { nodes: [], edges: [], disabledReason: `slack source request failed: HTTP ${response.status}` };
      }
      const body = (await response.json()) as { messages?: SlackMessage[] };
      const now = new Date().toISOString();
      const nodes: GraphNode[] = (body.messages ?? []).map((message) => ({
        id: `slack::${channel}::${message.ts}`,
        type: 'SlackDiscussion',
        name: (message.text ?? '').slice(0, 80),
        uri: `slack://${channel}/${message.ts}`,
        digestSha256: ''.padEnd(64, '0'),
        lastModified: now,
      }));
      return { nodes, edges: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { nodes: [], edges: [], disabledReason: `slack source request failed: ${message}` };
    }
  }
}
