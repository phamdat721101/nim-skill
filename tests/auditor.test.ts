import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionId, failureFingerprint } from '../src/hooks/auditor.js';
import { dispatchHook } from '../src/hooks/dispatch.js';
import { AuditorStore } from '../src/hooks/store.js';

describe('nim-auditor', () => {
  it('normalizes volatile data while preserving action identity', () => {
    const base = { source: 'host' as const, toolName: 'Bash', actionKey: 'npm test', pathScope: 'src/', message: 'Error build 123456 at 2026-01-01T00:00:00Z', errorClass: 'permanent' as const };
    expect(failureFingerprint(base)).toBe(failureFingerprint({ ...base, message: 'ERROR build 987654 at 2027-01-01T00:00:00Z' }));
    expect(actionId(base)).not.toBe(actionId({ ...base, actionKey: 'npm run lint' }));
  });

  it('blocks the fourth equivalent action before execution and replan unlocks it', () => {
    const root = mkdtempSync(join(tmpdir(), 'nim-auditor-')); const store = new AuditorStore(root); const task = 'task-1';
    store.start(task, 'codex');
    for (let i = 0; i < 3; i += 1) store.recordFailure(task, { source: 'host', toolName: 'Bash', actionKey: 'npm test', pathScope: 'src/', message: `Error build ${i + 100000}`, errorClass: 'permanent', eventId: `event-${i}` });
    const blocked = store.preflight(task, { toolName: 'Bash', actionKey: 'npm test', pathScope: 'src/' });
    expect(blocked.allowed).toBe(false);
    const fingerprint = store.status(task).failures[0]!.fingerprint;
    store.replan({ taskId: task, fingerprint, rootCause: 'bad fixture', alternatives: ['fix fixture', 'run isolated test'], selected: 'fix fixture', nextAction: 'edit test fixture' });
    expect(store.preflight(task, { toolName: 'Bash', actionKey: 'npm test', pathScope: 'src/' }).allowed).toBe(true);
  });

  it('dispatches a strict host pre-tool denial without running the action', () => {
    const root = mkdtempSync(join(tmpdir(), 'nim-dispatch-')); const cfg = { enabled: true, profile: 'default' as const, memoryFiles: [], search: { topK: 3, maxTokens: 300 }, auditor: { enabled: true, threshold: 4 as const, mode: 'strict' as const, store: root } };
    const store = new AuditorStore(root); store.start('session', 'codex');
    for (let i = 0; i < 3; i += 1) store.recordFailure('session', { source: 'host', toolName: 'Bash', actionKey: 'npm test', message: 'Error fixture', errorClass: 'permanent', eventId: String(i) });
    const result = dispatchHook('codex', 'pre-tool', { session_id: 'session', tool_name: 'Bash', tool_input: { command: 'npm test' } }, cfg);
    expect(result.exitCode).toBe(1); expect(result.output?.decision).toBe('block');
  });

  it('runs completion bookkeeping once and captures a reusable repeated-action lesson', () => {
    const root = mkdtempSync(join(tmpdir(), 'nim-completion-')); const cfg = { enabled: true, profile: 'default' as const, memoryFiles: [], search: { topK: 3, maxTokens: 300 }, auditor: { enabled: true, threshold: 4 as const, mode: 'strict' as const, store: root } };
    const store = new AuditorStore(root); store.start('done', 'codex');
    for (let i = 0; i < 3; i += 1) store.recordFailure('done', { source: 'host', toolName: 'Bash', actionKey: 'npm test', message: 'Error fixture', errorClass: 'permanent', eventId: `done-${i}` });
    const first = dispatchHook('codex', 'end', { session_id: 'done' }, cfg, root);
    const second = dispatchHook('codex', 'end', { session_id: 'done' }, cfg, root);
    expect(first.output?.systemMessage).toContain('workrule check');
    expect(second.output?.systemMessage).toContain('already recorded');
  });
});
