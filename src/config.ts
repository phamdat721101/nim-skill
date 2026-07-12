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
});

const monitorSchema = z.object({
  exporters: z.array(z.enum(['console', 'file', 'sentry'])).optional(),
  traceFile: z.string().optional(),
});

const harnessSchema = z.object({
  guard: z.union([guardSchema, z.literal(false)]).optional(),
  errorHandler: z.union([errorHandlerSchema, z.literal(false)]).optional(),
  enforcer: z.union([enforcerSchema, z.literal(false)]).optional(),
  monitor: z.union([monitorSchema, z.literal(false)]).optional(),
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
}

export interface ResolvedMonitor {
  exporters: MonitorConfig['exporters'];
  traceFile: string;
}

export interface ResolvedHarnessConfig {
  guard: ResolvedGuard | null;
  errorHandler: ResolvedErrorHandler | null;
  enforcer: ResolvedEnforcer | null;
  monitor: ResolvedMonitor | null;
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
  };
}

function resolveMonitor(c: MonitorConfig): ResolvedMonitor {
  return {
    exporters: c.exporters ?? ['console'],
    traceFile: c.traceFile ?? DEFAULT_TRACE_FILE,
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
