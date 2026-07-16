/**
 * src/index-meter/estimate.ts
 * -----------------------------
 * Token/risk-band estimator. Reuses `estimateTokensOf` from src/tokens.ts
 * verbatim — no new estimator (measure, don't guess). The risk-band table is
 * a cited lookup, not a fitted curve (tianpan.co, 2026-05-13) — labeled as an
 * estimate throughout, same honesty discipline as nim-cache's dollar figures.
 */

import { estimateTokensOf } from '../tokens.js';
import type { ToolManifestEntry, RiskBand, DisclosureReport } from './types.js';

const DEFAULT_THRESHOLDS = { watch: 21, elevated: 26, high: 101 };

/** Look up the accuracy-risk band for a disclosed tool count. Cited zones, not a formula. */
export function riskBandFor(toolCount: number, thresholds = DEFAULT_THRESHOLDS): RiskBand {
  if (toolCount >= thresholds.high) return 'high-risk';
  if (toolCount >= thresholds.elevated) return 'elevated-risk';
  if (toolCount >= thresholds.watch) return 'watch';
  return 'low-risk';
}

/** Estimate the standing disclosure-tax cost of a tool manifest. */
export function estimate(
  entries: ToolManifestEntry[],
  cfg: { estimatedTurnsPerTask: number; riskThresholds?: typeof DEFAULT_THRESHOLDS },
): Omit<DisclosureReport, 'cacheFragileTools' | 'recommendation'> {
  const toolCount = entries.length;
  const estimatedTokensPerTurn = entries.reduce(
    (sum, e) => sum + estimateTokensOf({ name: e.name, description: e.description, inputSchema: e.inputSchema }),
    0,
  );
  const riskBand = riskBandFor(toolCount, cfg.riskThresholds ?? DEFAULT_THRESHOLDS);
  return {
    toolCount,
    estimatedTokensPerTurn,
    estimatedTokensPerTask: estimatedTokensPerTurn * cfg.estimatedTurnsPerTask,
    riskBand,
  };
}
