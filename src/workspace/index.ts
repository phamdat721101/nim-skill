/**
 * src/workspace/index.ts
 * ------------------------
 * `createWorkspaceGuard(cfg)` — public factory composing the identity,
 * existence, location, and staleness checks into `check()` + `audit()`,
 * same shape as `createBaselineLinter()`. CLI-callable AND hook-callable
 * (hook adapters wrap `check()`'s result, never re-derive it).
 */

import { existsSync, statSync } from 'node:fs';
import type { CheckResult } from '../harness/types.js';
import type { ResolvedWorkspaceConfig } from '../config.js';
import { checkLocationMatch, checkStaleness, deriveOffStackByPath } from './rules.js';
import { scanOffStackSignal } from './signal-scan.js';
import { scanExistenceOverlap, readWorkspaceArtifacts, type ExistingArtifact } from './existence-scan.js';

export interface WorkspaceProposal {
  filePath: string;
  content: string;
  declaredPurpose?: string;
}

export type WorkspaceRecommendation = 'PROCEED' | 'EXTEND' | 'COMPOSE' | 'ITERATE' | 'BLOCK';

export interface WorkspaceCheckResult {
  recommendation: WorkspaceRecommendation;
  reason: string;
  evidence: CheckResult[];
  /** Present independent of recommendation, per 04 §2.1 — staleness never blocks, only warns. */
  staleWarning?: string;
}

export interface WorkspaceGuard {
  check(proposal: WorkspaceProposal): WorkspaceCheckResult;
  audit(rootDir: string): Array<{ pathA: string; pathB: string; overlapPct: number }>;
}

/**
 * `offStackByPath` is an internal derivation from `cfg.stack` (04 §2.1 point
 * 3's location-to-subject-matter map) — `resolveWorkspaceConfig()` already
 * populates it for the normal nim.json-driven path, but `createWorkspaceGuard`
 * degrades gracefully and derives it itself when a caller constructs a
 * `ResolvedWorkspaceConfig`-shaped object directly (e.g. in tests) without it.
 */
function ensureOffStackByPath(cfg: ResolvedWorkspaceConfig): Record<string, RegExp> {
  return cfg.offStackByPath ?? deriveOffStackByPath(cfg.stack);
}

function buildStaleWarning(cfg: ResolvedWorkspaceConfig): string | undefined {
  if (!cfg.livenessFile || cfg.livenessCadence.length === 0) return undefined;
  if (!existsSync(cfg.livenessFile)) return undefined;
  const mtimeMs = statSync(cfg.livenessFile).mtimeMs;
  const result = checkStaleness(mtimeMs, Date.now(), cfg.livenessCadence);
  return result.pass ? undefined : result.reason;
}

/**
 * Never-loosen-on-absence for a stale liveness file that doesn't exist yet:
 * evaluated separately from the missing-file early-return above so a
 * declared-but-not-yet-created liveness file degrades to "no signal" rather
 * than throwing.
 */
export function createWorkspaceGuard(cfg: ResolvedWorkspaceConfig): WorkspaceGuard {
  const hasDeclaredStack = cfg.stack.length > 0;

  return {
    check(proposal: WorkspaceProposal): WorkspaceCheckResult {
      // mode:'off' disables the check entirely — always PROCEED, zero evidence
      // computed (no signal-scan, no existence-scan, no staleness read).
      if (cfg.mode === 'off') {
        return { recommendation: 'PROCEED', reason: 'workspace check disabled (mode: off)', evidence: [] };
      }

      const evidence: CheckResult[] = [];
      const staleWarning = buildStaleWarning(cfg);

      // 1. Identity — off-stack signal-term clustering. Absent stack declaration
      //    never produces a BLOCK identity mismatch (nothing to check against).
      let signalMatch: { matchedStack: string; evidence: CheckResult } | null = null;
      if (hasDeclaredStack) {
        signalMatch = scanOffStackSignal(proposal.content, cfg.stack, cfg.offStackSignalTerms, cfg.clusterWindow, cfg.clusterThreshold);
        if (signalMatch) evidence.push(signalMatch.evidence);
      }

      // 2. Subject-matter-to-location — belt-and-suspenders even if identity passed.
      const locationResult = checkLocationMatch(proposal.filePath, signalMatch ? [signalMatch.matchedStack] : null, ensureOffStackByPath(cfg));
      evidence.push(locationResult);

      if (signalMatch || !locationResult.pass) {
        const reason = signalMatch
          ? `this content clusters signal for '${signalMatch.matchedStack}'; declared workspace stack is ${cfg.stack.join('+')}; refusing write to ${proposal.filePath}. If this is intentional cross-project reference material, add an explicit override comment or move it to the correct sibling workspace.`
          : locationResult.reason ?? 'subject-matter-to-location mismatch';
        return { recommendation: 'BLOCK', reason, evidence, staleWarning };
      }

      // 3. Existence — overlap against discovered workspace artifacts.
      const candidates: ExistingArtifact[] = readWorkspaceArtifacts('.', '**/SKILL.md');
      const purpose = proposal.declaredPurpose ?? proposal.content.slice(0, 200);
      const { overlaps, recommendation } = scanExistenceOverlap(purpose, candidates, cfg.existenceOverlapThresholds);

      const reason =
        recommendation === 'PROCEED'
          ? 'no identity mismatch, no significant existence overlap, location matches subject matter'
          : `${recommendation.toLowerCase()} candidate(s): ${overlaps.map((o) => `${o.path} (${o.overlapPct}%)`).join(', ')}`;

      return { recommendation, reason, evidence, staleWarning };
    },

    audit(rootDir: string): Array<{ pathA: string; pathB: string; overlapPct: number }> {
      const artifacts = readWorkspaceArtifacts(rootDir, '**/SKILL.md');
      const pairs: Array<{ pathA: string; pathB: string; overlapPct: number }> = [];
      for (let i = 0; i < artifacts.length; i++) {
        const a = artifacts[i];
        if (!a) continue;
        for (let j = i + 1; j < artifacts.length; j++) {
          const b = artifacts[j];
          if (!b) continue;
          const { overlaps } = scanExistenceOverlap(a.declaredPurpose, [b], cfg.existenceOverlapThresholds);
          const top = overlaps[0];
          if (top) {
            pairs.push({ pathA: a.path, pathB: b.path, overlapPct: top.overlapPct });
          }
        }
      }
      return pairs;
    },
  };
}
