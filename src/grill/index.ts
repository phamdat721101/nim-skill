/**
 * src/grill/index.ts
 * ------------------
 * Public factory `createGrillHelper(cfg)` — wires session store + compiler
 * into the GrillHelper interface injected as `ctx.grill` by the harness
 * runtime. Also the public re-export point for all grill sub-modules.
 *
 * CLI-native commands (start/next/answer/status) call `createGrillStore()`
 * directly, without going through `runHarnessed()`. The `compile` command
 * calls `compilePRD()` inside `runHarnessed()` with an enforcer config so
 * the PRD schema is verified before the markdown file is written.
 */

import { createGrillStore, writePRDFile } from './session.js';
import { loadQuestionsForDomain } from './questions.js';
import { compilePRD, formatPRDMarkdown } from './compiler.js';
import type { GrillHelper, GrillQuestion, GrillPRD } from './types.js';

export interface ResolvedGrillConfig {
  store: string;
  domain: string;
  questionsPerBatch: number;
  minResolved: number;
}

/**
 * Create a GrillHelper bound to the resolved config. Injected as `ctx.grill`
 * inside runHarnessed() when `harness.grill` is configured.
 */
export function createGrillHelper(cfg: ResolvedGrillConfig): GrillHelper {
  const store = createGrillStore(cfg.store);

  return {
    session() {
      return store.latest();
    },

    next(): GrillQuestion[] {
      const s = store.latest();
      if (!s) return [];
      return s.questions
        .filter((q) => !q.resolved)
        .slice(0, cfg.questionsPerBatch);
    },

    answer(questionId: string, answer: string): void {
      const s = store.latest();
      if (!s) throw new Error('nim-grill: no active session — run `nim-skill grill start` first');
      store.answer(s.id, questionId, answer);
    },

    compile(): GrillPRD {
      const s = store.latest();
      if (!s) throw new Error('nim-grill: no active session to compile');
      const prd = compilePRD(s);
      const md = formatPRDMarkdown(prd);
      const prdFile = writePRDFile(cfg.store, s.id, md);
      store.markCompiled(s.id, prdFile);
      return prd;
    },

    status() {
      const s = store.latest();
      if (!s) return { resolved: 0, total: 0, complete: false };
      const resolved = s.questions.filter((q) => q.resolved).length;
      return {
        resolved,
        total: s.questions.length,
        complete: resolved >= cfg.minResolved,
      };
    },
  };
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { createGrillStore, writePRDFile, sessionIdFor } from './session.js';
export { compilePRD, formatPRDMarkdown } from './compiler.js';
export { loadQuestionsForDomain, DOMAIN_QUESTIONS, X402_QUESTIONS, XLS65_QUESTIONS, GENERIC_QUESTIONS } from './questions.js';
export type { GrillSession, GrillQuestion, GrillAnswer, GrillPRD, GrillConfig, GrillHelper } from './types.js';
export type { GrillStore } from './session.js';
