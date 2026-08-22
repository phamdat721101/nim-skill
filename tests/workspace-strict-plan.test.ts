import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { checkPlanMutex, checkNoBacktrack } from '../src/workspace/rules.js';
import { createWorkspaceGuard } from '../src/workspace/index.js';
import type { ResolvedWorkspaceConfig } from '../src/config.js';

describe('checkPlanMutex', () => {
  it('passes when the net active count is exactly at the max', () => {
    const text = '## Goal A [Active]\n## Goal B [Active]';
    const r = checkPlanMutex(text, 2);
    expect(r).toEqual({ strategy: 'WS-MUTEX', pass: true });
  });

  it('fails when the net active count is one over the max', () => {
    const text = '## Goal A [Active]\n## Goal B [Active]\n## Goal C [Active]';
    const r = checkPlanMutex(text, 2);
    expect(r.strategy).toBe('WS-MUTEX');
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('exceed the configured maximum of 2');
  });

  it('nets out [Closed]/[Blocked] tags against [Active] tags', () => {
    const text = '## Goal A [Active]\n## Goal A [Closed]\n## Goal B [Active]';
    const r = checkPlanMutex(text, 1);
    expect(r).toEqual({ strategy: 'WS-MUTEX', pass: true });
  });

  it('passes trivially on a session with no [Active] tag vocabulary at all', () => {
    const text = '# Active session\n\n## Session 2026-01-01T00:00:00Z\n\n### Current goal\n\ndo the thing\n';
    const r = checkPlanMutex(text, 1);
    expect(r).toEqual({ strategy: 'WS-MUTEX', pass: true });
  });
});

describe('checkNoBacktrack', () => {
  it('passes when requireOverrideOnReopen is false, regardless of content', () => {
    const r = checkNoBacktrack('goal-1', 'goal-1 [Closed]', 'goal-1 [Active]', false);
    expect(r).toEqual({ strategy: 'WS-NO-BACKTRACK', pass: true });
  });

  it('passes on a genuinely new (never-closed) goal id', () => {
    const r = checkNoBacktrack('goal-2', 'goal-1 [Closed]', 'goal-2 [Active]', true);
    expect(r).toEqual({ strategy: 'WS-NO-BACKTRACK', pass: true });
  });

  it('fails on a closed goal reopened without an [Override:...] line', () => {
    const r = checkNoBacktrack('goal-1', 'goal-1 [Closed]', 'goal-1 [Active]', true);
    expect(r.strategy).toBe('WS-NO-BACKTRACK');
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("Goal 'goal-1' was already [Closed]");
  });

  it('passes on the same reopen case WITH the override line present', () => {
    const r = checkNoBacktrack(
      'goal-1',
      'goal-1 [Closed]',
      'goal-1 [Active] [Override: found new information requiring rework]',
      true,
    );
    expect(r).toEqual({ strategy: 'WS-NO-BACKTRACK', pass: true });
  });

  it('escapes regex-special characters in the goal id safely', () => {
    const r = checkNoBacktrack('goal(1)', 'goal(1) [Closed]', 'goal(1) [Active]', true);
    expect(r.pass).toBe(false);
  });
});

const SESSION_PATH = 'docs/state/active_session.md';

const baseCfg = (strictPlanMode: ResolvedWorkspaceConfig['strictPlanMode']): ResolvedWorkspaceConfig => ({
  stack: [], offStackSignalTerms: {},
  clusterWindow: 8, clusterThreshold: 3, existenceOverlapThresholds: { extend: 50, compose: 80, iterate: 20 },
  livenessFile: '', livenessCadence: [], mode: 'strict', deliver: null,
  strictPlanMode,
});

describe('createWorkspaceGuard with strictPlanMode', () => {
  afterEach(() => {
    if (existsSync(SESSION_PATH)) rmSync(SESSION_PATH);
  });

  it('is byte-identical-off when strictPlanMode is null (disabled/absent)', () => {
    mkdirSync('docs/state', { recursive: true });
    writeFileSync(SESSION_PATH, '## Goal A [Active]\n## Goal B [Active]\n## Goal C [Active]\n');
    const guard = createWorkspaceGuard(baseCfg(null));
    const result = guard.check({ filePath: 'docs/x.md', content: 'anything', declaredPurpose: 'goal-x' });
    expect(result.recommendation).not.toBe('BLOCK');
    expect(result.evidence.find((e) => e.strategy === 'WS-MUTEX')).toBeUndefined();
  });

  it('BLOCKs via WS-MUTEX when strictPlanMode is enabled and too many goals are [Active]', () => {
    mkdirSync('docs/state', { recursive: true });
    writeFileSync(SESSION_PATH, '## Goal A [Active]\n## Goal B [Active]\n');
    const guard = createWorkspaceGuard(baseCfg({ maxConcurrentActive: 1, requireOverrideOnReopen: true }));
    const result = guard.check({ filePath: 'docs/x.md', content: 'Goal C [Active]', declaredPurpose: 'goal-c' });
    expect(result.recommendation).toBe('BLOCK');
    expect(result.evidence.some((e) => e.strategy === 'WS-MUTEX' && !e.pass)).toBe(true);
  });

  it('PROCEEDs when strictPlanMode is enabled but the session has no active-tag vocabulary at all', () => {
    mkdirSync('docs/state', { recursive: true });
    writeFileSync(SESSION_PATH, '# Active session\n\nRead the final entry as the current handoff state.\n');
    const guard = createWorkspaceGuard(baseCfg({ maxConcurrentActive: 1, requireOverrideOnReopen: true }));
    const result = guard.check({ filePath: 'docs/x.md', content: 'first goal here', declaredPurpose: 'goal-1' });
    expect(result.recommendation).not.toBe('BLOCK');
    expect(result.evidence.every((e) => e.pass)).toBe(true);
  });

  it('BLOCKs via WS-NO-BACKTRACK when reopening a closed goal without an override line', () => {
    mkdirSync('docs/state', { recursive: true });
    writeFileSync(SESSION_PATH, '## goal-1 [Closed]\n');
    const guard = createWorkspaceGuard(baseCfg({ maxConcurrentActive: 5, requireOverrideOnReopen: true }));
    const result = guard.check({ filePath: 'docs/x.md', content: 'goal-1 [Active]', declaredPurpose: 'goal-1' });
    expect(result.recommendation).toBe('BLOCK');
    expect(result.evidence.some((e) => e.strategy === 'WS-NO-BACKTRACK' && !e.pass)).toBe(true);
  });
});
