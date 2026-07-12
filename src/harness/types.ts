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
}

export type ExporterName = 'console' | 'file' | 'sentry';

export interface MonitorConfig {
  exporters?: ExporterName[];
  traceFile?: string;
}

/** Declarative harness config — the `harness` block of nim.json / a skill. */
export interface HarnessConfig {
  guard?: GuardConfig | false;
  errorHandler?: ErrorHandlerConfig | false;
  enforcer?: EnforcerConfig | false;
  monitor?: MonitorConfig | false;
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
