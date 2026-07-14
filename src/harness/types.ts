/**
 * src/harness/types.ts
 * --------------------
 * Shared contracts for the nim-skill harness. A skill is a unit an agent runs
 * INSIDE runHarnessed(): guard → error-handler → monitor → execute → enforcer.
 * Types are data-only (serializable) so a skill fully declares its contract.
 * Ported + extended from HyperMove `lib/harness/types.ts`, decoupled from MCP.
 */

// ─── Verify strategies (enforcer) ────────────────────────────────────────────

/** A single output-verify strategy. Data-only so it is serializable. */
export type VerifyStrategy =
  | { kind: 'nonempty' }
  | { kind: 'json' }
  | { kind: 'schema'; required: string[] }
  | { kind: 'math'; check: 'invoice-sum'; itemsField: string; totalField: string }
  | { kind: 'test'; command: string }
  | { kind: 'lint'; command: string }
  | { kind: 'command'; command: string };

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

export type ErrorClass = 'transient' | 'permanent' | 'critical';

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
}

// ─── Config vocabulary (nim.json → harness) ──────────────────────────────────

export interface GuardConfig {
  maxCostUsd?: number;
  ratePerMin?: number;
  allowTools?: string[];
  injection?: 'off' | 'strict';
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
  [key: string]: unknown;
}

export interface SkillDef<I = Record<string, unknown>, O = Record<string, unknown>> {
  name: string;
  version: string;
  description?: string;
  harness: HarnessConfig;
  execute: SkillExecute<I, O>;
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
