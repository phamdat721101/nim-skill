/**
 * nim-skill — public entrypoint.
 * The one function: runHarnessed(skill, input, ctx) → { output, verified, heals, checks, trace }.
 * Each primitive is also exported standalone.
 */

export const VERSION = '0.18.0';

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
  loadGlobalMemJson,
  resolveGlobalMemConfig,
  loadHooksJson,
  resolveHooksConfig,
  type ResolvedHarnessConfig,
  type ResolvedGuard,
  type ResolvedErrorHandler,
  type ResolvedEnforcer,
  type ResolvedMonitor,
  type ResolvedContext,
  type ResolvedMemory,
  type ResolvedExecution,
  type ResolvedCache,
  type ResolvedGrillConfig,
  type ResolvedCompactConfig,
  type ResolvedSearchConfig,
  type ResolvedGlobalMemConfig,
} from './config.js';

// v0.17 — default lifecycle hooks and repeated-failure auditor
export { AuditorStore } from './hooks/store.js';
export { actionId, failureFingerprint, normalizeText, validateReplan } from './hooks/auditor.js';
export { dispatchHook } from './hooks/dispatch.js';
export { DEFAULT_HOOKS, CANONICAL_HOOK_PROMPT, buildRecall, hookContext } from './hooks/default-profile.js';
export type { HooksConfig, HookHost, HookEvent, FailureInput, AuditorDecision, ReplanInput, AuditorStatus } from './hooks/types.js';

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
export { createSearchHelper, chunkMarkdown, scoreBm25 } from './search/index.js';
export type { MemoryChunk, SearchConfig, SearchHelper, SearchOpts, SearchResultEntry, SearchTrace } from './search/index.js';
export { createCompactor, validateCompactionOutput } from './compact/index.js';
export type { CompactConfig, CompactHelper, CompactionInput, CompactionOutput, CompactionResult } from './compact/index.js';
export { createGlobalMemoryAuditor } from './globalmem/index.js';
export type { DriftReport, GlobalMemoryDeclaration } from './globalmem/index.js';
export { toTerminal, assertTerminal, SerializeGuardError, type TerminalFormat } from './serialize/index.js';
export { createCacheHelper, computeRoi, pickAdapter, parseUsage, type ParsedUsage, type CacheHelperHandle } from './cache/index.js';
export { createWorkspaceGuard, type WorkspaceGuard, type WorkspaceCheckResult, type WorkspaceProposal, type WorkspaceRecommendation } from './workspace/index.js';
export { assessWorkspace, initializeWorkspace, featurePath, createFeatureBrief, appendHandoff, type WorkspaceAssessment, type SetupReport, type HandoffInput, type WorkspaceKind } from './workspace/bootstrap.js';

// v0.6 — workrule
export { createWorkruleHelper, WORKRULE_QUESTIONS, type AgentSupportEntry } from './workrule/index.js';

// v1.1 — product-owner delivery contract
export { deliveryBriefTemplate, runDeliveryCheck, checkEnvironmentContract } from './deliver/index.js';
export type { DeliveryConfig, DeliveryProfileConfig, DeliveryPhase, DeliveryReport, DeliveryCommandRunner } from './deliver/index.js';
export { systemMapPath, systemMapTemplate, parseSystemMap, validateSystemMap, generateThreatMatrix, verifySystemMap, format3LineHandover, EDGE_IDS } from './deliver/index.js';
export type { SystemMap, SystemMapStatus, DeliveryTaskType, ThreatVector, EdgeProof, DeliveryVerifyReport, DeliveryTestRunner } from './deliver/index.js';

// v1.0 — grill
export {
  createGrillHelper,
  createGrillStore,
  compilePRD,
  formatPRDMarkdown,
  loadQuestionsForDomain,
  DOMAIN_QUESTIONS,
  X402_QUESTIONS,
  XLS65_QUESTIONS,
  GENERIC_QUESTIONS,
  sessionIdFor,
  writePRDFile,
} from './grill/index.js';
export type {
  GrillSession,
  GrillQuestion,
  GrillAnswer,
  GrillPRD,
  GrillConfig,
  GrillHelper,
} from './grill/types.js';

// v0.18 — system architecture review and design
export {
  calculateCyclomatic,
  scoreModuleDepth,
  auditRedFlags,
  groundArchitecture,
  sketchArchitecture,
  DecisionLedger,
  DecisionRecordSchema,
  compileArchitecture,
  type ArchitectCritique,
  type DecisionRecord,
  type DesignSketch,
  type GroundReport,
  type ModuleDepthReport,
  type RedFlagViolation,
} from './architect/index.js';
