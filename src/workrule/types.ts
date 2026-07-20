/**
 * src/workrule/types.ts
 * -----------------------
 * `nim-workrule` — the six-rule working-checklist an agent runs against its
 * OWN editing behavior (not the content it produces — that's nim-baseline's
 * job). WR-06's tracked-memory entry is the one rule with a concrete
 * artifact; the other five are printed as self-check questions, never
 * auto-scored (no cited threshold exists for code-structure judgments the
 * way nim-index has cited tool-count bands — see skills/nim-workrule/SKILL.md
 * Notes).
 */

export interface AgentSupportEntry {
  /** ISO timestamp, set by the store on append. */
  at: string;
  /** Which nim-skill primitive fired (e.g. 'nim-cache', 'nim-index', 'nim-memory', 'nim-enforcer'). */
  primitive: string;
  /** Free-text: what it caught / prevented / enabled this task. */
  effect: string;
  /** Optional — populated only when the primitive reports a measurable token/context saving. */
  tokensSaved?: number;
}

export const WORKRULE_QUESTIONS: readonly { id: string; question: string }[] = [
  { id: 'WR-01', question: 'Clean + simple + SOLID — one responsibility per class/function, no duplicated logic across files?' },
  { id: 'WR-02', question: 'No repeated mistakes — did I grep for this exact bug pattern in OTHER modules, not just the one file I found it in?' },
  { id: 'WR-03', question: 'Essential files only — am I touching only the files this change actually requires, no drive-by edits?' },
  { id: 'WR-04', question: 'Partial reads, no new files unless essential — did I read only the relevant section, and check for an existing home before creating a new file?' },
  { id: 'WR-05', question: 'High quality, high performance, simple to deploy — config-gated, no new required dependency, byte-identical-off preserved?' },
  { id: 'WR-06', question: 'Tracked memory — did I log which nim-skill primitive helped this task and, where measurable, the token/context saving?' },
];
