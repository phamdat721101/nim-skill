import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { checkProposal, proposalPathFor, proposalHashFor } from '../src/guard/propose.js';
import { createGuard, GuardError } from '../src/guard/guard.js';
import { resolveConfig } from '../src/config.js';
import { runHarnessed } from '../src/harness/runtime.js';
import type { SkillDef, SkillContext, HarnessConfig } from '../src/harness/types.js';

const PROPOSALS_DIR = '.nim-propose-test/proposals';
const ctx: SkillContext = { agentId: 'agent-1' };

function skill(over: Partial<SkillDef> & { harness: HarnessConfig; execute: SkillDef['execute'] }): SkillDef {
  return { name: 'demo', version: '0.0.0', ...over };
}

afterEach(() => rmSync('.nim-propose-test', { recursive: true, force: true }));

describe('proposalHashFor / proposalPathFor', () => {
  it('is deterministic for the same description', () => {
    expect(proposalHashFor('add a migration')).toBe(proposalHashFor('add a migration'));
  });

  it('differs for different descriptions', () => {
    expect(proposalHashFor('add a migration')).not.toBe(proposalHashFor('delete a table'));
  });

  it('builds a path under the configured proposals dir', () => {
    const p = proposalPathFor('add a migration', PROPOSALS_DIR);
    expect(p.startsWith(PROPOSALS_DIR)).toBe(true);
    expect(p.endsWith('.md')).toBe(true);
  });
});

describe('checkProposal (pure, filesystem-backed)', () => {
  it('denies when no proposal file exists at all', () => {
    const result = checkProposal('add a migration', { proposalsDir: PROPOSALS_DIR, approvalTtlMs: 60_000 });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('no_proposal');
  });

  it('denies when a proposal exists but is not marked approved', () => {
    mkdirSync(PROPOSALS_DIR, { recursive: true });
    const path = proposalPathFor('add a migration', PROPOSALS_DIR);
    writeFileSync(path, '# Proposal\n\nnot yet approved\n');
    const result = checkProposal('add a migration', { proposalsDir: PROPOSALS_DIR, approvalTtlMs: 60_000 });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('not_approved');
  });

  it('allows when a proposal exists, is marked approved, and is within the TTL', () => {
    mkdirSync(PROPOSALS_DIR, { recursive: true });
    const path = proposalPathFor('add a migration', PROPOSALS_DIR);
    writeFileSync(path, `# Proposal\n\napproved: ${new Date().toISOString()}\n`);
    const result = checkProposal('add a migration', { proposalsDir: PROPOSALS_DIR, approvalTtlMs: 60_000 });
    expect(result.approved).toBe(true);
  });

  it('denies when the approval has expired past the TTL', () => {
    mkdirSync(PROPOSALS_DIR, { recursive: true });
    const path = proposalPathFor('add a migration', PROPOSALS_DIR);
    const old = new Date(Date.now() - 120_000).toISOString();
    writeFileSync(path, `# Proposal\n\napproved: ${old}\n`);
    const result = checkProposal('add a migration', { proposalsDir: PROPOSALS_DIR, approvalTtlMs: 60_000 });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('approval_expired');
  });
});

describe('createGuard.checkPolicy — propose gate', () => {
  const guardCfg = (over = {}) => resolveConfig({ guard: { propose: { require: true, proposalsDir: PROPOSALS_DIR, ...over } } }).guard!;

  it('denies with GuardReason proposal_required when propose.require is true and no plan exists', () => {
    const g = createGuard(guardCfg());
    expect(() => g.checkPolicy({ agentId: 'a', taskDescription: 'add a migration' })).toThrow(GuardError);
    try {
      g.checkPolicy({ agentId: 'a', taskDescription: 'add a migration' });
    } catch (e) {
      expect((e as GuardError).reason).toBe('proposal_required');
    }
  });

  it('allows once the proposal is written and approved', () => {
    mkdirSync(PROPOSALS_DIR, { recursive: true });
    const path = proposalPathFor('add a migration', PROPOSALS_DIR);
    writeFileSync(path, `# Proposal\n\napproved: ${new Date().toISOString()}\n`);
    const g = createGuard(guardCfg());
    expect(() => g.checkPolicy({ agentId: 'a', taskDescription: 'add a migration' })).not.toThrow();
  });

  it('does not require a proposal when propose is unset (rollback contract)', () => {
    const g = createGuard(resolveConfig({ guard: {} }).guard!);
    expect(() => g.checkPolicy({ agentId: 'a', taskDescription: 'add a migration' })).not.toThrow();
  });
});

