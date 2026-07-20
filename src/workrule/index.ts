/**
 * src/workrule/index.ts
 * -----------------------
 * `createWorkruleHelper(cfg)` — public factory. `questions()` returns the
 * static six-question checklist (no I/O); `log()` is the one side-effecting
 * call, delegating to the store. CLI-callable only (no `ctx.workrule`
 * runtime injection — this is a session-boundary self-check, not a
 * per-`runHarnessed()`-call concern, same category as `nim-baseline`).
 */

import { createWorkruleStore, type WorkruleStoreConfig } from './store.js';
import { WORKRULE_QUESTIONS } from './types.js';
import type { AgentSupportEntry } from './types.js';

export function createWorkruleHelper(cfg: WorkruleStoreConfig): {
  questions(): readonly { id: string; question: string }[];
  log(entry: Omit<AgentSupportEntry, 'at'>): AgentSupportEntry;
  history(): AgentSupportEntry[];
} {
  const store = createWorkruleStore(cfg);
  return {
    questions: () => WORKRULE_QUESTIONS,
    log: (entry) => store.append(entry),
    history: () => store.readAll(),
  };
}

export { WORKRULE_QUESTIONS } from './types.js';
export type { AgentSupportEntry } from './types.js';
