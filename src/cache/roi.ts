/**
 * src/cache/roi.ts
 * ----------------
 * C4 — cache-ROI meter. Turns a provider's cache-usage numbers into tokens +
 * dollars saved, a hit-rate, and an honest break-even flag.
 *
 * Break-even trap (tianpan): an explicit cache WRITE costs a premium; below
 * ~2 reads per write within the TTL you LOSE money. `breakEvenOk=false` surfaces
 * exactly that. Prices are ESTIMATES ($/token), labeled approximate and
 * user-overridable via `nim.json` `cache.prices`.
 */

import type { CacheProvider, CacheTrace } from '../harness/types.js';
import type { ParsedUsage } from './adapters.js';

export interface Price {
  base: number;
  cachedRead: number;
  cachedWrite: number;
}

/** Approximate default $/token prices. Illustrative — override in nim.json. */
const DEFAULT_PRICES: Record<string, Price> = {
  anthropic: { base: 3e-6, cachedRead: 0.3e-6, cachedWrite: 3.75e-6 },
  minimax: { base: 3e-6, cachedRead: 0.3e-6, cachedWrite: 3.75e-6 },
  openai: { base: 2.5e-6, cachedRead: 0.25e-6, cachedWrite: 2.5e-6 },
  gemini: { base: 1.25e-6, cachedRead: 0.125e-6, cachedWrite: 1.5e-6 },
  qwen: { base: 1e-6, cachedRead: 0.1e-6, cachedWrite: 1.25e-6 },
  glm: { base: 1e-6, cachedRead: 0.5e-6, cachedWrite: 1e-6 },
  deepseek: { base: 1e-6, cachedRead: 0.1e-6, cachedWrite: 1e-6 },
};

const GENERIC: Price = { base: 1e-6, cachedRead: 0.1e-6, cachedWrite: 1e-6 };

function priceFor(provider: string, overrides: Record<string, { base: number; cachedRead: number }>): Price {
  const base = DEFAULT_PRICES[provider] ?? GENERIC;
  const o = overrides[provider];
  return o ? { ...base, base: o.base, cachedRead: o.cachedRead } : base;
}

export interface RoiOpts {
  provider: CacheProvider;
  strategy: 'prefix' | 'explicit';
  breakEvenReads: number;
  prices: Record<string, { base: number; cachedRead: number }>;
}

export function computeRoi(usage: ParsedUsage, opts: RoiOpts): CacheTrace {
  const p = priceFor(opts.provider, opts.prices);
  const { readTokens, writeTokens, cachedTokens } = usage;

  // Reads served from cache saved (base − cachedRead)/token; writes cost the premium.
  const savedOnReads = readTokens * (p.base - p.cachedRead);
  const extraOnWrites = writeTokens * (p.cachedWrite - p.base);
  const dollarsSaved = Number((savedOnReads - extraOnWrites).toFixed(8));

  const denom = readTokens + writeTokens;
  const hitRate = denom === 0 ? 0 : Number((readTokens / denom).toFixed(4));
  const breakEvenOk = writeTokens === 0 ? readTokens > 0 : readTokens / writeTokens >= opts.breakEvenReads;

  return {
    provider: opts.provider,
    strategy: opts.strategy,
    cachedTokens,
    writeTokens,
    readTokens,
    tokensSaved: readTokens, // tokens served from cache instead of re-prefilled
    dollarsSaved,
    hitRate,
    breakEvenOk,
  };
}
