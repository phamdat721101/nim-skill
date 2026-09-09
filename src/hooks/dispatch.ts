import { classify } from '../error-handler/classify.js';
import { redactSecretText } from '../security/secrets.js';
import { createLessonsHelper } from '../lessons/index.js';
import { loadNimJson, loadWorkruleJson, resolveConfig, resolveWorkruleConfig } from '../config.js';
import { createWorkruleHelper, WORKRULE_QUESTIONS } from '../workrule/index.js';
import { appendHandoff } from '../workspace/bootstrap.js';
import { DEFAULT_HOOKS, hookContext } from './default-profile.js';
import { AuditorStore } from './store.js';
import type { HookEvent, HookHost, HooksConfig } from './types.js';

function text(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value ?? ''); }
function toolAction(payload: Record<string, unknown>) {
  const input = (payload.tool_input ?? payload.toolInput ?? {}) as Record<string, unknown>;
  return { toolName: String(payload.tool_name ?? payload.toolName ?? 'unknown'), actionKey: text(input.command ?? input.path ?? input.file_path ?? input), pathScope: typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : null };
}
function taskId(payload: Record<string, unknown>): string { return String(payload.nim_task_id ?? payload.session_id ?? payload.sessionId ?? 'default'); }

export interface DispatchResult { exitCode: number; output?: Record<string, unknown>; stderr?: string; }

/** Translates generic lifecycle input into a deterministic local decision. */
export function dispatchHook(host: HookHost, event: HookEvent, payload: Record<string, unknown>, cfg: HooksConfig = DEFAULT_HOOKS, cwd = process.cwd()): DispatchResult {
  if (!cfg.enabled) return { exitCode: 0 };
  const task = taskId(payload); const store = new AuditorStore(cfg.auditor.store);
  if (event === 'start') {
    store.start(task, host);
    return { exitCode: 0, output: { systemMessage: hookContext(String(payload.prompt ?? payload.user_prompt ?? ''), cfg, cwd), taskId: task } };
  }
  if (event === 'end') {
    const status = store.status(task); const completed: string[] = [];
    // `workrule check` is intentionally advisory; evaluating its canonical
    // checklist here is equivalent to the CLI command and remains idempotent.
    if (store.complete(task, 'workrule-check')) completed.push(`workrule check (${WORKRULE_QUESTIONS.length} questions)`);
    if (status.failures.length > 0 && store.complete(task, 'workrule-log')) {
      const workrule = createWorkruleHelper(resolveWorkruleConfig(loadWorkruleJson(cwd)));
      workrule.log({ primitive: 'nim-auditor', effect: `recorded ${status.failures.length} task-scoped failure shape(s) and prevented repeated actions when their threshold was reached.`, resolutionType: 'mitigation' });
      completed.push('workrule log');
    }
    if (status.failures.some((failure) => failure.count >= 3) && store.complete(task, 'lesson-capture')) {
      const lessons = resolveConfig(loadNimJson(cwd)).lessons ?? { store: '.nim/lessons.jsonl', ttlMs: 90 * 24 * 60 * 60 * 1000 };
      createLessonsHelper(lessons).capture({ triggerShape: { toolName: '*', pathGlob: '*', contentSignal: 'repeated-action' }, whatWentWrong: 'Repeated an equivalent failed action three times in one task.', correctPattern: 'Inspect the auditor status and submit a materially different replan before retrying.', severity: 'warning', source: 'auto' });
      completed.push('lesson capture');
    }
    if (payload.state_changed === true && store.complete(task, 'workspace-handoff')) {
      appendHandoff(cwd, { goal: String(payload.goal ?? 'nim-skill lifecycle task'), output: String(payload.output ?? 'Lifecycle completion protocol ran.'), next: String(payload.next ?? 'Inspect auditor status before continuing.') });
      completed.push('workspace handoff');
    }
    return { exitCode: 0, output: { systemMessage: completed.length ? `nim-skill completion: ${completed.join(', ')}` : 'nim-skill completion already recorded for this task.' } };
  }
  const action = toolAction(payload);
  if (event === 'pre-tool' && cfg.auditor.enabled && cfg.auditor.mode !== 'off') {
    const decision = store.preflight(task, action);
    if (!decision.allowed) {
      const reason = decision.reason!;
      if (cfg.auditor.mode === 'strict') return { exitCode: 1, stderr: reason, output: { decision: 'block', reason, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } };
      return { exitCode: 0, output: { systemMessage: reason } };
    }
  }
  if (event === 'post-tool') {
    const response = text(payload.tool_response ?? payload.toolResponse ?? payload.error ?? '');
    const failed = payload.success === false || payload.ok === false || payload.exit_code === 1 || payload.exitCode === 1 || /(?:^|\n)(?:error|fail|fatal|exception)\b/i.test(response);
    if (failed && cfg.auditor.enabled && cfg.auditor.mode !== 'off') {
      const classified = classify(new Error(redactSecretText(response)));
      const recorded = store.recordFailure(task, { ...action, source: 'host', message: response, errorClass: classified.class, errorType: classified.errorType, eventId: String(payload.tool_use_id ?? payload.toolUseId ?? '') || null });
      return { exitCode: 0, output: { systemMessage: `nim-auditor recorded failure ${recorded.count}/3 for this action. ${classified.actionRequired ?? ''}`.trim() } };
    }
  }
  return { exitCode: 0 };
}
