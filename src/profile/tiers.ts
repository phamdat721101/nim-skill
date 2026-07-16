/**
 * src/profile/tiers.ts
 * ----------------------
 * The 3 built-in tier -> HarnessConfig-delta pure functions
 * (docs/prd/09-nim-profile.md §3, reproduced exactly in
 * docs/prd/12-final-prd-v04.md §6 P4-12's worked example). Never-loosen
 * invariant: every delta only ever tightens relative to what the caller's
 * own config already declares; frontier is always a byte-identical no-op.
 */

import type { HarnessConfig, EnforceMode } from '../harness/types.js';

export type ModelTier = 'frontier' | 'open-weight-verified' | 'open-weight-untested';

/** Rank so we only ever move mode "up" (never|off < warn < strict), never down. */
const MODE_RANK: Record<EnforceMode, number> = { off: 0, warn: 1, strict: 2 };

function tighterMode(current: EnforceMode | undefined, floor: EnforceMode): EnforceMode | undefined {
  if (current === undefined) return undefined; // absent stays absent — resolveConfig() owns its own default
  return MODE_RANK[current] >= MODE_RANK[floor] ? current : floor;
}

/** `frontier` — no change. Exists so the tier table is complete and explicit. */
function frontier(harness: HarnessConfig): HarnessConfig {
  return harness;
}

/** `open-weight-verified` — enforcer.maxHeals floor raised by +1 over whatever is declared. */
function openWeightVerified(harness: HarnessConfig): HarnessConfig {
  if (!harness.enforcer) return harness;
  return { ...harness, enforcer: { ...harness.enforcer, maxHeals: (harness.enforcer.maxHeals ?? 3) + 1 } };
}

/**
 * `open-weight-untested` — enforcer.mode forced to at least 'strict' (never
 * loosens 'strict'->something weaker); guard.injection forced to 'strict' if
 * declared 'off'; circuitBreaker.failN lowered by 1 (trip sooner).
 */
function openWeightUntested(harness: HarnessConfig): HarnessConfig {
  const next: HarnessConfig = { ...harness };

  if (next.enforcer) {
    const mode = tighterMode(next.enforcer.mode, 'strict');
    next.enforcer = mode === undefined ? next.enforcer : { ...next.enforcer, mode };
  }

  if (next.guard && next.guard.injection === 'off') {
    next.guard = { ...next.guard, injection: 'strict' };
  }

  if (next.errorHandler) {
    const cb = next.errorHandler.circuitBreaker;
    if (cb) {
      next.errorHandler = { ...next.errorHandler, circuitBreaker: { ...cb, failN: Math.max((cb.failN ?? 5) - 1, 1) } };
    }
  }

  return next;
}

const TIER_DELTAS: Record<ModelTier, (harness: HarnessConfig) => HarnessConfig> = {
  frontier,
  'open-weight-verified': openWeightVerified,
  'open-weight-untested': openWeightUntested,
};

/** Resolve a tier's config delta against `harness`. Always tightens or no-ops, never loosens. */
export function tightenFor(tier: ModelTier, harness: HarnessConfig): HarnessConfig {
  return TIER_DELTAS[tier](harness);
}
