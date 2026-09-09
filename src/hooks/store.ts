import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AuditorStatus, FailureInput, HookHost, ReplanInput } from './types.js';
import { actionId, failureFingerprint, validateReplan } from './auditor.js';

type RecordKind = 'start' | 'failure' | 'replan' | 'complete';
interface EventRecord { kind: RecordKind; at: string; taskId: string; host?: HookHost; eventId?: string; actionId?: string; fingerprint?: string; payload?: Record<string, unknown>; }

function fileFor(root: string, taskId: string): string { return join(root, `${taskId}.jsonl`); }
function safeTaskId(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'default'; }

export class AuditorStore {
  constructor(readonly root = '.nim/auditor') {}

  private read(taskId: string): EventRecord[] {
    const file = fileFor(this.root, safeTaskId(taskId));
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line) as EventRecord]; } catch { return []; }
    });
  }

  private append(event: EventRecord): void {
    const file = fileFor(this.root, safeTaskId(event.taskId));
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8' });
  }

  start(taskId: string, host: HookHost): void {
    if (this.read(taskId).some((event) => event.kind === 'start')) return;
    this.append({ kind: 'start', at: new Date().toISOString(), taskId, host });
  }

  status(taskId: string): AuditorStatus {
    const events = this.read(taskId);
    const failures = new Map<string, { fingerprint: string; actionId: string; count: number; lastAt: string }>();
    const blocked = new Set<string>(); const replanned = new Set<string>(); const completed = new Set<string>();
    for (const event of events) {
      if (event.kind === 'failure' && event.fingerprint && event.actionId) {
        const previous = failures.get(event.fingerprint) ?? { fingerprint: event.fingerprint, actionId: event.actionId, count: 0, lastAt: event.at };
        previous.count += 1; previous.lastAt = event.at; failures.set(event.fingerprint, previous);
      }
      if (event.kind === 'replan' && event.actionId) replanned.add(event.actionId);
      if (event.kind === 'complete' && event.payload?.step && typeof event.payload.step === 'string') completed.add(event.payload.step);
    }
    for (const value of failures.values()) if (value.count >= 3 && !replanned.has(value.actionId)) blocked.add(value.actionId);
    const start = events.find((event) => event.kind === 'start');
    return { taskId, host: start?.host, startedAt: start?.at, failures: [...failures.values()], blocked: [...blocked], completed: [...completed] };
  }

  preflight(taskId: string, action: { toolName: string; actionKey?: string | null; pathScope?: string | null }): { allowed: boolean; actionId: string; reason?: string } {
    const id = actionId(action); const status = this.status(taskId);
    return status.blocked.includes(id) ? { allowed: false, actionId: id, reason: 'nim-auditor: this action already failed three times; run `nim-skill auditor replan` with a different next action.' } : { allowed: true, actionId: id };
  }

  recordFailure(taskId: string, failure: FailureInput): { fingerprint: string; actionId: string; count: number } {
    const fingerprint = failureFingerprint(failure); const id = actionId(failure);
    if (failure.eventId && this.read(taskId).some((event) => event.eventId === failure.eventId)) {
      const found = this.status(taskId).failures.find((entry) => entry.fingerprint === fingerprint);
      return { fingerprint, actionId: id, count: found?.count ?? 0 };
    }
    this.append({ kind: 'failure', at: new Date().toISOString(), taskId, eventId: failure.eventId ?? undefined, actionId: id, fingerprint, payload: { source: failure.source, errorClass: failure.errorClass, errorType: failure.errorType ?? null } });
    const count = this.status(taskId).failures.find((entry) => entry.fingerprint === fingerprint)?.count ?? 1;
    return { fingerprint, actionId: id, count };
  }

  replan(input: ReplanInput): void {
    const error = validateReplan(input); if (error) throw new Error(`nim: invalid auditor replan: ${error}`);
    const status = this.status(input.taskId); const failure = status.failures.find((entry) => entry.fingerprint === input.fingerprint);
    if (!failure) throw new Error('nim: auditor fingerprint does not belong to this task');
    this.append({ kind: 'replan', at: new Date().toISOString(), taskId: input.taskId, actionId: failure.actionId, fingerprint: input.fingerprint, payload: { rootCause: input.rootCause.trim(), alternatives: input.alternatives.map((value) => value.trim()), selected: input.selected.trim(), nextAction: input.nextAction.trim() } });
  }

  complete(taskId: string, step: string): boolean {
    if (this.status(taskId).completed.includes(step)) return false;
    this.append({ kind: 'complete', at: new Date().toISOString(), taskId, payload: { step } }); return true;
  }
}
