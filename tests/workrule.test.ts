import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { createWorkruleHelper, WORKRULE_QUESTIONS } from '../src/workrule/index.js';
import { resolveWorkruleConfig } from '../src/config.js';

const TEST_LOG = '.nim/workrule-test-log.md';

describe('WORKRULE_QUESTIONS', () => {
  it('has exactly 7 questions, WR-01 through WR-07', () => {
    expect(WORKRULE_QUESTIONS).toHaveLength(7);
    expect(WORKRULE_QUESTIONS.map((q) => q.id)).toEqual(['WR-01', 'WR-02', 'WR-03', 'WR-04', 'WR-05', 'WR-06', 'WR-07']);
  });
});

describe('resolveWorkruleConfig', () => {
  it('defaults logFile to .nim/agent-support-log.md', () => {
    expect(resolveWorkruleConfig({}).logFile).toBe('.nim/agent-support-log.md');
  });

  it('honors an explicit logFile override', () => {
    expect(resolveWorkruleConfig({ logFile: 'custom.md' }).logFile).toBe('custom.md');
  });
});

describe('createWorkruleHelper', () => {
  beforeEach(() => {
    if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
  });
  afterEach(() => {
    if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
  });

  it('log() appends an entry and returns it with an ISO timestamp', () => {
    const helper = createWorkruleHelper({ logFile: TEST_LOG });
    const entry = helper.log({ primitive: 'nim-cache', effect: 'skipped re-verify of unchanged output', tokensSaved: 1200 });
    expect(entry.primitive).toBe('nim-cache');
    expect(entry.tokensSaved).toBe(1200);
    expect(() => new Date(entry.at).toISOString()).not.toThrow();
  });

  it('renders and reads back a typed resolution label while accepting legacy rows', () => {
    const helper = createWorkruleHelper({ logFile: TEST_LOG });
    helper.log({ primitive: 'nim-guard', effect: 'blocked repeated spend', resolutionType: 'mitigation' });
    const raw = readFileSync(TEST_LOG, 'utf8');
    expect(raw).toContain('[MITIGATION]');
    expect(helper.history()[0]?.resolutionType).toBe('mitigation');
  });

  it('history() reads back exactly what was logged, in order', () => {
    const helper = createWorkruleHelper({ logFile: TEST_LOG });
    helper.log({ primitive: 'nim-guard', effect: 'blocked a cost-cap breach' });
    helper.log({ primitive: 'nim-index', effect: 'flagged 3 cache-fragile tool descriptions', tokensSaved: 400 });
    const history = helper.history();
    expect(history).toHaveLength(2);
    expect(history[0]?.primitive).toBe('nim-guard');
    expect(history[0]?.tokensSaved).toBeUndefined();
    expect(history[1]?.primitive).toBe('nim-index');
    expect(history[1]?.tokensSaved).toBe(400);
  });

  it('escapes pipe characters in the effect field so the markdown table stays well-formed', () => {
    const helper = createWorkruleHelper({ logFile: TEST_LOG });
    helper.log({ primitive: 'nim-enforcer', effect: 'rejected output missing required | field' });
    const raw = readFileSync(TEST_LOG, 'utf8');
    expect(raw).toContain('\\|');
    const history = helper.history();
    expect(history[0]?.effect).toBe('rejected output missing required | field');
  });

  it('round-trips non-secret external session references', () => {
    const helper = createWorkruleHelper({ logFile: TEST_LOG });
    helper.log({ primitive: 'nim-memory', effect: 'recovered paid session', references: { provider: 'hypermove', agentId: 'agent-1', sessionId: 'session-1', runId: 'run-1' } });
    expect(helper.history()[0]?.references).toEqual({ provider: 'hypermove', agentId: 'agent-1', sessionId: 'session-1', runId: 'run-1' });
  });

  it('history() on a missing log file returns an empty array, never throws', () => {
    const helper = createWorkruleHelper({ logFile: TEST_LOG });
    expect(helper.history()).toEqual([]);
  });
});
