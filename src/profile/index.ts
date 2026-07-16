/**
 * src/profile/index.ts
 * ----------------------
 * `applyProfile()` — a pre-processing function applied to a `HarnessConfig`
 * BEFORE `resolveConfig()` runs. Composes AROUND runHarnessed(), never adds
 * a 6th pipeline step (docs/prd/12-final-prd-v04.md §6, P4-14/P4-15).
 */

import type { HarnessConfig } from '../harness/types.js';
import { tightenFor, type ModelTier } from './tiers.js';
import { FRONTIER_PATTERNS, VERIFIED_SEED_PATTERNS } from './patterns.js';

export type { ModelTier } from './tiers.js';

export interface ProfileConfig {
  /** Explicit override — always wins if set. */
  tier?: ModelTier;
  /** Extends the built-in open-weight-verified seed list. */
  verifiedModelPatterns?: string[];
  /** e.g. process.env.MODEL_NAME or a base-url string; used ONLY if tier is unset. */
  modelHint?: string;
}

/**
 * Resolution order (deterministic): explicit tier wins; else modelHint against
 * frontier patterns; else modelHint against verified patterns (built-in +
 * user-extended); else the safe default `open-weight-untested` — no
 * detection ⇒ the strictest tier, not the loosest (a deliberate departure
 * from the codebase's usual "absent config ⇒ no-op" contract, called out
 * explicitly here per docs/prd/09-nim-profile.md §4).
 */
export function detectTier(cfg: ProfileConfig): ModelTier {
  if (cfg.tier) return cfg.tier;
  const hint = cfg.modelHint;
  if (!hint) return 'open-weight-untested';
  if (FRONTIER_PATTERNS.some((re) => re.test(hint))) return 'frontier';
  const verifiedPatterns = [...VERIFIED_SEED_PATTERNS, ...(cfg.verifiedModelPatterns ?? []).map((p) => new RegExp(p, 'i'))];
  if (verifiedPatterns.some((re) => re.test(hint))) return 'open-weight-verified';
  return 'open-weight-untested';
}

/** Resolve `harness` through the detected/declared tier. Frontier ⇒ exact passthrough. */
export function applyProfile(harness: HarnessConfig, profile: ProfileConfig): { harness: HarnessConfig; tier: ModelTier } {
  const tier = detectTier(profile);
  return { harness: tightenFor(tier, harness), tier };
}
