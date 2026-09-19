/**
 * src/search/graph-sources/types.ts
 * -----------------------------------
 * Shared node/edge/ingestion-source contracts for the AS-SCP relational
 * context graph. Data-only (serializable) — a `GraphIngestionSource` never
 * throws; a source that is intentionally inactive (disabled config, missing
 * credential, not a git repo, etc.) returns an empty result with a
 * `disabledReason` explaining why, so callers can distinguish "ran and found
 * nothing" (no `disabledReason`) from "never ran" (has one).
 */

export type GraphNodeType = 'CodeFile' | 'Symbol' | 'PR' | 'JiraIssue' | 'SlackDiscussion' | 'Author';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  name: string;
  uri: string;
  digestSha256: string;
  lastModified: string;
  astMetadata?: {
    kind: string;
    lineStart: number;
    lineEnd: number;
    isExported: boolean;
  };
}

export type GraphRelationship = 'IMPLEMENTS' | 'CALLS' | 'DEPENDS_ON' | 'SUPERSEDES' | 'DISCUSSED_IN' | 'OWNED_BY';

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  relationship: GraphRelationship;
  metadata?: {
    confidence: number;
    createdAt: string;
    gitCommit?: string;
  };
}

export interface GraphIngestionResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Present only when the source did NOT genuinely run (disabled, missing config/credential, environment unavailable). Absent when it ran and simply found nothing. */
  disabledReason?: string;
}

export interface GraphIngestionSource {
  name: string;
  ingest(): Promise<GraphIngestionResult>;
}
