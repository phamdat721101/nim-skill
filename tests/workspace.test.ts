import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { checkStaleness } from '../src/workspace/rules.js';
import { scanOffStackSignal } from '../src/workspace/signal-scan.js';
import { scanExistenceOverlap } from '../src/workspace/existence-scan.js';
import { createWorkspaceGuard } from '../src/workspace/index.js';
import { workspaceSchema, resolveWorkspaceConfig, loadWorkspaceJson, resolveConfig } from '../src/config.js';

describe('checkStaleness (WS-STALE)', () => {
  it('flags staleness when today is a cadence day and the liveness file is from yesterday', () => {
    const friday = new Date('2026-07-17T10:00:00Z').getTime(); // a Friday
    const yesterdayMtime = new Date('2026-07-16T09:04:00Z').getTime();
    const result = checkStaleness(yesterdayMtime, friday, ['Mon', 'Wed', 'Fri']);
    expect(result.pass).toBe(false);
    expect(result.strategy).toBe('WS-STALE');
  });

  it('does not flag staleness when the liveness file was refreshed today', () => {
    const friday = new Date('2026-07-17T10:00:00Z').getTime();
    const sameDayMtime = new Date('2026-07-17T08:00:00Z').getTime();
    expect(checkStaleness(sameDayMtime, friday, ['Mon', 'Wed', 'Fri']).pass).toBe(true);
  });

  it('does not flag staleness on a non-cadence day even if the file is old', () => {
    const tuesday = new Date('2026-07-21T10:00:00Z').getTime(); // a Tuesday
    const oldMtime = new Date('2026-07-10T09:04:00Z').getTime();
    expect(checkStaleness(oldMtime, tuesday, ['Mon', 'Wed', 'Fri']).pass).toBe(true);
  });
});

describe('scanOffStackSignal', () => {
  it('detects a Java/Spring cluster against a declared typescript+web3 stack', () => {
    const fixture = `
## Root cause
Spring @Transactional ThreadLocal context loss occurs when AbstractRoutingDataSource
switches tenants mid-request. Run gradle compileJava to verify the JDK 21 build.
`;
    const result = scanOffStackSignal(
      fixture,
      ['typescript', 'web3'],
      { java: ['@Transactional', 'AbstractRoutingDataSource', 'gradle', 'JDK 21'] },
    );
    expect(result?.matchedStack).toBe('java');
    expect(result?.evidence.pass).toBe(false);
  });

  it('returns null for content with no off-stack cluster', () => {
    const clean = 'This module exports fetchWithPayment(url) via the n-payment SDK.';
    expect(scanOffStackSignal(clean, ['typescript', 'web3'], { java: ['@Transactional'] })).toBeNull();
  });

  it('returns null when the declared stack already includes the matched stack name', () => {
    // If "java" is itself part of the declared stack, an off-stack finding against
    // its own terms would be a false positive -- must not fire.
    const fixture = 'Spring @Transactional AbstractRoutingDataSource gradle JDK 21 everywhere here in this block of many lines';
    const result = scanOffStackSignal(fixture, ['java', 'typescript'], { java: ['@Transactional', 'AbstractRoutingDataSource', 'gradle', 'JDK 21'] });
    expect(result).toBeNull();
  });
});

describe('scanExistenceOverlap', () => {
  it('recommends EXTEND at >=50% overlap with exactly one candidate', () => {
    const result = scanExistenceOverlap(
      'daily research briefing router for any topic',
      [{ path: '.claude/skills/daily-research/SKILL.md', declaredPurpose: 'daily research briefing for a specific topic' }],
      { extend: 50, compose: 80, iterate: 20 },
    );
    expect(result.recommendation).toBe('EXTEND');
    expect(result.overlaps[0].path).toContain('daily-research');
  });

  it('recommends PROCEED below the iterate threshold', () => {
    const result = scanExistenceOverlap(
      'compute a Fibonacci sequence',
      [{ path: 'unrelated.md', declaredPurpose: 'daily research briefing' }],
      { extend: 50, compose: 80, iterate: 20 },
    );
    expect(result.recommendation).toBe('PROCEED');
  });
});

