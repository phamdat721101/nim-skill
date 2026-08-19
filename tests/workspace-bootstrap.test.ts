import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendHandoff, assessWorkspace, createFeatureBrief, featurePath, initializeWorkspace } from '../src/workspace/bootstrap.js';
import { resolveConfig, resolveWorkspaceConfig } from '../src/config.js';

const TMP = '.nim-workspace-bootstrap-test';
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('agent-ready workspace bootstrap', () => {
  it('assesses an empty directory as greenfield and identifies review work', () => {
    mkdirSync(TMP, { recursive: true });
    const assessment = assessWorkspace(TMP);
    expect(assessment.kind).toBe('greenfield');
    expect(assessment.stack).toEqual([]);
    expect(assessment.reviewRequired.join(' ')).toMatch(/tech stack/i);
  });

  it('infers a Node/TypeScript project and creates the three-tier state safely', () => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ dependencies: { react: '1' }, devDependencies: { typescript: '1' } }));
    mkdirSync(join(TMP, 'prisma'));
    const report = initializeWorkspace(TMP);
    expect(report.kind).toBe('brownfield');
    expect(report.assessment.stack).toEqual(expect.arrayContaining(['node', 'typescript', 'react']));
    expect(report.assessment.dataModelPaths).toContain('prisma');
    for (const file of ['CONSTITUTION.md', 'docs/state/active_session.md', 'nim.json']) expect(existsSync(join(TMP, file))).toBe(true);
    expect(existsSync(join(TMP, 'docs/features'))).toBe(true);
    expect(readFileSync(join(TMP, 'CONSTITUTION.md'), 'utf8')).toContain('Human review required');
    expect(readFileSync(join(TMP, 'docs/state/active_session.md'), 'utf8')).toContain('Set up the agent-ready workspace harness');
  });

  it('never overwrites existing state and dry-run writes nothing', () => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, 'CONSTITUTION.md'), '# User constitution\n');
    const dry = initializeWorkspace(TMP, true);
    expect(dry.created).toContain('nim.json');
    expect(existsSync(join(TMP, 'nim.json'))).toBe(false);
    initializeWorkspace(TMP);
    expect(readFileSync(join(TMP, 'CONSTITUTION.md'), 'utf8')).toBe('# User constitution\n');
    expect(initializeWorkspace(TMP).created).toEqual([]);
  });

  it('creates a feature brief once and normalizes its path', () => {
    mkdirSync(TMP, { recursive: true });
    expect(featurePath('Payment API v2')).toBe('docs/features/payment-api-v2.md');
    expect(createFeatureBrief(TMP, 'Payment API v2')).toEqual({ path: 'docs/features/payment-api-v2.md', created: true });
    expect(createFeatureBrief(TMP, 'Payment API v2')).toEqual({ path: 'docs/features/payment-api-v2.md', created: false });
    expect(readFileSync(join(TMP, 'docs/features/payment-api-v2.md'), 'utf8')).toContain('Tracer-bullet path');
  });

  it('appends handoffs and keeps the final snapshot authoritative', () => {
    mkdirSync(TMP, { recursive: true });
    appendHandoff(TMP, { goal: 'first', output: 'passed', next: 'continue', attempted: ['ran test'] });
    appendHandoff(TMP, { goal: 'second', output: 'failed', blocker: 'dependency unavailable', next: 'retry later' });
    const state = readFileSync(join(TMP, 'docs/state/active_session.md'), 'utf8');
    expect((state.match(/^## Session \d{4}-/gm) ?? []).length).toBe(2);
    expect(state.lastIndexOf('second')).toBeGreaterThan(state.lastIndexOf('first'));
    expect(state).toContain('Blocker: dependency unavailable');
    expect(() => appendHandoff(TMP, { goal: ' ', output: 'x', next: 'x' })).toThrow(/--goal/);
  });

  it('generates config that enables the requested harness layers', () => {
    mkdirSync(TMP, { recursive: true });
    initializeWorkspace(TMP);
    const json = JSON.parse(readFileSync(join(TMP, 'nim.json'), 'utf8'));
    const harness = resolveConfig(json.harness);
    const workspace = resolveWorkspaceConfig(json.workspace);
    expect(harness.enforcer).toMatchObject({ mode: 'strict', maxHeals: 0 });
    expect(harness.memory).toMatchObject({ verifyCache: true, priors: true });
    expect(harness.context).toMatchObject({ onExceed: 'compact' });
    expect(harness.logCompact).toMatchObject({ strategy: 'errors-only' });
    expect(workspace.livenessFile).toBe('docs/state/active_session.md');
  });
});
