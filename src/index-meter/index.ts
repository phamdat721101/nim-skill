/**
 * src/index-meter/index.ts
 * --------------------------
 * `createIndexMeter(cfg)` — public factory. `measure()` reports; `trim()`
 * only ever runs behind an explicit `--write`+`--keep` at the CLI layer
 * (principle 7: never a silent rewrite) — this factory itself never writes
 * a file, it only returns the trimmed array for the caller to persist.
 */

import { estimate } from './estimate.js';
import { scanVolatility } from './volatility.js';
import type { ToolManifestEntry, DisclosureReport, IndexConfig } from './types.js';
export type { ToolManifestEntry, DisclosureReport, IndexConfig, RiskBand } from './types.js';

function recommendationFor(report: Pick<DisclosureReport, 'riskBand' | 'toolCount'>): string {
  switch (report.riskBand) {
    case 'low-risk':
      return 'tool surface is within the effectively-perfect selection-accuracy zone; no action needed';
    case 'watch':
      return 'accuracy begins to slip measurably past ~25 tools; monitor before adding more';
    case 'elevated-risk':
      return 'consider trimming below 25 disclosed tools per host session';
    case 'high-risk':
      return `${report.toolCount} tools is well past the ~107-tool collapse point; trim aggressively`;
  }
}

export function createIndexMeter(cfg: IndexConfig): {
  measure(manifest: ToolManifestEntry[]): DisclosureReport;
  trim(manifest: ToolManifestEntry[], opts: { keep: string[] }): ToolManifestEntry[];
} {
  return {
    measure(manifest: ToolManifestEntry[]): DisclosureReport {
      const base = estimate(manifest, { estimatedTurnsPerTask: cfg.estimatedTurnsPerTask, riskThresholds: cfg.riskThresholds });
      const cacheFragileTools = manifest.filter((e) => scanVolatility(e.description)).map((e) => e.name);
      return { ...base, cacheFragileTools, recommendation: recommendationFor(base) };
    },
    trim(manifest: ToolManifestEntry[], opts: { keep: string[] }): ToolManifestEntry[] {
      const keepSet = new Set(opts.keep);
      return manifest.filter((e) => keepSet.has(e.name)).sort((a, b) => opts.keep.indexOf(a.name) - opts.keep.indexOf(b.name));
    },
  };
}
