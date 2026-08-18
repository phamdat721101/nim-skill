/**
 * src/harness/types.ts
 * --------------------
 * Shared contracts for the nim-skill harness. A skill is a unit an agent runs
 * INSIDE runHarnessed(): guard → error-handler → monitor → execute → enforcer.
 * Types are data-only (serializable) so a skill fully declares its contract.
 * Ported + extended from HyperMove `lib/harness/types.ts`, decoupled from MCP.
 */

import type { Lesson, TriggerShape } from '../lessons/types.js';

// ─── Verify strategies (enforcer) ────────────────────────────────────────────

/** A single output-verify strategy. Data-only so it is serializable. */
export type VerifyStrategy =
  | { kind: 'nonempty' }
  | { kind: 'json' }
  | { kind: 'schema'; required: string[] }
  | { kind: 'math'; check: 'invoice-sum'; itemsField: string; totalField: string }
  | { kind: 'test'; command: string }
  | { kind: 'lint'; command: string }
  | { kind: 'command'; command: string }
  | { kind: 'result'; successPath: string; successValue: boolean; requiredPath?: string }
  | { kind: 'evidence'; claimField: string; evidenceField: string; forbiddenSource?: string };

/** Bare strategy names usable as config shorthand (param-less ones only). */
export type VerifyStrategyName = VerifyStrategy['kind'];

export type EnforceMode = 'strict' | 'warn' | 'off';

export interface CheckResult {
  strategy: string;
  pass: boolean;
  reason?: string;
}

/** Result of the enforcer verify-gate (= seed EnforceResult). */
export interface VerifyResult<T = Record<string, unknown>> {
  verified: boolean;
  heals: number;
  checks: CheckResult[];
  output: T;
}

// ─── Error handler ───────────────────────────────────────────────────────────

export type ErrorClass = 'transient' | 'permanent' | 'critical' | 'timeout' | 'ambiguous';

export interface ClassifiedError {
  class: ErrorClass;
  message: string;
  cause?: unknown;
  retryable: boolean;
  attempts: number;
}

/** Discriminated result — never throw unclassified. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ClassifiedError };

// ─── Monitor trace ─────────────────────────────────────────────────────────

export type RunStatus = 'success' | 'error' | 'denied';

/** v0.3 — cache-hit accounting folded into a run's trace. */
export interface CacheTrace {
  provider: string;
  strategy: string;
  cachedTokens: number;
  writeTokens: number;
  readTokens: number;
  tokensSaved: number;
  dollarsSaved: number;
  hitRate: number;
  breakEvenOk: boolean;
}

/** v0.4 nim-index — standing tool-disclosure tax, populated only when nim-index runs. */
export interface DisclosureTrace {
  toolCount: number;
  estimatedTokensPerTurn: number;
  riskBand: 'low-risk' | 'watch' | 'elevated-risk' | 'high-risk';
}

/** v0.5 nim-lessons — populated only when a run's skill captures a lesson (additive, optional). */
export interface LessonsMatchTrace {
  matchedLessonIds: string[];
  severity: 'info' | 'warning' | 'critical' | null;
}

/**
 * v0.8 nim-guard — per-task budget consumption report. Populated only when
 * `guard.taskBudgetUsd` or `guard.taskBudgetTokens` is configured (additive,
 * optional, same precedent as `cache`/`disclosure`/`lessonsMatch`). Always
 * reports BOTH units (decision 6: single field configured, both reported),
 * converted via the same pricing table `nim-cache` already uses.
 */
export interface BudgetTrace {
  capUsd: number;
  spentUsd: number;
  capTokensEquivalent: number;
  spentTokensEquivalent: number;
  timedOut: boolean;
  weekly?: { capTokens: number; spentTokens: number };
}

export interface TraceRecord {
  skill: string;
  traceId: string;
  startedAt: string;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  costEstimate?: number;
  verifyPassed?: boolean;
  healCount?: number;
  errorClass?: ErrorClass;
  status: RunStatus;
  /** U3 token-ROI (approximate estimates, labeled as such). */
  tokensSavedEstimate?: number;
  tokensSpentByHarness?: number;
  netTokens?: number;
  /** v0.3 cache ROI. */
  cache?: CacheTrace;
  /** v0.4 nim-index disclosure-tax report. */
  disclosure?: DisclosureTrace;
  /** v0.4 nim-profile — set by the caller when applyProfile() was used. */
  profileTier?: 'frontier' | 'open-weight-verified' | 'open-weight-untested';
  /** v0.5 nim-lessons — set only when harness.lessons is configured AND a match/capture occurred this run. */
  lessonsMatch?: LessonsMatchTrace;
  /** v0.9 nim-logcompact — set only when harness.logCompact is configured AND ctx.logCompact.compact() was called this run. */
  logCompact?: LogCompactResult;
  /** v0.9 nim-propose — set only when guard.propose.require is configured (populated on both the deny path and the allowed/success path). */
  proposal?: ProposalTrace;
  /** v0.8 nim-guard — set only when guard.taskBudgetUsd/taskBudgetTokens is configured. */
  budget?: BudgetTrace;
}

