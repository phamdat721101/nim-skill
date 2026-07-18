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
} from './types.js';
import {
  resolveConfig,
  type ResolvedEnforcer,
  type ResolvedErrorHandler,
  type ResolvedHarnessConfig,
} from '../config.js';
import { createGuard } from '../guard/guard.js';
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
function buildRunCtx(ctx: SkillContext, cfg: ResolvedHarnessConfig): {
  runCtx: SkillContext;
  getCacheUsage: () => ReturnType<ReturnType<typeof createCacheHelper>['getRecorded']>;
  getLessonsMatch: () => LessonsMatchTrace | undefined;
} {
  const enabled = cfg.cache || cfg.context || cfg.memory || cfg.execution?.isolate || cfg.lessons;
  if (!enabled) return { runCtx: ctx, getCacheUsage: () => null, getLessonsMatch: () => undefined };

  // Isolation (U2): a cloned ctx keeps intermediate/retry state out of the caller's ctx.
  const runCtx: SkillContext = { ...ctx };
  const cacheHandle = createCacheHelper(cfg.cache, { baseUrl: ctx.baseUrl as string, model: ctx.model as string });
  if (cfg.cache) runCtx.cache = cacheHandle.helper;
  if (cfg.context) runCtx.context = createContextHelper(cfg.context);
  if (cfg.memory) runCtx.memory = createMemoryHelper(cfg.memory);

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

  return {
    runCtx,
    getCacheUsage: () => cacheHandle.getRecorded(),
    getLessonsMatch: () => (seen.ids.length ? { matchedLessonIds: [...seen.ids], severity: seen.severity } : undefined),
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
  const { runCtx, getCacheUsage, getLessonsMatch } = buildRunCtx(ctx, cfg);

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

  // ①② guard + ②b context budget — a breach captures a 'denied' trace and rethrows.
  let validated: Dict;
  try {
    const guard = createGuard(cfg.guard);
    validated = guard.validate(input);
    guard.checkPolicy({ agentId: ctx.agentId, tool: skill.name });
    if (runCtx.context) runCtx.context.budget(estimateTokensOf(validated));
  } catch (err) {
    emit({ status: 'denied', durationMs: dur(), ...roiFields('denied', undefined, false, 0, undefined) });
    throw err;
  }

  // ③ execute (+ error-handler)
  let output: O;
  try {
    output = await execute<O>(skill, validated, runCtx, cfg.errorHandler);
  } catch (err) {
    const cls = err instanceof HarnessExecutionError ? err.error.class : classify(err).class;
    const trace = emit({ status: 'error', durationMs: dur(), errorClass: cls, ...roiFields('error', cls, false, 0, undefined) });
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
  const trace = emit({
    status: 'success',
    durationMs: dur(),
    ...(cfg.enforcer ? { verifyPassed: enforced.verified, healCount: enforced.heals } : {}),
    ...roiFields('success', undefined, enforced.verified, enforced.heals, enforced.output),
    ...(cacheTrace ? { cache: cacheTrace } : {}),
    ...(lessonsMatch ? { lessonsMatch } : {}),
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
