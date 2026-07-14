/**
 * src/monitor/roi.ts
 * ------------------
 * U3 — token-ROI accounting. Turns the harness's reliability behaviors into a
 * MEASURED (approximate) net-token figure, so "net-token-negative" is a number,
 * not a slogan.
 *
 * The model (deliberately conservative — under-claim, never over-claim):
 *  - guard denial      → a full run's tokens never happened          (+baseline)
 *  - permanent/critical → a blind-retry loop was avoided by classify (+baseline, ≥1 avoided re-run)
 *  - blocked bad output → a downstream re-do was prevented           (+baseline)
 * Harness checks themselves are deterministic (guard/classify/verify use ~0
 * model tokens), so `tokensSpentByHarness ≈ 0`. `netTokens = spent - saved`
 * (negative = net savings). All figures are ESTIMATES, labeled as such.
 */

import type { RunStatus, ErrorClass } from '../harness/types.js';

export interface RoiInput {
  status: RunStatus;
  errorClass?: ErrorClass;
  verified?: boolean;
  heals: number;
  /** Approximate tokens of one execute+output pass (the unit of avoided work). */
  baselineTokens: number;
}

export interface TokenRoi {
  tokensSavedEstimate: number;
  tokensSpentByHarness: number;
  netTokens: number;
}

export function computeTokenRoi(i: RoiInput): TokenRoi {
  const baseline = Math.max(0, Math.round(i.baselineTokens));
  let saved = 0;

  if (i.status === 'denied') saved += baseline;
  if (i.errorClass === 'permanent' || i.errorClass === 'critical') saved += baseline;
  if (i.status === 'success' && i.verified === false) saved += baseline;

  const spent = 0; // deterministic checks — no model tokens
  return { tokensSavedEstimate: saved, tokensSpentByHarness: spent, netTokens: spent - saved };
}
