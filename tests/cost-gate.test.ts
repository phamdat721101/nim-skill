import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { findCostedActionMatch } from '../src/lessons/cost-gate.js';
import { createLessonsStore } from '../src/lessons/store.js';
import { runHarnessed } from '../src/harness/runtime.js';
import { GuardError } from '../src/guard/guard.js';
import type { Lesson } from '../src/lessons/types.js';

const path = '.nim/cost-gate-test.jsonl';

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'wasted-1',
    capturedAt: new Date().toISOString(),
    triggerShape: { toolName: 'payments.settle', pathGlob: '*', contentSignal: null, actionKey: 'dream-tier' },
    whatWentWrong: 'payment binding rejected',
    correctPattern: 'inspect ledger state first',
    severity: 'critical',
    source: 'manual',
    outcome: 'wasted_spend',
    ...overrides,
  };
}

afterEach(() => { if (existsSync(path)) unlinkSync(path); });

describe('costed-action gate', () => {
  it('matches only configured tools, stable action keys, and recent wasted spend lessons', () => {
    expect(findCostedActionMatch(
      { toolName: 'payments.settle', actionKey: 'dream-tier' },
      { tools: ['payments.*'], lookbackHours: 24 },
      [lesson()],
    )?.id).toBe('wasted-1');
    expect(findCostedActionMatch(
      { toolName: 'payments.settle', actionKey: 'other' },
      { tools: ['payments.*'], lookbackHours: 24 },
      [lesson()],
    )).toBeUndefined();
    expect(findCostedActionMatch(
      { toolName: 'payments.settle', actionKey: 'dream-tier' },
      { tools: ['payments.*'], lookbackHours: 1 },
      [lesson({ capturedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })],
    )).toBeUndefined();
  });

  it('strict blocks before execute while warn allows the action', async () => {
    createLessonsStore({ store: path, ttlMs: 86_400_000 }).append(lesson());
    const execute = vi.fn(() => ({ ok: true }));
    const base = {
      name: 'payment', version: 'test', execute,
      harness: { guard: { costGate: { tools: ['payments.*'], mode: 'strict' } }, lessons: { store: path } },
    } as const;
    await expect(runHarnessed(base, {}, { agentId: 'a', costedAction: { toolName: 'payments.settle', actionKey: 'dream-tier' } })).rejects.toMatchObject({ reason: 'cost_gate_blocked' } satisfies Partial<GuardError>);
    expect(execute).not.toHaveBeenCalled();

    const warn = { ...base, harness: { guard: { costGate: { tools: ['payments.*'], mode: 'warn' as const } }, lessons: { store: path } } };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(runHarnessed(warn, {}, { agentId: 'b', costedAction: { toolName: 'payments.settle', actionKey: 'dream-tier' } })).resolves.toMatchObject({ output: { ok: true } });
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
