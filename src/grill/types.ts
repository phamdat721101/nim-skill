/**
 * src/grill/types.ts
 * ------------------
 * Data model + public interfaces for `nim-grill` — the iterative interrogation
 * session primitive. Prompt-only: zero LLM calls inside the primitive; the host
 * agent runs generated question prompts. Session state is stored in JSONL files
 * under `.nim/grill/` (same gitignored-artifact convention as every other `.nim/*`
 * file). All types are data-only (serializable) so a session can be reloaded
 * across CLI invocations without a live in-memory object.
 */

// ─── Domain question bank ────────────────────────────────────────────────────

/** A single interrogation question, potentially resolved. */
export interface GrillQuestion {
  /** Unique identifier scoped to the domain, e.g. "x402-001". */
  id: string;
  /** Design-tree branch this question belongs to, e.g. "x402_protocol". */
  branch: string;
  /** The exact question text to present to the builder. */
  text: string;
  /** Recommended architectural answer from the agent perspective. */
  recommendation: string;
  /** True once a builder answer has been recorded for this question. */
  resolved: boolean;
}

// ─── Session model ────────────────────────────────────────────────────────────

/** A builder's recorded answer to one question. */
export interface GrillAnswer {
  questionId: string;
  answer: string;
  /** ISO timestamp of when the answer was recorded. */
  resolvedAt: string;
}

/** A full grill session — the unit of interrogation state. */
export interface GrillSession {
  /** Content-hash-keyed ID derived from domain + startedAt (mirrors nim-propose). */
  id: string;
  /** Domain key: 'x402' | 'xls65' | 'custom'. */
  domain: string;
  status: 'active' | 'compiling' | 'compiled';
  startedAt: string;
  /** All branch names present in this session's question set. */
  branches: string[];
  questions: GrillQuestion[];
  answers: GrillAnswer[];
}

// ─── Compiled PRD output ──────────────────────────────────────────────────────

/**
 * The enforcer-verified PRD compiled from a completed grill session.
 * Required fields (verified by nim-enforcer schema strategy before ship):
 *   - sessionId
 *   - resolvedDecisions
 *   - acceptanceCriteria
 */
export interface GrillPRD {
  sessionId: string;
  domain: string;
  compiledAt: string;
  resolvedDecisions: Array<{
    questionId: string;
    question: string;
    answer: string;
  }>;
  unresolvedTradeoffs: string[];
  acceptanceCriteria: string[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Declarative config for nim-grill — nested under `harness.grill` in nim.json
 * (same category as `cache`/`context`/`memory`/`lessons`/`logCompact`: a
 * per-`runHarnessed()`-call concern when ctx.grill is injected, and CLI-native
 * for the start/next/answer/status commands that run OUTSIDE runHarnessed()).
 */
export interface GrillConfig {
  /** Where session JSONL files are stored. Default: '.nim/grill'. */
  store?: string;
  /** Domain to load question banks for. Default: 'custom'. */
  domain?: string;
  /** How many questions to emit per `grill next` call. Default: 5 (PRD: 3–5). */
  questionsPerBatch?: number;
  /** Minimum resolved questions before `status.complete` is true. Default: 10. */
  minResolved?: number;
}

// ─── Runtime helper interface ─────────────────────────────────────────────────

/**
 * `ctx.grill` — injected by the harness runtime ONLY when `harness.grill` is
 * configured (byte-identical-off otherwise). Provides the interrogation session
 * API inside a `runHarnessed()` execute() call (e.g. for `grill compile`).
 */
export interface GrillHelper {
  /** Current active session, or undefined if none exists. */
  session(): GrillSession | undefined;
  /** Next batch of unresolved questions (≤ questionsPerBatch). */
  next(): GrillQuestion[];
  /** Record a builder answer, marking the question resolved. */
  answer(questionId: string, answer: string): void;
  /** Compile the current session into a GrillPRD (fails if no session). */
  compile(): GrillPRD;
  /** Progress snapshot: how many questions are resolved vs total. */
  status(): { resolved: number; total: number; complete: boolean };
}