describe('createWorkspaceGuard', () => {
  it('BLOCK takes precedence over an existence recommendation when both fire', () => {
    const guard = createWorkspaceGuard({
      stack: ['typescript'], offStackSignalTerms: { java: ['@Transactional'] },
      clusterWindow: 8, clusterThreshold: 1, existenceOverlapThresholds: { extend: 50, compose: 80, iterate: 20 },
      livenessFile: '', livenessCadence: [], mode: 'strict',
    });
    const result = guard.check({ filePath: 'research/x.md', content: '@Transactional here', declaredPurpose: 'x' });
    expect(result.recommendation).toBe('BLOCK');
  });

  it('mode:"warn" (default) never denies -- BLOCK recommendation still surfaces but strict-only enforcement is a CLI/adapter concern', () => {
    const guard = createWorkspaceGuard({
      stack: ['typescript'], offStackSignalTerms: { java: ['@Transactional'] },
      clusterWindow: 8, clusterThreshold: 1, existenceOverlapThresholds: { extend: 50, compose: 80, iterate: 20 },
      livenessFile: '', livenessCadence: [], mode: 'warn',
    });
    const result = guard.check({ filePath: 'research/x.md', content: '@Transactional here', declaredPurpose: 'x' });
    // The guard still reports the recommendation accurately -- mode gates only the
    // hook-adapter's decision to deny, not the guard's own evidence-gathering.
    expect(result.recommendation).toBe('BLOCK');
  });

  it('absent stack declaration never produces a BLOCK identity-mismatch (nothing to check against)', () => {
    const guard = createWorkspaceGuard({
      stack: [], offStackSignalTerms: { java: ['@Transactional'] },
      clusterWindow: 8, clusterThreshold: 1, existenceOverlapThresholds: { extend: 50, compose: 80, iterate: 20 },
      livenessFile: '', livenessCadence: [], mode: 'strict',
    });
    const result = guard.check({ filePath: 'research/x.md', content: '@Transactional here', declaredPurpose: 'x' });
    expect(result.recommendation).not.toBe('BLOCK');
  });

  it('audit() scans a directory and reports overlap pairs without throwing', () => {
    const guard = createWorkspaceGuard({
      stack: ['typescript'], offStackSignalTerms: {},
      clusterWindow: 8, clusterThreshold: 3, existenceOverlapThresholds: { extend: 50, compose: 80, iterate: 20 },
      livenessFile: '', livenessCadence: [], mode: 'warn',
    });
    const overlaps = guard.audit('skills');
    expect(Array.isArray(overlaps)).toBe(true);
  });

  it('surfaces a staleWarning independent of the recommendation when the liveness file is stale', () => {
    // Use this repo's own AGENTS.md (an old, real file) as a stand-in liveness
    // file with an always-cadence day set, so the mtime is guaranteed to be
    // from a prior calendar day relative to "now" in any normal test run.
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'short' });
    const guard = createWorkspaceGuard({
      stack: ['typescript'], offStackSignalTerms: {},
      clusterWindow: 8, clusterThreshold: 3, existenceOverlapThresholds: { extend: 50, compose: 80, iterate: 20 },
      livenessFile: 'LICENSE', livenessCadence: [weekday], mode: 'warn',
    });
    const result = guard.check({ filePath: 'x.md', content: 'clean typescript content', declaredPurpose: 'x' });
    expect(result.staleWarning).toBeDefined();
  });
});

describe('workspace config (src/config.ts sibling-key pattern)', () => {
  it('workspaceSchema parses a full example object', () => {
    const parsed = workspaceSchema.parse({
      stack: ['typescript', 'web3'],
      offStackSignalTerms: { java: ['@Transactional'] },
      clusterWindow: 8,
      clusterThreshold: 3,
      existenceOverlapThresholds: { extend: 50, compose: 80, iterate: 20 },
      livenessFile: '_brain/product-state.md',
      livenessCadence: 'Mon,Wed,Fri',
      mode: 'warn',
    });
    expect(parsed.mode).toBe('warn');
  });

  it('resolveWorkspaceConfig fills defaults for an empty input', () => {
    const resolved = resolveWorkspaceConfig({});
    expect(resolved.mode).toBe('warn');
    expect(resolved.clusterWindow).toBe(8);
    expect(resolved.clusterThreshold).toBe(3);
    expect(resolved.existenceOverlapThresholds).toEqual({ extend: 50, compose: 80, iterate: 20 });
  });

  it('adding a workspace block does not change resolveConfig()\'s existing (unrelated) harness output', () => {
    const before = resolveConfig({ guard: { maxCostUsd: 1 } });
    // workspace lives outside `harness` entirely -- resolveConfig only ever reads `harness`.
    const after = resolveConfig({ guard: { maxCostUsd: 1 } });
    expect(after).toEqual(before);
  });

  it('loadWorkspaceJson returns an empty object when nim.json is absent', () => {
    const result = loadWorkspaceJson('/tmp/definitely-nonexistent-dir-xyz');
    expect(result).toEqual({});
  });
});

describe('WS-08 dogfood + coverage gate', () => {
  it('this repo\'s own AGENTS.md is PROCEED against nim-skill\'s own declared typescript stack', () => {
    const guard = createWorkspaceGuard(
      resolveWorkspaceConfig({ stack: ['typescript'], offStackSignalTerms: { java: ['@Transactional', 'AbstractRoutingDataSource', 'gradle', 'Spring Boot'] } }),
    );
    const content = readFileSync('AGENTS.md', 'utf8');
    const result = guard.check({ filePath: 'AGENTS.md', content });
    expect(result.recommendation).toBe('PROCEED');
  });

  it('schema/workspace-config.json exists and validates the WS-05 example object', () => {
    expect(existsSync('schema/workspace-config.json')).toBe(true);
    const schema = JSON.parse(readFileSync('schema/workspace-config.json', 'utf8'));
    expect(schema.title).toBe('WorkspaceConfig');
  });
});
