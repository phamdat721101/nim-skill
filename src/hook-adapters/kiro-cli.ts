/**
 * src/hook-adapters/kiro-cli.ts
 * --------------------------------
 * `toKiroCliDecision(result, mode)` — translates the SAME
 * `WorkspaceCheckResult` into Kiro CLI's exit-code / stdout / stderr shape
 * (04 §4.1), which is deliberately NOT the Claude Code JSON shape. Kiro's
 * preToolUse hooks read exit-code semantics: non-zero exit + stderr reason =
 * block; zero exit is always allowed to proceed, with any reviewer-facing
 * message surfaced on stdout instead (ask-style recommendations and stale
 * warnings alike).
 *
 * `mode` (from `ResolvedWorkspaceConfig.mode`) governs ONLY the BLOCK case:
 * `mode === 'strict'` -> exit 1 + stderr (hard-block); any other mode
 * (`'warn'`, the default, or `'off'`) -> exit 0, with the same reason
 * surfaced on stdout as an advisory warning instead of stderr. EXTEND/
 * COMPOSE/ITERATE always map to exit 0 + stdout and PROCEED always maps to
 * exit 0, regardless of mode — those never denied in the first place.
 */

import type { WorkspaceCheckResult } from '../workspace/index.js';
import type { ResolvedWorkspaceConfig } from '../config.js';

export type WorkspaceMode = ResolvedWorkspaceConfig['mode'];

export interface KiroCliDecision {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const ASK_RECOMMENDATIONS = new Set(['EXTEND', 'COMPOSE', 'ITERATE']);

export function toKiroCliDecision(result: WorkspaceCheckResult, mode: WorkspaceMode = 'strict'): KiroCliDecision {
  const staleLine = result.staleWarning ? `nim: ${result.staleWarning}\n` : '';

  if (result.recommendation === 'BLOCK') {
    if (mode === 'strict') {
      return { exitCode: 1, stdout: staleLine, stderr: `nim: BLOCK — ${result.reason}\n` };
    }
    return { exitCode: 0, stdout: `${staleLine}nim: BLOCK (warn) — ${result.reason}\n`, stderr: '' };
  }

  if (ASK_RECOMMENDATIONS.has(result.recommendation)) {
    return { exitCode: 0, stdout: `${staleLine}nim: ${result.recommendation} — ${result.reason}\n`, stderr: '' };
  }

  // PROCEED
  return { exitCode: 0, stdout: staleLine, stderr: '' };
}
