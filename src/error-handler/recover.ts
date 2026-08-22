/**
 * src/error-handler/recover.ts
 * ----------------------------
 * run(fn, policy) executes `fn` with error-recovery discipline:
 *   transient → retry with backoff (exp-jitter/fixed/none), bounded by retries;
 *               a shared circuit breaker short-circuits repeated failures.
 *   permanent → not retried → graceful fallback (if provided) else classified error.
 *   critical  → escalate (onEscalate hook) + return immediately; never retried,
 *               never silently swallowed.
 * Returns Result<T> — never throws an unclassified error.
 *
 * v0.13 — `classify()`'s full return value (including optional `errorType`/
 * `actionRequired`) is spread into every constructed `ClassifiedError`, so a
 * remediation match propagates to the caller automatically. `RecoverOptions.
 * remediationRules` is forwarded to `classify()`'s 3rd param.
 */

import type { Result, ClassifiedError } from '../harness/types.js';
import type { ResolvedErrorHandler } from '../config.js';
import { classify, isRetryable } from './classify.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type { RemediationRule } from './remediation.js';

export interface RecoverOptions<T> {
  /** Breaker key (usually the skill name). Enables breaker when a breaker exists. */
  key?: string;
  breaker?: CircuitBreaker;
  /** Graceful fallback for permanent / exhausted-transient failures. */
  fallback?: () => Promise<T> | T;
  /** Clean human/critical handoff. Called before returning a critical error. */
  onEscalate?: (error: ClassifiedError) => void;
  /** Injectable delay (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  expectedErrorPatterns?: readonly RegExp[] | null;
  /** One read-only probe for an error outside the skill's declared failure vocabulary. */
  diagnose?: (error: unknown) => Promise<unknown> | unknown;
  /** v0.13 — user-supplied remediation rules, forwarded to classify()'s 3rd param. */
  remediationRules?: readonly RemediationRule[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function backoffMs(kind: ResolvedErrorHandler['backoff'], base: number, attempt: number): number {
  if (kind === 'none') return 0;
  if (kind === 'fixed') return base;
  // exp-jitter: base * 2^attempt, jittered to [50%, 100%].
  const exp = base * 2 ** attempt;
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

function fail<T>(classified: { class: ClassifiedError['class']; message: string; errorType?: string; actionRequired?: string }, attempts: number, cause?: unknown): Result<T> {
  return { ok: false, error: { ...classified, cause, retryable: isRetryable(classified.class), attempts } };
}

export function createBreaker(policy: ResolvedErrorHandler): CircuitBreaker | undefined {
  const cb = policy.circuitBreaker;
  return cb ? new CircuitBreaker(cb.failN, cb.cooldownMs, cb.windowSize) : undefined;
}

export async function run<T>(
  fn: () => Promise<T> | T,
  policy: ResolvedErrorHandler,
  opts: RecoverOptions<T> = {},
): Promise<Result<T>> {
  const sleep = opts.sleep ?? defaultSleep;
  const key = opts.key ?? 'default';
  const breaker = opts.breaker;
  let attempts = 0;

  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    if (breaker?.isOpen(key)) {
      return fail<T>({ class: 'transient', message: `circuit breaker open for '${key}'` }, attempts);
    }

    try {
      const value = await fn();
      breaker?.record(key, true);
      return { ok: true, value };
    } catch (err) {
      attempts += 1;
      let classified = classify(err, opts.expectedErrorPatterns, opts.remediationRules);
      if (classified.class === 'ambiguous' && opts.diagnose) {
        try {
          const diagnosis = await opts.diagnose(err);
          classified = classify(diagnosis, undefined, opts.remediationRules);
        } catch (diagnosisError) {
          classified = classify(diagnosisError, undefined, opts.remediationRules);
        }
      }
      const { class: cls } = classified;

      if (cls === 'critical') {
        const error: ClassifiedError = { ...classified, cause: err, retryable: false, attempts };
        opts.onEscalate?.(error);
        return { ok: false, error };
      }

      if (cls === 'transient') {
        breaker?.record(key, false);
        if (attempt < policy.retries) {
          await sleep(backoffMs(policy.backoff, policy.baseDelayMs, attempt));
          continue;
        }
      }
      // permanent/ambiguous, or transient with retries exhausted → fallback or classified error.
      if (opts.fallback) {
        return { ok: true, value: await opts.fallback() };
      }
      return fail<T>(classified, attempts, err);
    }
  }

  // retries < 0 (defensive) — no attempt ran.
  return fail<T>({ class: 'permanent', message: 'no attempt executed' }, attempts);
}
