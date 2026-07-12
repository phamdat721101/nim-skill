/**
 * nim-skill — public entrypoint.
 * The one function: runHarnessed(skill, input, ctx) → { output, verified, heals, checks, trace }.
 * Each primitive is also exported standalone.
 */

export const VERSION = '0.1.0';

// Core
export { runHarnessed, HarnessExecutionError } from './harness/runtime.js';
export type * from './harness/types.js';

// Config
export {
  resolveConfig,
  mergeHarness,
  loadNimJson,
  type ResolvedHarnessConfig,
  type ResolvedGuard,
  type ResolvedErrorHandler,
  type ResolvedEnforcer,
  type ResolvedMonitor,
} from './config.js';

// Guard
export { createGuard, GuardError, type Guard, type GuardReason } from './guard/guard.js';
export { looksLikePromptInjection, scanPayload } from './guard/injection.js';

// Error handler
export { run as recover, createBreaker } from './error-handler/recover.js';
export { classify, isRetryable } from './error-handler/classify.js';
export { CircuitBreaker } from './error-handler/circuit-breaker.js';

// Monitor
export { createMonitor, type Monitor, type EventSink } from './monitor/capture.js';
export { wrap, buildTrace, newTraceId } from './monitor/wrap.js';
export { renderDashboard, summarize, parseTraces } from './monitor/dashboard.js';

// Enforcer
export { verifyOrHeal, defaultCommandRunner, type CommandRunner, type EnforceConfig } from './enforcer/output-enforcer.js';