// ─── Config vocabulary (nim.json → harness) ──────────────────────────────────

export interface GuardConfig {
  maxCostUsd?: number;
  ratePerMin?: number;
  allowTools?: string[];
  injection?: 'off' | 'strict';
  /**
   * v0.8 — per-task budget cap in USD, reset every `runHarnessed()` call
   * (orthogonal to the cumulative/rolling `maxCostUsd` above — both can
   * independently deny a run). Mutually exclusive with `taskBudgetTokens`.
   * Defaults to 5 (USD) when the guard block is present and neither budget
   * field is set.
   */
  taskBudgetUsd?: number;
  /** v0.8 — per-task budget cap expressed as a token-credit count instead of USD. Mutually exclusive with `taskBudgetUsd`. */
  taskBudgetTokens?: number;
  /** v0.8 — wall-clock duration cap in ms for one `runHarnessed()` call. Cooperative cancellation via `ctx.signal` (never a hard/preemptive kill). Defaults to 300_000 (5 min). */
  maxDurationMs?: number;
  /** Optional rolling seven-day local token allowance. */
  weeklyTokenBudget?: number;
  /** Local JSONL ledger path for the optional weekly token allowance. */
  weeklyBudgetStore?: string;
  /**
   * v0.9 `nim-propose` — pre-execute deny gate requiring an explicit,
   * approved plan artifact before a task runs. Extends `nim-guard` directly
   * (same precedent as `taskBudgetUsd`/`maxDurationMs` above) rather than a
   * new sibling primitive: "did a human approve a plan first" is a
   * policy-shaped concern identical in kind to the existing cost/rate/budget
   * checks. Absent/`require:false` ⇒ no proposal check at all (rollback
   * contract, byte-identical to pre-v0.9 behavior).
   */
  propose?: ProposeConfig;
  /** Block or warn before repeating a recently logged costly failed action. */
  costGate?: CostGateConfig | false;
}

export interface CostGateConfig {
  tools: string[];
  lookbackHours?: number;
  mode?: 'strict' | 'warn';
}

export interface ProposeConfig {
  /** When true, `checkPolicy()` denies unless an approved, non-expired plan exists for the task description. Default false. */
  require?: boolean;
  /** How stale an approval may be before it's treated as expired. Default 24h. */
  approvalTtlMs?: number;
  /** Where plan artifacts live. Default `.nim/proposals`. */
  proposalsDir?: string;
}

export interface CircuitBreakerConfig {
  failN?: number;
  cooldownMs?: number;
  windowSize?: number;
}

export type BackoffKind = 'exp-jitter' | 'fixed' | 'none';

export interface ErrorHandlerConfig {
  retries?: number;
  backoff?: BackoffKind;
  baseDelayMs?: number;
  circuitBreaker?: CircuitBreakerConfig | false;
  /** JSON-safe regex source strings describing errors this skill expects. */
  expectedErrorPatterns?: string[];
}

export interface EnforcerConfig {
  strategies?: Array<VerifyStrategy | VerifyStrategyName>;
  maxHeals?: number;
  /** Preferred. If omitted, derived from `strict` (true→strict, false→warn). */
  mode?: EnforceMode;
  /** Legacy boolean shorthand for mode. */
  strict?: boolean;
  /** U5a — 'minimal' feeds back a compact structured diff; 'full' (default) the verbose reason dump. */
  healFeedback?: 'minimal' | 'full';
}

export type ExporterName = 'console' | 'file' | 'sentry';

export interface MonitorConfig {
  exporters?: ExporterName[];
  traceFile?: string;
  /** U3 — record token-ROI (tokensSaved/spent/net) per run. */
  tokenAccounting?: boolean;
}

// ─── New v0.2 / v0.3 config layers (all optional, all config-gated) ──────────

/** U1 `nim-context` — the "see" verb: progressive disclosure + per-run token budget. */
export interface ContextConfig {
  progressive?: boolean;
  maxInputTokens?: number;
  onExceed?: 'compact' | 'warn' | 'block';
  lean?: boolean;
}

/** U4 `nim-memory-lite` — the "remember" verb: verify-result cache + episodic priors. */
export interface MemoryConfig {
  verifyCache?: boolean;
  priors?: boolean;
  ttlMs?: number;
  store?: string;
  /** Separate local JSONL store for typed external sessions. */
  sessionStore?: string;
}

