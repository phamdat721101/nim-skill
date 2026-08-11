/**
 * src/logcompact/index.ts
 * -------------------------
 * Public factory — mirrors createIndexMeter(cfg)'s shape. Wraps the pure
 * compact() dispatcher with char-count + reduction% reporting so callers
 * (cli.ts, ctx.logCompact, the dashboard) never re-derive that arithmetic.
 */

import { compact } from './compact.js';
import type { CompactResult, LogCompactConfig, LogCompactHelper } from './types.js';

function pctReduction(originalChars: number, compactedChars: number): number {
  if (originalChars === 0) return 0;
  const pct = ((originalChars - compactedChars) / originalChars) * 100;
  return Math.max(0, Math.round(pct));
}

export function createLogCompactHelper(cfg: LogCompactConfig): LogCompactHelper {
  return {
    compact(raw: string): CompactResult {
      const text = compact(raw, cfg);
      const originalChars = raw.length;
      const compactedChars = text.length;
      return { text, originalChars, compactedChars, reductionPct: pctReduction(originalChars, compactedChars) };
    },
  };
}

export type { CompactResult, CompactStrategy, LogCompactConfig, LogCompactHelper } from './types.js';
