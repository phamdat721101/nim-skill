/**
 * src/search/graph-sources/config-types.ts
 * --------------------------------------------
 * Shape-only config for the AS-SCP context-graph ingestion sources, resolved
 * independently of `harness.search`'s existing `SearchConfig` (which stays
 * untouched per src/search/types.ts's "do not mutate" contract). Every
 * credential-bearing field here is an env-var NAME (a string), never a
 * secret literal — matches src/config.ts's existing `process.env.NIM_*`
 * precedent.
 */

export interface GitSourceConfig {
  enabled: boolean;
}

export interface JiraGraphSourceConfig {
  enabled: boolean;
  baseUrlEnv: string;
  tokenEnv: string;
}

export interface SlackGraphSourceConfig {
  enabled: boolean;
  baseUrlEnv: string;
  tokenEnv: string;
}

export interface GitHubGraphSourceConfig {
  enabled: boolean;
  baseUrlEnv: string;
  tokenEnv: string;
}

export interface McpGraphSourceConfig {
  enabled: boolean;
  serverName: string | null;
}

export interface ResolvedGraphSourcesConfig {
  git: GitSourceConfig;
  jira: JiraGraphSourceConfig;
  slack: SlackGraphSourceConfig;
  github: GitHubGraphSourceConfig;
  mcp: McpGraphSourceConfig;
}
