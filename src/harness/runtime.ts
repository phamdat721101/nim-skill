/**
 * src/harness/runtime.ts
 * ----------------------
 * runHarnessed() — the one function every harnessed run passes through:
 *   ① guard.validate(input)      Zod + agentjacking → throws GuardError
 *   ② guard.checkPolicy(ctx)     cost / rate / allowlist → throws GuardError
 *   ②b context.budget(est)       per-run token budget (U1) → may throw ContextBudgetError
 *   ③ errorHandler.run(          classify → retry/backoff/breaker/fallback/escalate
 *        skill.execute)          the author's logic (ctx carries cache/context/memory helpers)
 *   ④ enforcer.verifyOrHeal      block-before-ship + bounded self-heal (U4 verify-cache short-circuit)
 *   ⑤ monitor.capture(trace)     + token-ROI (U3) + cache-ROI (v0.3) → { output, verified, heals, checks, trace }
 *
 * Each layer is config-gated: a disabled layer is a no-op passthrough, so a
 * fully-disabled harness is byte-identical to a bare skill run (rollback
 * contract). New v0.2/v0.3 helpers are injected into ctx ONLY when enabled, so
 * an all-off run leaves ctx and the trace untouched.
 */

import type {
  SkillDef,
  SkillContext,
  HarnessResult,
  TraceRecord,
  ClassifiedError,
  RunStatus,
  ErrorClass,
  LessonsMatchTrace,
  LogCompactResult,
} from './types.js';
import {
  resolveConfig,
  type ResolvedEnforcer,
  type ResolvedErrorHandler,
  type ResolvedHarnessConfig,
} from '../config.js';
import { createGuard } from '../guard/guard.js';
import { checkProposal } from '../guard/propose.js';
import { basePricePerToken } from '../cache/roi.js';
import { run, createBreaker } from '../error-handler/recover.js';
import { classify } from '../error-handler/classify.js';
import { createMonitor } from '../monitor/capture.js';
import { newTraceId, buildTrace, type TraceFields } from '../monitor/wrap.js';
import { computeTokenRoi } from '../monitor/roi.js';
import { verifyOrHeal } from '../enforcer/output-enforcer.js';
import { createContextHelper } from '../context/index.js';
import { createMemoryHelper, verifyKey } from '../memory/index.js';
import { createCacheHelper, computeRoi } from '../cache/index.js';
import { createLessonsHelper } from '../lessons/index.js';
import { createLogCompactHelper } from '../logcompact/index.js';
import { createBudgetHelper } from '../guard/budget.js';
import { estimateTokensOf } from '../tokens.js';

type Dict = Record<string, unknown>;

/** Thrown when execution fails unrecoverably. Carries the classified error + trace. */
export class HarnessExecutionError extends Error {
  trace?: TraceRecord;
  constructor(readonly error: ClassifiedError, trace?: TraceRecord) {
    super(`[${error.class}] ${error.message}`);
    this.name = 'HarnessExecutionError';
    this.trace = trace;
  }
}

async function execute<O extends Dict>(
  skill: SkillDef<Dict, O>,
  input: Dict,
  ctx: SkillContext,
  eh: ResolvedErrorHandler | null,
  onEscalate?: (e: ClassifiedError) => void,
): Promise<O> {
  if (!eh) return await skill.execute(input, ctx);
  const res = await run(() => skill.execute(input, ctx), eh, {
    key: skill.name,
    breaker: createBreaker(eh),
    onEscalate,
  });
  if (res.ok) return res.value;
  throw new HarnessExecutionError(res.error);
}

/** Thrown when the v0.8 duration cap (`guard.maxDurationMs`) elapses. Classified as ErrorClass 'timeout'. */
export class TimeoutError extends Error {
  readonly class = 'timeout' as const;
  constructor(maxDurationMs: number) {
    super(`execution exceeded the ${maxDurationMs}ms duration cap`);
    this.name = 'TimeoutError';
  }
}

/**
 * v0.8 — race `execute()` against a timer that fires at `maxDurationMs`.
 * Cooperative cancellation only (decision 3): the AbortController's signal is
 * exposed to the skill via `ctx.signal`, but a skill that never checks/awaits
 * it keeps running past the cap — this race only changes what runHarnessed()
 * itself observes and reports, never forcibly kills in-flight work. The timer
 * is ALWAYS cleared (success, error, or timeout) so no handle leaks across
 * repeated runs.
 */