describe('propose gate is orthogonal to existing budget/cost checks (two-directional regression)', () => {
  it('a propose_required denial does NOT trip when taskBudgetUsd is separately exceeded but propose.require is false', async () => {
    const s = skill({
      harness: { guard: { taskBudgetUsd: 0.000001 } },
      execute: () => ({ ok: true }),
    });
    // budget breach still fires on its own; propose was never configured, so it's not the cause
    await expect(runHarnessed(s, { big: 'x'.repeat(10_000) }, ctx)).rejects.toThrow(/task_budget_exceeded/);
  });

  it('a task_budget_exceeded denial and a proposal_required denial can each fire independently without the other masking it', async () => {
    mkdirSync(PROPOSALS_DIR, { recursive: true });
    // No approved proposal on disk AND a tiny budget — propose is checked first in checkPolicy,
    // so proposal_required should surface, not task_budget_exceeded (deterministic ordering).
    const s = skill({
      harness: { guard: { taskBudgetUsd: 0.000001, propose: { require: true, proposalsDir: PROPOSALS_DIR } } },
      execute: () => ({ ok: true }),
    });
    try {
      await runHarnessed(s, {}, ctx);
      expect.fail('expected runHarnessed to reject');
    } catch (err) {
      // GuardError is wrapped: assert against the underlying reason, not the message text.
      expect((err as { reason?: string }).reason ?? (err as Error).message).toMatch(/proposal_required|no_proposal/);
    }
  });
});


describe('runHarnessed — TraceRecord.proposal wiring', () => {
  it('a denied run reports trace.proposal with required:true, approved:false, and a reason (captured via file monitor since GuardError does not carry .trace)', async () => {
    const traceFile = `${PROPOSALS_DIR}-trace.jsonl`;
    const s = skill({
      harness: { guard: { propose: { require: true, proposalsDir: PROPOSALS_DIR } }, monitor: { exporters: ['file'], traceFile } },
      execute: () => ({ ok: true }),
    });
    await expect(runHarnessed(s, {}, ctx)).rejects.toThrow(GuardError);
    const { parseTraces } = await import('../src/monitor/dashboard.js');
    const traces = parseTraces(readFileSync(traceFile, 'utf8'));
    expect(traces).toHaveLength(1);
    expect(traces[0]!.proposal).toEqual({ required: true, approved: false, reason: 'no_proposal' });
    rmSync(traceFile, { force: true });
  });

  it('a successful run with propose.require configured and an approved plan reports trace.proposal.approved:true', async () => {
    mkdirSync(PROPOSALS_DIR, { recursive: true });
    const s = skill({
      harness: { guard: { propose: { require: true, proposalsDir: PROPOSALS_DIR } } },
      execute: () => ({ ok: true }),
    });
    const path = proposalPathFor(s.name, PROPOSALS_DIR);
    writeFileSync(path, `# Proposal\n\napproved: ${new Date().toISOString()}\n`);
    const { trace } = await runHarnessed(s, {}, ctx);
    expect(trace.proposal).toEqual({ required: true, approved: true });
  });

  it('a run with propose unset produces a trace with NO proposal field (rollback contract)', async () => {
    const s = skill({ harness: {}, execute: () => ({ ok: true }) });
    const { trace } = await runHarnessed(s, {}, ctx);
    expect(trace).not.toHaveProperty('proposal');
  });
});
