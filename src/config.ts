/**
 * src/config.ts
 * -------------
 * Zod-validated nim.json loader + resolver. Absent (or `false`) block ⇒ that
 * layer resolves to `null` = disabled = no-op passthrough in the runtime
 * (byte-identical bare run — the rollback contract). Present block ⇒ defaults
 * filled. Single responsibility: parse + validate + resolve. No I/O beyond an
 * optional file read gated behind existsSync.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { deriveOffStackByPath } from './workspace/rules.js';
import type {
  HarnessConfig,
  GuardConfig,
  ErrorHandlerConfig,
  EnforcerConfig,
  MonitorConfig,
  ContextConfig,
  MemoryConfig,
  ExecutionConfig,
  CacheConfig,
  CacheProvider,
  LessonsConfig,
  VerifyStrategy,
  EnforceMode,
} from './harness/types.js';

// ─── Zod schemas ─────────────────────────────────────────────────────────

const verifyStrategySchema: z.ZodType<VerifyStrategy> = z.union([
  z.object({ kind: z.literal('nonempty') }),
  z.object({ kind: z.literal('json') }),
  z.object({ kind: z.literal('schema'), required: z.array(z.string()) }),
  z.object({
    kind: z.literal('math'),
    check: z.literal('invoice-sum'),
    itemsField: z.string(),
    totalField: z.string(),
  }),
  z.object({ kind: z.literal('test'), command: z.string() }),
  z.object({ kind: z.literal('lint'), command: z.string() }),
  z.object({ kind: z.literal('command'), command: z.string() }),
]);

const strategyName = z.enum(['nonempty', 'json', 'schema', 'math', 'test', 'lint', 'command']);

const guardSchema = z.object({
  maxCostUsd: z.number().nonnegative().optional(),
  ratePerMin: z.number().int().positive().optional(),
  allowTools: z.array(z.string()).optional(),
  injection: z.enum(['off', 'strict']).optional(),
});

const circuitBreakerSchema = z.object({
  failN: z.number().int().positive().optional(),
  cooldownMs: z.number().int().nonnegative().optional(),
  windowSize: z.number().int().positive().optional(),
});

const errorHandlerSchema = z.object({
  retries: z.number().int().nonnegative().optional(),
  backoff: z.enum(['exp-jitter', 'fixed', 'none']).optional(),
  baseDelayMs: z.number().int().nonnegative().optional(),
  circuitBreaker: z.union([circuitBreakerSchema, z.literal(false)]).optional(),
});

const enforcerSchema = z.object({
  strategies: z.array(z.union([verifyStrategySchema, strategyName])).optional(),
  maxHeals: z.number().int().optional(),
  mode: z.enum(['strict', 'warn', 'off']).optional(),
  strict: z.boolean().optional(),
  healFeedback: z.enum(['minimal', 'full']).optional(),
});

const monitorSchema = z.object({
  exporters: z.array(z.enum(['console', 'file', 'sentry'])).optional(),
  traceFile: z.string().optional(),
  tokenAccounting: z.boolean().optional(),
});

const contextSchema = z.object({
  progressive: z.boolean().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  onExceed: z.enum(['compact', 'warn', 'block']).optional(),
  lean: z.boolean().optional(),
});

const memorySchema = z.object({
  verifyCache: z.boolean().optional(),
  priors: z.boolean().optional(),
  ttlMs: z.number().int().nonnegative().optional(),
  store: z.string().optional(),
});

const executionSchema = z.object({
  isolate: z.boolean().optional(),
  isolateOnRetry: z.boolean().optional(),
});

const cacheProviderSchema = z.enum([
  'auto', 'anthropic', 'minimax', 'qwen', 'openai', 'glm', 'gemini', 'deepseek',
]);

const cacheSchema = z.object({
  provider: cacheProviderSchema.optional(),
  strategy: z.enum(['prefix', 'explicit']).optional(),
  ttl: z.enum(['5m', '1h']).optional(),
  minTokens: z.number().int().positive().optional(),
  roi: z.boolean().optional(),
  breakEvenReads: z.number().positive().optional(),
  prices: z
    .record(z.object({ base: z.number().nonnegative(), cachedRead: z.number().nonnegative() }))
    .optional(),
});

/**
 * `lessons` is NESTED inside `harnessSchema` (unlike `workspace`, a top-level
 * sibling key) — `ctx.lessons` is a per-`runHarnessed()`-call concern, same
 * category as `cache`/`context`/`memory`, not a build-time/hook-native
 * concern like `workspace`/`baseline`/`profile`.
 */
const lessonsSchema = z.object({
  store: z.string().optional(),
  ttlMs: z.number().int().nonnegative().optional(),
});

