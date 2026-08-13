/**
 * tests/grill.test.ts
 * --------------------
 * Test coverage for nim-grill (v0.10.0):
 *   - compilePRD()            pure function correctness
 *   - formatPRDMarkdown()     output format
 *   - createGrillStore()      JSONL session CRUD + replay
 *   - createGrillHelper()     factory wiring (next, answer, status, compile)
 *   - questions.ts            domain banks + loadQuestionsForDomain
 *   - runHarnessed + enforcer schema verification gate
 *   - sessionIdFor            ID derivation stability
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { compilePRD, formatPRDMarkdown } from '../src/grill/compiler.js';
import { createGrillStore, sessionIdFor } from '../src/grill/session.js';
import { createGrillHelper } from '../src/grill/index.js';
import { loadQuestionsForDomain, DOMAIN_QUESTIONS, X402_QUESTIONS, XLS65_QUESTIONS } from '../src/grill/questions.js';
import type { GrillSession } from '../src/grill/types.js';
import { runHarnessed } from '../src/harness/runtime.js';
import type { SkillDef } from '../src/harness/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<GrillSession> = {}): GrillSession {
  const questions = loadQuestionsForDomain('x402').slice(0, 3);
  return {
    id: 'abc123',
    domain: 'x402',
    status: 'active',
    startedAt: '2026-01-01T00:00:00.000Z',
    branches: ['x402_protocol'],
    questions,
    answers: [
      { questionId: questions[0].id, answer: 'Using ERC-3009 nonces', resolvedAt: '2026-01-01T00:01:00.000Z' },
    ],
    ...overrides,
  };
}

// ─── compilePRD ───────────────────────────────────────────────────────────────

describe('compilePRD', () => {
  it('maps resolved answers to resolvedDecisions', () => {
    const session = makeSession();
    const prd = compilePRD(session);
    expect(prd.sessionId).toBe('abc123');
    expect(prd.domain).toBe('x402');
    expect(prd.resolvedDecisions).toHaveLength(1);
    expect(prd.resolvedDecisions[0].questionId).toBe(session.questions[0].id);
    expect(prd.resolvedDecisions[0].answer).toBe('Using ERC-3009 nonces');
  });

  it('maps unresolved questions to unresolvedTradeoffs', () => {
    const session = makeSession();
    const prd = compilePRD(session);
    // 3 questions, 1 answered → 2 unresolved
    expect(prd.unresolvedTradeoffs).toHaveLength(2);
  });

  it('generates acceptanceCriteria from resolved decisions', () => {
    const session = makeSession();
    const prd = compilePRD(session);
    expect(prd.acceptanceCriteria).toHaveLength(1);
    expect(prd.acceptanceCriteria[0]).toContain(session.questions[0].id);
  });

  it('returns empty resolvedDecisions when no answers', () => {
    const session = makeSession({ answers: [] });
    const prd = compilePRD(session);
    expect(prd.resolvedDecisions).toHaveLength(0);
    expect(prd.unresolvedTradeoffs).toHaveLength(3);
    expect(prd.acceptanceCriteria).toHaveLength(0);
  });

  it('truncates long answers in acceptanceCriteria to 120 chars + ellipsis', () => {
    const longAnswer = 'A'.repeat(200);
    const session = makeSession({
      answers: [{ questionId: loadQuestionsForDomain('x402')[0].id, answer: longAnswer, resolvedAt: '' }],
    });
    const prd = compilePRD(session);
    expect(prd.acceptanceCriteria[0].length).toBeLessThan(200);
    expect(prd.acceptanceCriteria[0]).toContain('…');
  });

  it('includes all required enforcer schema fields', () => {
    const prd = compilePRD(makeSession());
    expect(prd).toHaveProperty('sessionId');
    expect(prd).toHaveProperty('resolvedDecisions');
    expect(prd).toHaveProperty('acceptanceCriteria');
  });
});

// ─── formatPRDMarkdown ────────────────────────────────────────────────────────

describe('formatPRDMarkdown', () => {
  it('includes session ID and domain in header', () => {
    const prd = compilePRD(makeSession());
    const md = formatPRDMarkdown(prd);
    expect(md).toContain('abc123');
    expect(md).toContain('x402');
  });

  it('includes Resolved Decisions section', () => {
    const prd = compilePRD(makeSession());
    const md = formatPRDMarkdown(prd);
    expect(md).toContain('## Resolved Decisions');
  });

  it('includes Acceptance Criteria section', () => {
    const prd = compilePRD(makeSession());
    const md = formatPRDMarkdown(prd);
    expect(md).toContain('## Acceptance Criteria');
  });

  it('includes Unresolved Tradeoffs section when present', () => {
    const prd = compilePRD(makeSession());
    const md = formatPRDMarkdown(prd);
    expect(md).toContain('## Unresolved Tradeoffs');
  });

  it('omits Unresolved Tradeoffs when none', () => {
    const session = makeSession({
      answers: loadQuestionsForDomain('x402').slice(0, 3).map((q, i) => ({
        questionId: q.id,
        answer: `Answer ${i}`,
        resolvedAt: '',
      })),
    });
    const prd = compilePRD(session);
    const md = formatPRDMarkdown(prd);
    expect(md).not.toContain('## Unresolved Tradeoffs');
  });
});

// ─── sessionIdFor ─────────────────────────────────────────────────────────────

describe('sessionIdFor', () => {
  it('returns a 12-char hex string', () => {
    const id = sessionIdFor('x402', '2026-01-01T00:00:00Z');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = sessionIdFor('x402', '2026-01-01T00:00:00Z');
    const b = sessionIdFor('x402', '2026-01-01T00:00:00Z');
    expect(a).toBe(b);
  });

  it('differs for different domains or timestamps', () => {
    const a = sessionIdFor('x402', '2026-01-01T00:00:00Z');
    const b = sessionIdFor('xls65', '2026-01-01T00:00:00Z');
    const c = sessionIdFor('x402', '2026-01-02T00:00:00Z');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

// ─── createGrillStore ─────────────────────────────────────────────────────────

describe('createGrillStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nim-grill-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a session and reloads it correctly', () => {
    const store = createGrillStore(tmpDir);
    const questions = loadQuestionsForDomain('x402').slice(0, 5);
    const session = store.create('x402', questions);

    expect(session.id).toBeTruthy();
    expect(session.domain).toBe('x402');
    expect(session.status).toBe('active');
    expect(session.questions).toHaveLength(5);

    const reloaded = store.load(session.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.id).toBe(session.id);
    expect(reloaded!.questions).toHaveLength(5);
  });

  it('returns latest() as the most recently created session', () => {
    const store = createGrillStore(tmpDir);
    const questions = loadQuestionsForDomain('custom');
    store.create('x402', questions);
    const second = store.create('xls65', questions);

    const latest = store.latest();
    expect(latest).toBeDefined();
    expect(latest!.id).toBe(second.id);
  });

  it('returns undefined for latest() when no sessions exist', () => {
    const store = createGrillStore(tmpDir);
    expect(store.latest()).toBeUndefined();
  });

  it('appends an answer event and marks question resolved on replay', () => {
    const store = createGrillStore(tmpDir);
    const questions = loadQuestionsForDomain('x402').slice(0, 3);
    const session = store.create('x402', questions);

    store.answer(session.id, questions[0].id, 'My answer');

    const reloaded = store.load(session.id);
    expect(reloaded!.answers).toHaveLength(1);
    expect(reloaded!.answers[0].answer).toBe('My answer');
    expect(reloaded!.questions.find((q) => q.id === questions[0].id)!.resolved).toBe(true);
  });

  it('markCompiled changes status to compiled on replay', () => {
    const store = createGrillStore(tmpDir);
    const questions = loadQuestionsForDomain('custom');
    const session = store.create('custom', questions);
    store.markCompiled(session.id, '/tmp/prd.md');

    const reloaded = store.load(session.id);
    expect(reloaded!.status).toBe('compiled');
  });

  it('skips corrupt JSONL lines without throwing', () => {
    const store = createGrillStore(tmpDir);
    const questions = loadQuestionsForDomain('custom');
    const session = store.create('custom', questions);

    // Manually corrupt the file using static appendFileSync import
    appendFileSync(join(tmpDir, `${session.id}.jsonl`), 'NOT VALID JSON\n');

    // Should not throw, just skip the corrupt line
    const reloaded = store.load(session.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.domain).toBe('custom');
  });
});

// ─── createGrillHelper ────────────────────────────────────────────────────────

describe('createGrillHelper', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nim-grill-helper-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeHelper(questionsPerBatch = 5, minResolved = 3) {
    return createGrillHelper({ store: tmpDir, domain: 'x402', questionsPerBatch, minResolved });
  }

  it('session() returns undefined when no session exists', () => {
    const helper = makeHelper();
    expect(helper.session()).toBeUndefined();
  });

  it('next() returns empty array when no session', () => {
    const helper = makeHelper();
    expect(helper.next()).toHaveLength(0);
  });

  it('next() returns ≤ questionsPerBatch unresolved questions', () => {
    // Create a session manually to seed the store
    const store = createGrillStore(tmpDir);
    store.create('x402', loadQuestionsForDomain('x402'));

    const helper = makeHelper(3);
    const batch = helper.next();
    expect(batch.length).toBeLessThanOrEqual(3);
    expect(batch.every((q) => !q.resolved)).toBe(true);
  });

  it('answer() marks the question resolved', () => {
    const store = createGrillStore(tmpDir);
    const questions = loadQuestionsForDomain('x402').slice(0, 5);
    store.create('x402', questions);

    const helper = makeHelper();
    helper.answer(questions[0].id, 'Test answer');

    const session = helper.session();
    // The helper.session() reads from latest() — need to reload
    const reloaded = store.latest();
    expect(reloaded!.answers).toHaveLength(1);
  });

  it('status() returns correct counts', () => {
    const store = createGrillStore(tmpDir);
    const questions = loadQuestionsForDomain('x402').slice(0, 5);
    const session = store.create('x402', questions);
    store.answer(session.id, questions[0].id, 'A1');
    store.answer(session.id, questions[1].id, 'A2');

    const helper = makeHelper(5, 2);
    const status = helper.status();
    expect(status.resolved).toBe(2);
    expect(status.total).toBe(5);
    expect(status.complete).toBe(true); // minResolved = 2, reached
  });

  it('status().complete is false below minResolved', () => {
    const store = createGrillStore(tmpDir);
    const questions = loadQuestionsForDomain('x402').slice(0, 5);
    const session = store.create('x402', questions);
    store.answer(session.id, questions[0].id, 'A1');

    const helper = makeHelper(5, 5);
    const status = helper.status();
    expect(status.complete).toBe(false);
  });

  it('compile() throws when no session exists', () => {
    const helper = makeHelper();
    expect(() => helper.compile()).toThrow(/no active session/);
  });
});

// ─── questions.ts ─────────────────────────────────────────────────────────────

describe('DOMAIN_QUESTIONS', () => {
  it('x402 has 12 questions', () => {
    expect(X402_QUESTIONS).toHaveLength(12);
  });

  it('xls65 has 10 questions', () => {
    expect(XLS65_QUESTIONS).toHaveLength(10);
  });

  it('all questions have required fields', () => {
    const allBanks = [...X402_QUESTIONS, ...XLS65_QUESTIONS];
    for (const q of allBanks) {
      expect(q.id).toBeTruthy();
      expect(q.branch).toBeTruthy();
      expect(q.text.length).toBeGreaterThan(20);
      expect(q.recommendation.length).toBeGreaterThan(20);
    }
  });

  it('all x402 question IDs are unique', () => {
    const ids = X402_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all xls65 question IDs are unique', () => {
    const ids = XLS65_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('loadQuestionsForDomain initialises resolved: false', () => {
    const qs = loadQuestionsForDomain('x402');
    expect(qs.every((q) => q.resolved === false)).toBe(true);
  });

  it('loadQuestionsForDomain falls back to GENERIC for unknown domain', () => {
    const qs = loadQuestionsForDomain('unknown-domain');
    expect(qs.length).toBeGreaterThan(0);
    // Should not throw — returns GENERIC_QUESTIONS
  });
});

// ─── runHarnessed + enforcer schema verification ───────────────────────────────

describe('runHarnessed + grill enforcer', () => {
  it('passes when PRD has required schema fields', async () => {
    const skill: SkillDef = {
      name: 'grill-test',
      version: '0.10.0',
      harness: {
        enforcer: {
          strategies: [
            { kind: 'schema', required: ['sessionId', 'resolvedDecisions', 'acceptanceCriteria'] },
          ],
          mode: 'strict',
          maxHeals: 0,
        },
      },
      execute: () => ({
        sessionId: 'test-123',
        resolvedDecisions: [{ questionId: 'x402-001', question: 'Q?', answer: 'A.' }],
        acceptanceCriteria: ['[x402-001] A.'],
      }),
    };

    const result = await runHarnessed(skill, {}, {});
    expect(result.verified).toBe(true);
    expect((result.output as Record<string, unknown>).sessionId).toBe('test-123');
  });

  it('returns verified:false in strict mode when sessionId is missing', async () => {
    const skill: SkillDef = {
      name: 'grill-test-fail',
      version: '0.10.0',
      harness: {
        enforcer: {
          strategies: [
            { kind: 'schema', required: ['sessionId', 'resolvedDecisions', 'acceptanceCriteria'] },
          ],
          mode: 'strict', // strict + no reExecute → verified:false on first fail
          maxHeals: 0,
        },
      },
      execute: () => ({
        resolvedDecisions: [],
        acceptanceCriteria: [],
        // sessionId deliberately missing
      }),
    };

    const result = await runHarnessed(skill, {}, {});
    expect(result.verified).toBe(false);
    const failedCheck = result.checks.find((c) => !c.pass);
    expect(failedCheck).toBeDefined();
    expect(failedCheck?.reason).toContain('sessionId');
  });
});