/** U2 — isolated-context skill execution (keeps retry/heal noise out of the main window). */
export interface ExecutionConfig {
  isolate?: boolean;
  isolateOnRetry?: boolean;
}

export type CacheProvider =
  | 'auto' | 'anthropic' | 'minimax' | 'qwen' | 'openai' | 'glm' | 'gemini' | 'deepseek';

/** v0.3 `nim-cache` — cache-aware assembly + ROI meter. */
export interface CacheConfig {
  provider?: CacheProvider;
  strategy?: 'prefix' | 'explicit';
  ttl?: '5m' | '1h';
  minTokens?: number;
  roi?: boolean;
  breakEvenReads?: number;
  /** Per-provider price overrides ({base, cachedRead} $/token); estimates, user-overridable. */
  prices?: Record<string, { base: number; cachedRead: number }>;
}

/** v0.5 `nim-lessons` — the auto-captured, queryable error/lesson log. Nested under `harness` (unlike `workspace`, a top-level sibling), because `ctx.lessons` is a per-`runHarnessed()`-call concern, same category as `cache`/`context`/`memory`. */
export interface LessonsConfig {
  store?: string;
  ttlMs?: number;
}

/**
 * v1.0 `nim-grill` — iterative interrogation session helper. Nested under
 * `harness` (same category as `cache`/`context`/`memory`/`lessons`/`logCompact`):
 * a per-`runHarnessed()`-call concern for the compile step; CLI-native for
 * start/next/answer/status (which run outside runHarnessed()).
 */
export interface GrillConfig {
  /** Where session JSONL files live. Default: '.nim/grill'. */
  store?: string;
  /** Domain question bank to load: 'x402' | 'xls65' | 'custom'. Default: 'custom'. */
  domain?: string;
  /** How many questions per `grill next` call. Default: 5. */
  questionsPerBatch?: number;
  /** Minimum resolved questions for status.complete to be true. Default: 10. */
  minResolved?: number;
}

/**
 * v0.9 `nim-logcompact` — compresses raw subprocess/tool output (stdout/
 * stderr, log tails) before it reaches an agent's context. Nested under
 * `harness` (same category as `cache`/`context`/`memory`/`lessons`): a
 * per-`runHarnessed()`-call concern, not a build-time/hook-native one.
 */
export interface LogCompactConfig {
  maxLines?: number;
  strategy?: 'cap' | 'errors-only' | 'incremental';
  escalateOnEmpty?: boolean;
}

// ─── Injected ctx helpers (interfaces here; implementations in their modules) ─

export interface CacheBlock {
  text: string;
  [key: string]: unknown;
}

export interface CacheAssembleMeta {
  provider: string;
  strategy: string;
  staticTokensEstimate: number;
  belowMinTokens: boolean;
  markersApplied: boolean;
}

export interface CacheHelper {
  /** Order stable content first (reusable prefix), variable input last; mark per provider. */
  assemble(staticBlocks: CacheBlock[], dynamicBlocks: CacheBlock[]): { payload: CacheBlock[]; meta: CacheAssembleMeta };
  /** Feed the provider's response usage back so the harness can measure cache ROI. */
  record(usage: Record<string, unknown>): void;
}

export type BudgetAction = 'ok' | 'compact' | 'warn';

export interface ContextHelper {
  /** Check an estimate against the per-run budget; throws ContextBudgetError on 'block'. */
  budget(estimatedTokens: number): { action: BudgetAction; overBudget: boolean };
}

export interface MemoryHelper {
  getVerify(key: string): boolean | undefined;
  setVerify(key: string, verdict: boolean): void;
  getPrior(category: string): unknown;
  setPrior(category: string, value: unknown): void;
  getSession<T extends ExternalSession = ExternalSession>(provider: string, options?: SessionOptions): T | undefined;
  setSession(provider: string, session: ExternalSession, options?: SetSessionOptions): void;
  clearSession(provider: string, options?: SessionOptions): void;
}

/** Non-secret external workflow state. Private credentials are never accepted. */
export interface ExternalSession {
  provider?: string;
  agentId?: string;
  sessionId?: string;
  walletAddress?: string;
  quoteId?: string;
  expiresAt?: string;
  lastRunId?: string;
  updatedAt?: string;
}

export interface SessionOptions {
  profile?: string;
}

export interface SetSessionOptions extends SessionOptions {
  ttlMs?: number;
}

export interface LessonsHelper {
  check(shape: TriggerShape): Lesson[];
  capture(entry: Omit<Lesson, 'id' | 'capturedAt'>): Lesson;
}