const harnessSchema = z.object({
  guard: z.union([guardSchema, z.literal(false)]).optional(),
  errorHandler: z.union([errorHandlerSchema, z.literal(false)]).optional(),
  enforcer: z.union([enforcerSchema, z.literal(false)]).optional(),
  monitor: z.union([monitorSchema, z.literal(false)]).optional(),
  context: z.union([contextSchema, z.literal(false)]).optional(),
  memory: z.union([memorySchema, z.literal(false)]).optional(),
  execution: z.union([executionSchema, z.literal(false)]).optional(),
  cache: z.union([cacheSchema, z.literal(false)]).optional(),
  lessons: z.union([lessonsSchema, z.literal(false)]).optional(),
});

/**
 * `baseline` is a top-level nim.json sibling of `harness`, not nested under
 * it — linting a memory file is a CI/build-time concern, not a per-call
 * runHarnessed() concern (see docs/prd/12-final-prd-v04.md §6, P4-04).
 */
const baselineSchema = z.object({
  maxLines: z.number().int().positive().optional(),
  blockLines: z.number().int().positive().optional(),
  maxInstructions: z.number().int().positive().optional(),
  mode: z.enum(['warn', 'strict', 'off']).optional(),
  detailDir: z.string().optional(),
});

/**
 * `profile` is a top-level nim.json sibling of `harness` and `baseline` —
 * same sibling-key scoping, same reason: it is a config-resolution input,
 * not a per-call runHarnessed() concern by itself (applyProfile() is called
 * by the project, not injected as a 6th pipeline step).
 */
const profileSchema = z.object({
  tier: z.enum(['frontier', 'open-weight-verified', 'open-weight-untested']).optional(),
  modelHint: z.string().optional(),
  verifiedModelPatterns: z.array(z.string()).optional(),
});

/**
 * `workspace` is a top-level nim.json sibling of `harness`/`baseline`/`profile`
 * — same sibling-key scoping, same reason: it gates a raw Write/Edit tool
 * call from OUTSIDE runHarnessed() entirely (04 §2.4), not a per-call
 * runHarnessed() concern.
 */
export const workspaceSchema = z.object({
  stack: z.array(z.string()).optional(),
  offStackSignalTerms: z.record(z.array(z.string())).optional(),
  clusterWindow: z.number().int().positive().optional(),
  clusterThreshold: z.number().int().positive().optional(),
  existenceOverlapThresholds: z
    .object({ extend: z.number(), compose: z.number(), iterate: z.number() })
    .optional(),
  livenessFile: z.string().optional(),
  livenessCadence: z.string().optional(),
  mode: z.enum(['warn', 'strict', 'off']).optional(),
});

const nimJsonSchema = z.object({
  harness: harnessSchema.optional(),
  baseline: baselineSchema.optional(),
  profile: profileSchema.optional(),
  workspace: workspaceSchema.optional(),
});

/** Validate + fill defaults for the `baseline` nim.json block. Never folded into harnessSchema. */
export function resolveBaselineConfig(input: unknown = {}): {
  maxLines: number;
  blockLines: number;
  maxInstructions: number;
  mode: 'warn' | 'strict' | 'off';
  detailDir: string;
} {
  const parsed = baselineSchema.parse(input ?? {});
  return {
    maxLines: parsed.maxLines ?? 100,
    blockLines: parsed.blockLines ?? 150,
    maxInstructions: parsed.maxInstructions ?? 100,
    mode: parsed.mode ?? 'warn',
    detailDir: parsed.detailDir ?? 'agent_docs',
  };
}

/**
 * Resolved `workspace` shape — `offStackByPath` is derived (not user-facing)
 * from `offStackSignalTerms`'s keys, giving `checkLocationMatch` a
 * path-prefix -> allowed-stack-names RegExp map. `research/` is the one
 * seeded default prefix (matches the Jul-17-incident-shaped location); a
 * project can extend coverage by declaring more `offStackSignalTerms` keys,
 * but nim-skill does not invent additional path prefixes on its own.
 */
export interface ResolvedWorkspaceConfig {
  stack: string[];
  offStackSignalTerms: Record<string, string[]>;
  offStackByPath?: Record<string, RegExp>;
  clusterWindow: number;
  clusterThreshold: number;
  existenceOverlapThresholds: { extend: number; compose: number; iterate: number };
  livenessFile: string;
  livenessCadence: string[];
  mode: 'warn' | 'strict' | 'off';
}

/**
 * Validate + fill defaults for the `workspace` nim.json block. Absent
 * `stack` softens `mode` to `'warn'`-only regardless of the configured mode
 * (04 §2.4's deliberate never-loosen-on-absence asymmetry) — enforced by the
 * hook-adapter/guard layer reading `stack.length === 0`, not by silently
 * rewriting `mode` here (this resolver reports the config as declared).
 */
