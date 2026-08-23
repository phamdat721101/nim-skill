/**
 * src/logcompact/index.ts
 * -------------------------
 * Public factory — mirrors createIndexMeter(cfg)'s shape. Wraps the pure
 * compact() dispatcher with char-count + reduction% reporting so callers
 * (cli.ts, ctx.logCompact, the dashboard) never re-derive that arithmetic.
 */

import { compact } from './compact.js';
import type { CompactResult, LogCompactConfig, LogCompactHelper } from './types.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../security/content-hash.js';

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
      let artifactUri: string | undefined;
      if (cfg.artifactDir && compactedChars < originalChars) {
        const hash = sha256(raw).slice(0, 32);
        try {
          mkdirSync(cfg.artifactDir, { recursive: true });
          const path = join(cfg.artifactDir, `${hash}.log`);
          if (!existsSync(path)) writeFileSync(path, raw, 'utf8');
          artifactUri = `artifact://${hash}`;
        } catch { /* artifact persistence is best-effort, like every local store */ }
      }
      return { text, originalChars, compactedChars, reductionPct: pctReduction(originalChars, compactedChars), ...(artifactUri ? { artifactUri } : {}) };
    },
  };
}

export type { CompactResult, CompactStrategy, LogCompactConfig, LogCompactHelper } from './types.js';