/** v0.9 `nim-logcompact` — opt-in per-call helper, injected only when `harness.logCompact` is configured. */
export interface LogCompactResult {
  text: string;
  originalChars: number;
  compactedChars: number;
  reductionPct: number;
}

export interface LogCompactHelper {
  compact(raw: string): LogCompactResult;
}

/** v0.9 `nim-propose` — set only when `guard.propose.require` is configured. Reports whether a proposal was required and whether it was found approved. */
export interface ProposalTrace {
  required: boolean;
  approved: boolean;
  reason?: 'no_proposal' | 'not_approved' | 'approval_expired';
}

/**
 * v0.8 `nim-guard` — the per-run task-budget helper injected as `ctx.budget`
 * ONLY when `guard.taskBudgetUsd`/`guard.taskBudgetTokens` is configured
 * (opt-in instrumentation, byte-identical-off otherwise). `spend()` lets a
 * skill report live/actual spend as it happens (e.g. one call per LLM
 * request inside `execute()`); the harness checks the running total against
 * the same per-task cap the pre-flight estimate used. `timedOut()` is a
 * convenience boolean mirror of `ctx.signal.aborted` (decision 8 — both a
 * real AbortSignal AND this getter are provided, not one or the other).
 */
export interface BudgetHelper {
  /** Report actual spend so far. Throws BudgetExceededError once the running total crosses the per-task cap. */
  spend(amount: { usd?: number; tokens?: number }): void;
  /** Convenience mirror of `ctx.signal.aborted` — true once the duration cap has fired. */
  timedOut(): boolean;
  /** Current accumulated spend, in USD (converted via the shared pricing table when tracked in tokens). */
  spentUsd(): number;
  spentTokens(): number;
  weekly(): { capTokens: number; spentTokens: number } | undefined;
}

/** Declarative harness config — the `harness` block of nim.json / a skill. */
export interface HarnessConfig {
  guard?: GuardConfig | false;
  errorHandler?: ErrorHandlerConfig | false;
  enforcer?: EnforcerConfig | false;
  monitor?: MonitorConfig | false;
  context?: ContextConfig | false;
  memory?: MemoryConfig | false;
  execution?: ExecutionConfig | false;
  cache?: CacheConfig | false;
  lessons?: LessonsConfig | false;
  logCompact?: LogCompactConfig | false;
  /** v1.0 nim-grill — interrogation session helper. */
  grill?: GrillConfig | false;
}

// ─── Skill definition ─────────────────────────────────────────────────────

export type SkillExecute<I = Record<string, unknown>, O = Record<string, unknown>> = (
  input: I,
  ctx: SkillContext,
) => Promise<O> | O;

export interface SkillContext {
  agentId: string;
  /** Fed back by enforcer/error-handler self-heal loops. */
  _feedback?: string;
  /** Injected before execute when the layer is enabled (no-op helper otherwise). */
  cache?: CacheHelper;
  context?: ContextHelper;
  memory?: MemoryHelper;
  lessons?: LessonsHelper;
  /** v0.9 nim-logcompact — opt-in, injected only when harness.logCompact is configured. */
  logCompact?: LogCompactHelper;
  /** v0.8 nim-guard — opt-in live spend accumulation, injected only when a per-task budget is configured. */
  budget?: BudgetHelper;
  /** v1.0 nim-grill — opt-in interrogation session helper, injected only when harness.grill is configured. */
  grill?: import('../grill/types.js').GrillHelper;
  /**
   * v0.8 nim-guard — a real AbortSignal, injected only when `guard.maxDurationMs`
   * is configured. Fires (`.aborted === true`) once the wall-clock cap elapses.
   * Cooperative: nothing forcibly stops a skill that never checks/awaits it.
   */
  signal?: AbortSignal;
  /** Optional metadata for a potentially irreversible action guarded by costGate. */
  costedAction?: { toolName: string; actionKey: string };
  /** Actual spend already incurred for a costed action, used only for lesson capture. */
  costIncurredUsd?: number;
  [key: string]: unknown;
}

export interface SkillDef<I = Record<string, unknown>, O = Record<string, unknown>> {
  name: string;
  version: string;
  description?: string;
  harness: HarnessConfig;
  execute: SkillExecute<I, O>;
  /** Read-only probe for an unexpected configured error; called at most once per failure. */
  diagnose?: (ctx: SkillContext, error: unknown) => Promise<unknown> | unknown;
}

/** The structured envelope every harnessed run returns. */
export interface HarnessResult<O = Record<string, unknown>> {
  skill: string;
  output: O;
  verified: boolean;
  heals: number;
  checks: CheckResult[];
  trace: TraceRecord;
}