async function executeWithTimeout<O extends Dict>(
  skill: SkillDef<Dict, O>,
  input: Dict,
  ctx: SkillContext,
  eh: ResolvedErrorHandler | null,
  maxDurationMs: number | null,
  controller: AbortController | null,
  onEscalate?: (e: ClassifiedError) => void,
): Promise<O> {
  if (!maxDurationMs || !controller) return execute<O>(skill, input, ctx, eh, onEscalate);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(maxDurationMs));
    }, maxDurationMs);
  });

  try {
    return await Promise.race([execute<O>(skill, input, ctx, eh, onEscalate), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type Enforced<O> = { verified: boolean; heals: number; checks: HarnessResult['checks']; output: O };

async function enforce<O extends Dict>(
  skill: SkillDef<Dict, O>,
  output: O,
  input: Dict,
  ctx: SkillContext,
  enf: ResolvedEnforcer | null,
): Promise<Enforced<O>> {
  if (!enf) return { verified: true, heals: 0, checks: [], output };
  const vr = await verifyOrHeal(output, enf, {
    reExecute: (feedback) => skill.execute(input, { ...ctx, _feedback: feedback }),
  });
  return { verified: vr.verified, heals: vr.heals, checks: vr.checks, output: vr.output as O };
}

/** Enforce with the U4 verify-result cache: an unchanged output skips re-verification. */
async function enforceWithMemory<O extends Dict>(
  skill: SkillDef<Dict, O>,
  output: O,
  input: Dict,
  ctx: SkillContext,
  cfg: ResolvedHarnessConfig,
): Promise<Enforced<O>> {
  if (!cfg.enforcer || !cfg.memory || !ctx.memory) return enforce(skill, output, input, ctx, cfg.enforcer);
  const key = verifyKey(output, cfg.enforcer.strategies);
  if (ctx.memory.getVerify(key) === true) return { verified: true, heals: 0, checks: [], output };
  const result = await enforce(skill, output, input, ctx, cfg.enforcer);
  ctx.memory.setVerify(key, result.verified);
  return result;
}

/** Build the run ctx, injecting only the helpers whose layer is enabled. */
function buildRunCtx(
  ctx: SkillContext,
  cfg: ResolvedHarnessConfig,
  isTimedOut: () => boolean = () => false,
): {
  runCtx: SkillContext;
  getCacheUsage: () => ReturnType<ReturnType<typeof createCacheHelper>['getRecorded']>;
  getLessonsMatch: () => LessonsMatchTrace | undefined;
  getBudgetSpentUsd: () => number | undefined;
  getLogCompact: () => LogCompactResult | undefined;
} {
  const hasBudget = !!cfg.guard?.taskBudget;
  const enabled = cfg.cache || cfg.context || cfg.memory || cfg.execution?.isolate || cfg.lessons || cfg.logCompact || hasBudget;
  if (!enabled) {
    return {
      runCtx: ctx,
      getCacheUsage: () => null,
      getLessonsMatch: () => undefined,
      getBudgetSpentUsd: () => undefined,
      getLogCompact: () => undefined,
    };
  }

  // Isolation (U2): a cloned ctx keeps intermediate/retry state out of the caller's ctx.
  const runCtx: SkillContext = { ...ctx };
  const cacheHandle = createCacheHelper(cfg.cache, { baseUrl: ctx.baseUrl as string, model: ctx.model as string });
  if (cfg.cache) runCtx.cache = cacheHandle.helper;
  if (cfg.context) runCtx.context = createContextHelper(cfg.context);
  if (cfg.memory) runCtx.memory = createMemoryHelper(cfg.memory);

  // v0.8 nim-guard — ctx.budget: opt-in live spend accumulation against the
  // SAME per-task cap Task 2's pre-flight check used. Injected only when a
  // task budget is configured (byte-identical-off otherwise).
  let budgetHelper: ReturnType<typeof createBudgetHelper> | undefined;
  if (hasBudget && cfg.guard?.taskBudget) {
    budgetHelper = createBudgetHelper(cfg.guard.taskBudget.usd, isTimedOut);
    runCtx.budget = budgetHelper;
  }

  // v0.5 nim-lessons — track captured/matched lesson ids this run so the trace can
  // report them additively, mirroring how cacheHandle.getRecorded() feeds cacheTrace.
  const seen: { ids: string[]; severity: LessonsMatchTrace['severity'] } = { ids: [], severity: null };
  if (cfg.lessons) {
    const helper = createLessonsHelper(cfg.lessons);
    runCtx.lessons = {
      check(shape) {
        const matches = helper.check(shape);
        for (const m of matches) seen.ids.push(m.id);
        if (matches.some((m) => m.severity === 'critical')) seen.severity = 'critical';
        else if (!seen.severity && matches.some((m) => m.severity === 'warning')) seen.severity = 'warning';
        else if (!seen.severity && matches.length) seen.severity = 'info';
        return matches;
      },
      capture(entry) {
        const lesson = helper.capture(entry);
        seen.ids.push(lesson.id);
        if (lesson.severity === 'critical' || !seen.severity) seen.severity = lesson.severity;
        return lesson;
      },
    };
  }

  // v0.9 nim-logcompact — AGGREGATE across every compact() call this run
  // (sum chars, then re-derive reductionPct from the totals), not
  // last-call-wins: a skill calling compact() more than once per run (e.g.
  // cli.run compacting stdout AND stderr separately) would otherwise have an
  // earlier meaningful result silently overwritten by a later, possibly-
  // empty one (found via manual verification of `nim-skill run --logcompact
  // --monitor` reporting 0 chars despite stdout clearly being compacted —
  // stderr's empty-string compact() call ran second and clobbered it).
  const logCompactTotals = { originalChars: 0, compactedChars: 0, calls: 0 };
  if (cfg.logCompact) {
    const helper = createLogCompactHelper(cfg.logCompact);
    runCtx.logCompact = {
      compact(raw) {
        const result = helper.compact(raw);
        logCompactTotals.originalChars += result.originalChars;
        logCompactTotals.compactedChars += result.compactedChars;
        logCompactTotals.calls += 1;
        return result;
      },
    };
  }

  return {
    runCtx,
    getCacheUsage: () => cacheHandle.getRecorded(),
    getLessonsMatch: () => (seen.ids.length ? { matchedLessonIds: [...seen.ids], severity: seen.severity } : undefined),
    getBudgetSpentUsd: () => budgetHelper?.spentUsd(),
    getLogCompact: () => {
      if (logCompactTotals.calls === 0) return undefined;
      const { originalChars, compactedChars } = logCompactTotals;
      const reductionPct = originalChars === 0 ? 0 : Math.max(0, Math.round(((originalChars - compactedChars) / originalChars) * 100));
      return { text: '', originalChars, compactedChars, reductionPct };
    },
  };
}

/**
 * Run a skill through the full harness and return a structured envelope.
 * Throws GuardError / ContextBudgetError on a pre-execution block and
 * HarnessExecutionError on an unrecoverable execution failure — all after
 * capturing a trace.
 */
export async function runHarnessed<O extends Dict = Dict>(
  skill: SkillDef<Dict, O>,
  input: Dict,
  ctx: SkillContext,
): Promise<HarnessResult<O>> {
  const cfg = resolveConfig(skill.harness);
  const monitor = createMonitor(cfg.monitor);
  const traceId = newTraceId();
  const startedAt = Date.now();

  // v0.8 — the AbortController backing ctx.signal + ctx.budget.timedOut(),
  // created only when guard.maxDurationMs is configured (byte-identical-off
  // otherwise — no timer, no controller, no new ctx field at all).
  const maxDurationMs = cfg.guard?.maxDurationMs ?? null;
  const controller = maxDurationMs ? new AbortController() : null;
  const isTimedOut = () => controller?.signal.aborted ?? false;

  const { runCtx, getCacheUsage, getLessonsMatch, getBudgetSpentUsd, getLogCompact } = buildRunCtx(ctx, cfg, isTimedOut);
  if (controller) runCtx.signal = controller.signal;

  const accounting = !!(cfg.monitor?.tokenAccounting || cfg.context);
  const roiFields = (status: RunStatus, errorClass: ErrorClass | undefined, verified: boolean, heals: number, out: unknown): Partial<TraceFields> => {
    if (!accounting) return {};
    const baseline = estimateTokensOf(input) + estimateTokensOf(out);
    return computeTokenRoi({ status, errorClass, verified, heals, baselineTokens: baseline });
  };

  const emit = (fields: TraceFields): TraceRecord => {
    const trace = buildTrace({ skill: skill.name, traceId, startedAt }, fields);
    monitor.capture(trace);
    return trace;
  };
  const dur = () => Date.now() - startedAt;

  // v0.8 nim-guard — build the BudgetTrace only when a per-task budget is
  // configured (additive/optional, same precedent as cache/disclosure/
  // lessonsMatch). Always reports BOTH units (decision 6), using the
  // resolved cap (Task 1/2) + whatever ctx.budget.spend() accumulated
  // (Task 3) + the AbortController's final state (Task 4).
  const provider = basePricePerToken('anthropic');
  const budgetTrace = (): TraceRecord['budget'] => {
    const cap = cfg.guard?.taskBudget;
    if (!cap) return undefined;
    const spentUsd = getBudgetSpentUsd() ?? 0;
    return {
      capUsd: cap.usd,
      spentUsd,
      capTokensEquivalent: cap.tokens,
      spentTokensEquivalent: Math.round(spentUsd / provider),
      timedOut: isTimedOut(),
    };
  };

  // v0.9 nim-propose — build the ProposalTrace only when guard.propose is
  // configured (additive/optional, same precedent as budgetTrace above).
  // Re-derives the SAME check guard.checkPolicy() already performed
  // (skill.name as the task description, matching the checkPolicy call
  // below) purely for trace-reporting purposes — decoupled from GuardError,
  // which only carries a reason string, not the structured check result.
  const proposalTrace = (): TraceRecord['proposal'] => {
    const cfg9 = cfg.guard?.propose;
    if (!cfg9) return undefined;
    const result = checkProposal(skill.name, cfg9);
    return { required: true, approved: result.approved, ...(result.reason ? { reason: result.reason } : {}) };
  };

  // ①② guard + ②b context budget — a breach captures a 'denied' trace and rethrows.
  let validated: Dict;
  try {
    const guard = createGuard(cfg.guard);
    validated = guard.validate(input);
    // v0.8 — pre-flight per-task budget estimate: approximate cost of the
    // validated input against the resolved per-task cap (decision 5a). This
    // is a cheap, input-size-only estimate; ctx.budget.spend() (Task 3) adds
    // live/actual accumulation on top for skills that opt in. Deliberately
    // passed as `taskCostUsd`, NOT `costUsd` — orthogonal to the existing
    // cumulative maxCostUsd check (decision 4), which keeps its v0.1-v0.7
    // default-0 behavior unchanged at this call site.
    const preflightCostUsd = cfg.guard?.taskBudget
      ? estimateTokensOf(validated) * basePricePerToken('anthropic')
      : 0;
    guard.checkPolicy({ agentId: ctx.agentId, tool: skill.name, taskCostUsd: preflightCostUsd, taskDescription: skill.name });
    if (runCtx.context) runCtx.context.budget(estimateTokensOf(validated));
  } catch (err) {
    emit({
      status: 'denied',
      durationMs: dur(),
      ...roiFields('denied', undefined, false, 0, undefined),
      ...(budgetTrace() ? { budget: budgetTrace() } : {}),
      ...(proposalTrace() ? { proposal: proposalTrace() } : {}),
    });
    throw err;
  }

  // ③ execute (+ error-handler, + v0.8 cooperative duration cap)
  let output: O;
  try {
    output = await executeWithTimeout<O>(skill, validated, runCtx, cfg.errorHandler, maxDurationMs, controller);
  } catch (err) {
    const cls = err instanceof HarnessExecutionError ? err.error.class : classify(err).class;
    const trace = emit({ status: 'error', durationMs: dur(), errorClass: cls, ...roiFields('error', cls, false, 0, undefined), ...(budgetTrace() ? { budget: budgetTrace() } : {}) });
    if (err instanceof HarnessExecutionError) {
      err.trace = trace;
      throw err;
    }
    throw new HarnessExecutionError(
      { class: cls, message: classify(err).message, cause: err, retryable: cls === 'transient', attempts: 1 },
      trace,
    );
  }

  // ④ enforcer (with U4 verify-cache short-circuit)
  const enforced = await enforceWithMemory<O>(skill, output, validated, runCtx, cfg);

  // v0.3 cache-ROI: fold the provider usage the skill recorded into the trace.
  const usage = getCacheUsage();
  const cacheTrace =
    cfg.cache && cfg.cache.roi && usage
      ? computeRoi(usage, {
          provider: cfg.cache.provider,
          strategy: cfg.cache.strategy,
          breakEvenReads: cfg.cache.breakEvenReads,
          prices: cfg.cache.prices,
        })
      : undefined;

  // ⑤ success trace + envelope
  const lessonsMatch = getLessonsMatch();
  const budget = budgetTrace();
  const logCompact = getLogCompact();
  const proposal = proposalTrace();
  const trace = emit({
    status: 'success',
    durationMs: dur(),
    ...(cfg.enforcer ? { verifyPassed: enforced.verified, healCount: enforced.heals } : {}),
    ...roiFields('success', undefined, enforced.verified, enforced.heals, enforced.output),
    ...(cacheTrace ? { cache: cacheTrace } : {}),
    ...(lessonsMatch ? { lessonsMatch } : {}),
    ...(budget ? { budget } : {}),
    ...(logCompact ? { logCompact } : {}),
    ...(proposal ? { proposal } : {}),
  });

  return {
    skill: skill.name,
    output: enforced.output,
    verified: enforced.verified,
    heals: enforced.heals,
    checks: enforced.checks,
    trace,
  };
}