export function resolveWorkspaceConfig(input: unknown = {}): ResolvedWorkspaceConfig {
  const parsed = workspaceSchema.parse(input ?? {});
  const stack = parsed.stack ?? [];
  const offStackSignalTerms = parsed.offStackSignalTerms ?? {};
  return {
    stack,
    offStackSignalTerms,
    offStackByPath: deriveOffStackByPath(stack),
    clusterWindow: parsed.clusterWindow ?? 8,
    clusterThreshold: parsed.clusterThreshold ?? 3,
    existenceOverlapThresholds: parsed.existenceOverlapThresholds ?? { extend: 50, compose: 80, iterate: 20 },
    livenessFile: parsed.livenessFile ?? '',
    livenessCadence: parsed.livenessCadence ? parsed.livenessCadence.split(',').map((s) => s.trim()) : [],
    mode: parsed.mode ?? 'warn',
  };
}

// ─── Resolved (defaults-filled) shapes ───────────────────────────────────

export interface ResolvedGuard {
  maxCostUsd: number;
  ratePerMin: number;
  allowTools: string[];
  injection: 'off' | 'strict';
}

export interface ResolvedErrorHandler {
  retries: number;
  backoff: ErrorHandlerConfig['backoff'];
  baseDelayMs: number;
  circuitBreaker: { failN: number; cooldownMs: number; windowSize: number } | null;
}

export interface ResolvedEnforcer {
  strategies: VerifyStrategy[];
  maxHeals: number;
  mode: EnforceMode;
  healFeedback: 'minimal' | 'full';
}

export interface ResolvedMonitor {
  exporters: MonitorConfig['exporters'];
  traceFile: string;
  tokenAccounting: boolean;
}

export interface ResolvedContext {
  progressive: boolean;
  maxInputTokens: number;
  onExceed: 'compact' | 'warn' | 'block';
  lean: boolean;
}

export interface ResolvedMemory {
  verifyCache: boolean;
  priors: boolean;
  ttlMs: number;
  store: string;
}

export interface ResolvedExecution {
  isolate: boolean;
  isolateOnRetry: boolean;
}

export interface ResolvedCache {
  provider: CacheProvider;
  strategy: 'prefix' | 'explicit';
  ttl: '5m' | '1h';
  minTokens: number;
  roi: boolean;
  breakEvenReads: number;
  prices: Record<string, { base: number; cachedRead: number }>;
}

export interface ResolvedLessons {
  store: string;
  ttlMs: number;
}

export interface ResolvedHarnessConfig {
  guard: ResolvedGuard | null;
  errorHandler: ResolvedErrorHandler | null;
  enforcer: ResolvedEnforcer | null;
  monitor: ResolvedMonitor | null;
  context: ResolvedContext | null;
  memory: ResolvedMemory | null;
  execution: ResolvedExecution | null;
  cache: ResolvedCache | null;
  lessons: ResolvedLessons | null;
}

// ─── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_TRACE_FILE = process.env.NIM_TRACE_FILE ?? '.nim/traces.jsonl';

function normalizeStrategy(s: VerifyStrategy | string): VerifyStrategy {
  if (typeof s !== 'string') return s;
  // Bare-string shorthand — only param-less kinds are meaningful; others fall
  // through as a minimal object the enforcer runner reports as failing (with a
  // clear reason) rather than silently passing.
  return { kind: s } as VerifyStrategy;
}

function resolveGuard(c: GuardConfig): ResolvedGuard {
  return {
    maxCostUsd: c.maxCostUsd ?? Infinity,
    ratePerMin: c.ratePerMin ?? 60,
    allowTools: c.allowTools ?? ['*'],
    injection: c.injection ?? 'strict',
  };
}

function resolveErrorHandler(c: ErrorHandlerConfig): ResolvedErrorHandler {
  const cb = c.circuitBreaker;
  return {
    retries: c.retries ?? 3,
    backoff: c.backoff ?? 'exp-jitter',
    baseDelayMs: c.baseDelayMs ?? 100,
    circuitBreaker:
      cb === false
        ? null
        : {
            failN: cb?.failN ?? 5,
            cooldownMs: cb?.cooldownMs ?? 60_000,
            windowSize: cb?.windowSize ?? 20,
          },
  };
}

function resolveEnforcer(c: EnforcerConfig): ResolvedEnforcer {
  const mode: EnforceMode = c.mode ?? (c.strict === false ? 'warn' : 'strict');
  return {
    strategies: (c.strategies ?? [{ kind: 'nonempty' }]).map(normalizeStrategy),
    maxHeals: Math.min(Math.max(c.maxHeals ?? 3, 0), 5),
    mode,
    healFeedback: c.healFeedback ?? 'full',
  };
}

