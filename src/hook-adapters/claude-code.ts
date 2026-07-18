/**
 * src/hook-adapters/claude-code.ts
 * -----------------------------------
 * `toClaudeCodeDecision(result, mode)` — translates a plain
 * `WorkspaceCheckResult` into Claude Code's PreToolUse hook JSON shape
 * (`hookSpecificOutput`). Knows nothing about workspace/lessons internals
 * beyond the result shape (04 §4.1) — a thin, independently-testable
 * translation layer.
 *
 * `mode` (from `ResolvedWorkspaceConfig.mode`) governs ONLY the BLOCK case:
 * `mode === 'strict'` -> deny (hard-block); any other mode (`'warn'`, the
 * default, or `'off'`) -> ask, surfacing the same reason as an advisory
 * warning rather than a denial. EXTEND/COMPOSE/ITERATE always map to `ask`
 * and PROCEED always maps to `allow`, regardless of mode — those never
 * denied in the first place.
 */

import type { WorkspaceCheckResult } from '../workspace/index.js';
import type { ResolvedWorkspaceConfig } from '../config.js';

export type ClaudeCodePermissionDecision = 'allow' | 'deny' | 'ask';
export type WorkspaceMode = ResolvedWorkspaceConfig['mode'];

export interface ClaudeCodeDecision {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: ClaudeCodePermissionDecision;
    permissionDecisionReason: string;
    additionalContext?: string;
  };
}

const ASK_RECOMMENDATIONS = new Set(['EXTEND', 'COMPOSE', 'ITERATE']);

function decisionFor(recommendation: WorkspaceCheckResult['recommendation'], mode: WorkspaceMode): ClaudeCodePermissionDecision {
  if (recommendation === 'BLOCK') return mode === 'strict' ? 'deny' : 'ask';
  if (ASK_RECOMMENDATIONS.has(recommendation)) return 'ask';
  return 'allow';
}

export function toClaudeCodeDecision(result: WorkspaceCheckResult, mode: WorkspaceMode = 'strict'): ClaudeCodeDecision {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decisionFor(result.recommendation, mode),
      permissionDecisionReason: result.reason,
      ...(result.staleWarning ? { additionalContext: result.staleWarning } : {}),
    },
  };
}
