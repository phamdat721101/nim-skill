/**
 * src/cache/index.ts
 * ------------------
 * C2 — the cache-aware assembler + the `ctx.cache` helper.
 *
 * Lever 1 (helps EVERY provider): order stable content first as a reusable
 * prefix, variable input last. Lever 2 (explicit only): emit the provider's
 * cache marker on the last static block — but only when the static prefix
 * clears the provider's min-token floor.
 *
 * `null` config ⇒ a no-op helper: assemble = plain concat, record = no-op —
 * byte-identical to a bare run (rollback contract).
 */

import type { ResolvedCache } from '../config.js';
import type { CacheBlock, CacheHelper, CacheAssembleMeta } from '../harness/types.js';
import { estimateTokensOf } from '../tokens.js';
import { pickAdapter, parseUsage, type ParsedUsage, type CacheAdapter } from './adapters.js';

export { computeRoi } from './roi.js';
export { pickAdapter, parseUsage } from './adapters.js';

/** The runtime needs the recorded usage back; CacheHelper stays {assemble, record}. */
export interface CacheHelperHandle {
  helper: CacheHelper;
  getRecorded(): ParsedUsage | null;
}

function staticTokens(blocks: CacheBlock[]): number {
  return blocks.reduce((sum, b) => sum + estimateTokensOf(b.text), 0);
}

class ActiveCache implements CacheHelper {
  private recorded: ParsedUsage | null = null;

  constructor(
    private readonly cfg: ResolvedCache,
    private readonly adapter: CacheAdapter,
  ) {}

  assemble(staticBlocks: CacheBlock[], dynamicBlocks: CacheBlock[]): { payload: CacheBlock[]; meta: CacheAssembleMeta } {
    const est = staticTokens(staticBlocks);
    const belowMinTokens = est < this.cfg.minTokens;
    const explicit = this.cfg.strategy === 'explicit' && this.adapter.explicit && !belowMinTokens;
    const payload = this.adapter.shape(staticBlocks, dynamicBlocks, { ttl: this.cfg.ttl, explicit });
    return {
      payload,
      meta: {
        provider: this.adapter.id,
        strategy: this.cfg.strategy,
        staticTokensEstimate: est,
        belowMinTokens,
        markersApplied: explicit,
      },
    };
  }

  record(usage: Record<string, unknown>): void {
    this.recorded = this.adapter.parseUsage(usage);
  }

  getRecorded(): ParsedUsage | null {
    return this.recorded;
  }
}

class DisabledCache implements CacheHelper {
  assemble(staticBlocks: CacheBlock[], dynamicBlocks: CacheBlock[]): { payload: CacheBlock[]; meta: CacheAssembleMeta } {
    return {
      payload: [...staticBlocks, ...dynamicBlocks],
      meta: { provider: 'none', strategy: 'prefix', staticTokensEstimate: 0, belowMinTokens: false, markersApplied: false },
    };
  }
  record(): void {}
}

/**
 * Build the cache helper handle from resolved config. `null` ⇒ disabled (no-op).
 * `hint` (base-url/model) drives `provider:'auto'` adapter detection.
 */
export function createCacheHelper(
  cfg: ResolvedCache | null,
  hint: { baseUrl?: string; model?: string } = {},
): CacheHelperHandle {
  if (!cfg) {
    const helper = new DisabledCache();
    return { helper, getRecorded: () => null };
  }
  const adapter = pickAdapter(cfg.provider, hint);
  const active = new ActiveCache(cfg, adapter);
  return { helper: active, getRecorded: () => active.getRecorded() };
}

// Re-export usage parser type for consumers.
export type { ParsedUsage } from './adapters.js';