function resolveMonitor(c: MonitorConfig): ResolvedMonitor {
  return {
    exporters: c.exporters ?? ['console'],
    traceFile: c.traceFile ?? DEFAULT_TRACE_FILE,
    tokenAccounting: c.tokenAccounting ?? false,
  };
}

function resolveContext(c: ContextConfig): ResolvedContext {
  return {
    progressive: c.progressive ?? true,
    maxInputTokens: c.maxInputTokens ?? Infinity,
    onExceed: c.onExceed ?? 'warn',
    lean: c.lean ?? false,
  };
}

function resolveMemory(c: MemoryConfig): ResolvedMemory {
  return {
    verifyCache: c.verifyCache ?? true,
    priors: c.priors ?? false,
    ttlMs: c.ttlMs ?? 24 * 60 * 60 * 1000,
    store: c.store ?? (process.env.NIM_MEMORY_FILE ?? '.nim/memory.jsonl'),
  };
}

function resolveExecution(c: ExecutionConfig): ResolvedExecution {
  return {
    isolate: c.isolate ?? false,
    isolateOnRetry: c.isolateOnRetry ?? false,
  };
}

/** Provider min-token floors (Qwen/OpenAI 1024, GLM 512, else 1024). */
const MIN_TOKENS: Partial<Record<CacheProvider, number>> = { glm: 512 };

function resolveCache(c: CacheConfig): ResolvedCache {
  const provider = c.provider ?? 'auto';
  return {
    provider,
    strategy: c.strategy ?? 'prefix',
    ttl: c.ttl ?? '5m',
    minTokens: c.minTokens ?? MIN_TOKENS[provider] ?? 1024,
    roi: c.roi ?? true,
    breakEvenReads: c.breakEvenReads ?? 2,
    prices: c.prices ?? {},
  };
}

function resolveLessons(c: LessonsConfig): ResolvedLessons {
  return {
    store: c.store ?? (process.env.NIM_LESSONS_FILE ?? '.nim/lessons.jsonl'),
    ttlMs: c.ttlMs ?? 90 * 24 * 60 * 60 * 1000, // 90d default — lessons outlive a single memory-cache TTL
  };
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Resolve a declarative HarnessConfig into concrete per-layer config, filling
 * defaults. Absent or `false` ⇒ `null` (disabled → no-op passthrough).
 * `enforcer.mode === 'off'` also disables the enforcer.
 */
export function resolveConfig(input: HarnessConfig = {}): ResolvedHarnessConfig {
  const parsed = harnessSchema.parse(input);
  const enforcer = parsed.enforcer ? resolveEnforcer(parsed.enforcer) : null;
  return {
    guard: parsed.guard ? resolveGuard(parsed.guard) : null,
    errorHandler: parsed.errorHandler ? resolveErrorHandler(parsed.errorHandler) : null,
    enforcer: enforcer && enforcer.mode === 'off' ? null : enforcer,
    monitor: parsed.monitor ? resolveMonitor(parsed.monitor) : null,
    context: parsed.context ? resolveContext(parsed.context) : null,
    memory: parsed.memory ? resolveMemory(parsed.memory) : null,
    execution: parsed.execution ? resolveExecution(parsed.execution) : null,
    cache: parsed.cache ? resolveCache(parsed.cache) : null,
    lessons: parsed.lessons ? resolveLessons(parsed.lessons) : null,
  };
}

/** Merge a skill's inline harness over a project nim.json (skill wins per-layer). */
export function mergeHarness(base: HarnessConfig, override: HarnessConfig): HarnessConfig {
  return { ...base, ...override };
}

/**
 * Load the `harness` block from a nim.json in `cwd` (if present). Returns an
 * empty config when the file is absent — never throws on a missing file.
 */
export function loadNimJson(cwd: string = process.cwd()): HarnessConfig {
  const file = resolve(cwd, 'nim.json');
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return nimJsonSchema.parse(raw).harness ?? {};
}

/** Load the `baseline` block from a nim.json in `cwd` (if present). Sibling to loadNimJson, same no-throw-on-missing contract. */
export function loadBaselineJson(cwd: string = process.cwd()): unknown {
  const file = resolve(cwd, 'nim.json');
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return nimJsonSchema.parse(raw).baseline ?? {};
}

/** Load the `profile` block from a nim.json in `cwd` (if present). Sibling to loadNimJson, same no-throw-on-missing contract. */
export function loadProfileJson(cwd: string = process.cwd()): unknown {
  const file = resolve(cwd, 'nim.json');
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return nimJsonSchema.parse(raw).profile ?? {};
}

/** Load the `workspace` block from a nim.json in `cwd` (if present). Sibling to loadNimJson, same no-throw-on-missing contract. */
export function loadWorkspaceJson(cwd: string = process.cwd()): unknown {
  const file = resolve(cwd, 'nim.json');
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return nimJsonSchema.parse(raw).workspace ?? {};
}
