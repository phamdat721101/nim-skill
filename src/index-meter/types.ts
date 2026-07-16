/**
 * src/index-meter/types.ts
 * --------------------------
 * Shared shapes for nim-index. One source of truth so estimate.ts,
 * adapters.ts, volatility.ts, and index.ts never redeclare the same type.
 */

export interface ToolManifestEntry {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export type RiskBand = 'low-risk' | 'watch' | 'elevated-risk' | 'high-risk';

export interface DisclosureReport {
  toolCount: number;
  estimatedTokensPerTurn: number;
  estimatedTokensPerTask: number;
  riskBand: RiskBand;
  cacheFragileTools: string[];
  recommendation: string;
}

export interface IndexConfig {
  estimatedTurnsPerTask: number;
  riskThresholds?: { watch: number; elevated: number; high: number };
  mcpConfigPath: string;
  skillsDir: string;
}
