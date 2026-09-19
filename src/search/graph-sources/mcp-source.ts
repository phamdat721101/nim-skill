/**
 * src/search/graph-sources/mcp-source.ts
 * ------------------------------------------
 * Generic, MCP-backed ingestion source. Works for ANY configured server
 * name — it never hardcodes which MCP servers exist. The actual MCP call is
 * injected (`McpCallFn`) so this class is testable without a real MCP
 * transport.
 *
 * As of this implementation, no Jira/Slack/GitHub MCP server is configured
 * in this environment's ~/.kiro/settings/mcp.json (only notionApi and
 * hypermove) — so this adapter is unit-tested against a mock transport
 * only, and is NOT verified against a real live MCP server end-to-end.
 */

import type { GraphIngestionResult, GraphIngestionSource } from './types.js';

export type McpCallFn = (serverName: string, tool: string, args: unknown) => Promise<unknown>;

export interface McpSourceConfig {
  enabled: boolean;
  serverName: string | null;
}

function isIngestionResultShape(value: unknown): value is GraphIngestionResult {
  return !!value && typeof value === 'object' && Array.isArray((value as { nodes?: unknown }).nodes) && Array.isArray((value as { edges?: unknown }).edges);
}

export class McpSource implements GraphIngestionSource {
  name = 'mcp';

  constructor(
    private readonly config: McpSourceConfig,
    private readonly callFn: McpCallFn,
  ) {}

  async ingest(): Promise<GraphIngestionResult> {
    if (!this.config.enabled || !this.config.serverName) {
      return {
        nodes: [],
        edges: [],
        disabledReason: 'mcp source disabled: set harness.search.graph.mcp.enabled=true and serverName to a configured MCP server name to enable',
      };
    }

    try {
      const raw = await this.callFn(this.config.serverName, 'graph.ingest', {});
      if (!isIngestionResultShape(raw)) {
        return { nodes: [], edges: [], disabledReason: `mcp source request failed: unexpected response shape from server '${this.config.serverName}'` };
      }
      return { nodes: raw.nodes, edges: raw.edges };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { nodes: [], edges: [], disabledReason: `mcp source request failed: ${message}` };
    }
  }
}
