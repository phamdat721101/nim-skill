/**
 * nim-skill — public entrypoint.
 * The one function: runHarnessed(skill, input, ctx) → { output, verified, heals, checks, trace }.
 * Each primitive is also exported standalone.
 */

export const VERSION = '0.6.0';

// Core
export { runHarnessed, HarnessExecutionError } from './harness/runtime.js';
export type * from './harness/types.js';

// Config
export {
  resolveConfig,
  mergeHarness,
  loadNimJson,
  loadBaselineJson,
  resolveBaselineConfig,
  loadWorkspaceJson,
  resolveWorkspaceConfig,
  loadWorkruleJson,
  resolveWorkruleConfig,
  type ResolvedHarnessConfig,
  type ResolvedGuard,
  type ResolvedErrorHandler,
  type ResolvedEnforcer,
  type ResolvedMonitor,
  type ResolvedContext,
  type ResolvedMemory,
  type ResolvedExecution,
  type ResolvedCache,
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
export {
  renderDashboard,
  summarize,
  summarizeSavings,
  summarizeCache,
  parseTraces,
  type DashboardView,
} from './monitor/dashboard.js';
export { computeTokenRoi, type TokenRoi } from './monitor/roi.js';

// Enforcer
export { verifyOrHeal, defaultCommandRunner, type CommandRunner, type EnforceConfig } from './enforcer/output-enforcer.js';

// v0.2 / v0.3 — see / remember / serialize / cache
export { estimateTokens, estimateTokensOf } from './tokens.js';
export { createContextHelper, ContextBudgetError } from './context/index.js';
export { createMemoryHelper, verifyKey } from './memory/index.js';
export { toTerminal, assertTerminal, SerializeGuardError, type TerminalFormat } from './serialize/index.js';
export { createCacheHelper, computeRoi, pickAdapter, parseUsage, type ParsedUsage, type CacheHelperHandle } from './cache/index.js';

// v0.6 — workrule
export { createWorkruleHelper, WORKRULE_QUESTIONS, type AgentSupportEntry } from './workrule/index.js';
