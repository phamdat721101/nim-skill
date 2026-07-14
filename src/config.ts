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

const harnessSchema = z.object({
  guard: z.union([guardSchema, z.literal(false)]).optional(),
  errorHandler: z.union([errorHandlerSchema, z.literal(false)]).optional(),
  enforcer: z.union([enforcerSchema, z.literal(false)]).optional(),
  monitor: z.union([monitorSchema, z.literal(false)]).optional(),
  context: z.union([contextSchema, z.literal(false)]).optional(),
  memory: z.union([memorySchema, z.literal(false)]).optional(),
  execution: z.union([executionSchema, z.literal(false)]).optional(),
  cache: z.union([cacheSchema, z.literal(false)]).optional(),
});

const nimJsonSchema = z.object({ harness: harnessSchema.optional() });

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

export interface ResolvedHarnessConfig {
  guard: ResolvedGuard | null;
  errorHandler: ResolvedErrorHandler | null;
  enforcer: ResolvedEnforcer | null;
  monitor: ResolvedMonitor | null;
  context: ResolvedContext | null;
  memory: ResolvedMemory | null;
  execution: ResolvedExecution | null;
  cache: ResolvedCache | null;
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
