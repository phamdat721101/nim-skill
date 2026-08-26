/**
 * src/cli/commands/monitor.ts
 * -----------------------------
 * v0.16 `nim-throttle` Pillar 4 — `nim-skill monitor --tokens` (PRD 27 Task
 * 4.2). Thin CLI-facing wrapper around `summarizeTokens()` (the actual
 * aggregation logic lives in `src/monitor/dashboard.ts`, reusing its
 * existing render/parse helpers per the confirmed plan — this file only
 * owns the CLI-option-to-view mapping, matching PRD 27's literal specified
 * path for the dashboard command module).
 */

import { renderDashboard } from '../../monitor/dashboard.js';

export interface MonitorTokensOptions {
  file: string;
}

/** Render the token-burn dashboard view for a given trace file path. */
export function renderTokensDashboard(opts: MonitorTokensOptions): string {
  return renderDashboard(opts.file, 'tokens');
}
