/**
 * src/harness/runtime.ts
 * ----------------------
 * runHarnessed() — the one function every harnessed run passes through:
 *   ① guard.validate(input)      Zod + agentjacking → throws GuardError
 *   ② guard.checkPolicy(ctx)     cost / rate / allowlist → throws GuardError
 *   ③ errorHandler.run(          classify → retry/backoff/breaker/fallback/escalate
 *        skill.execute)          the author's logic
 *   ④ enforcer.verifyOrHeal      block-before-ship + bounded self-heal
 *   ⑤ monitor.capture(trace)     + return { output, verified, heals, checks, trace }
 *
 * Each layer is config-gated: a disabled layer is a no-op passthrough, so a
 * fully-disabled harness is byte-identical to a bare skill run (rollback
 * contract). A trace is always captured — on deny, on error, and on success.
 */

import type {
  SkillDef,
  SkillContext,
  HarnessResult,
  TraceRecord,
  ClassifiedError,
  RunStatus,
} from './types.js';
import { resolveConfig, type ResolvedEnforcer, type ResolvedErrorHandler } from '../config.js';
import { createGuard } from '../guard/guard.js';
import { run, createBreaker } from '../error-handler/recover.js';
import { classify } from '../error-handler/classify.js';
import { createMonitor } from '../monitor/capture.js';
import { newTraceId, buildTrace, type TraceFields } from '../monitor/wrap.js';
import { verifyOrHeal } from '../enforcer/output-enforcer.js';

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

async function enforce<O extends Dict>(
  skill: SkillDef<Dict, O>,
  output: O,
  input: Dict,
  ctx: SkillContext,
  enf: ResolvedEnforcer | null,
): Promise<{ verified: boolean; heals: number; checks: HarnessResult['checks']; output: O }> {
  if (!enf) return { verified: true, heals: 0, checks: [], output };
  const vr = await verifyOrHeal(output, enf, {
    reExecute: (feedback) => skill.execute(input, { ...ctx, _feedback: feedback }),
  });
  return { verified: vr.verified, heals: vr.heals, checks: vr.checks, output: vr.output as O };
}

/**
 * Run a skill through the full harness and return a structured envelope.
 * Throws GuardError on a guard breach and HarnessExecutionError on an
 * unrecoverable execution failure — both after capturing a trace.
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

  const emit = (fields: TraceFields): TraceRecord => {
    const trace = buildTrace({ skill: skill.name, traceId, startedAt }, fields);
    monitor.capture(trace);
    return trace;
  };
  const dur = () => Date.now() - startedAt;
  const denied = (): RunStatus => 'denied';

  // ①② guard — a breach captures a 'denied' trace and rethrows.
  let validated: Dict;
  try {
    const guard = createGuard(cfg.guard);
    validated = guard.validate(input);
    guard.checkPolicy({ agentId: ctx.agentId, tool: skill.name });
  } catch (err) {
    emit({ status: denied(), durationMs: dur() });
    throw err;
  }

  // ③ execute (+ error-handler)
  let output: O;
  try {
    output = await execute<O>(skill, validated, ctx, cfg.errorHandler);
  } catch (err) {
    const cls = err instanceof HarnessExecutionError ? err.error.class : classify(err).class;
    const trace = emit({ status: 'error', durationMs: dur(), errorClass: cls });
    if (err instanceof HarnessExecutionError) {
      err.trace = trace;
      throw err;
    }
    throw new HarnessExecutionError(
      { class: cls, message: classify(err).message, cause: err, retryable: cls === 'transient', attempts: 1 },
      trace,
    );
  }

  // ④ enforcer
  const enforced = await enforce<O>(skill, output, validated, ctx, cfg.enforcer);

  // ⑤ success trace + envelope
  const trace = emit({
    status: 'success',
    durationMs: dur(),
    ...(cfg.enforcer ? { verifyPassed: enforced.verified, healCount: enforced.heals } : {}),
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
