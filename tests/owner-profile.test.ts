import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { createOwnerProfileStore } from '../src/guard/owner-profile.js';
import { taskShapeFor, sectionsPresentIn, buildScaffold } from '../src/guard/owner-profile.js';

const STORE_FILE = '.nim-owner-profile-test/owner-profile.jsonl';

afterEach(() => rmSync('.nim-owner-profile-test', { recursive: true, force: true }));

describe('taskShapeFor', () => {
  it('is deterministic and stable for the same task-shape keywords', () => {
    expect(taskShapeFor('add a database migration')).toBe(taskShapeFor('add a database migration'));
  });

  it('groups similarly-worded tasks into the same shape (first significant keyword)', () => {
    expect(taskShapeFor('add a database migration')).toBe(taskShapeFor('add another migration script'));
  });

  it('differs for a genuinely different task shape', () => {
    expect(taskShapeFor('add a database migration')).not.toBe(taskShapeFor('delete the user table'));
  });
});

describe('sectionsPresentIn', () => {
  it('extracts markdown ## section headers from a proposal body', () => {
    const body = '# Proposal\n\n## Plan\n\ntext\n\n## Rollback\n\ntext\n';
    expect(sectionsPresentIn(body)).toEqual(['Plan', 'Rollback']);
  });

  it('returns an empty array when there are no section headers', () => {
    expect(sectionsPresentIn('just prose, no headers')).toEqual([]);
  });
});

describe('createOwnerProfileStore', () => {
  it('records an entry with task shape, sections, and approval latency', () => {
    const store = createOwnerProfileStore({ store: STORE_FILE });
    const entry = store.record({
      taskDescription: 'add a database migration',
      sectionsAtApproval: ['Plan', 'Rollback', 'Testing'],
      proposedAt: new Date(Date.now() - 5000).toISOString(),
      approvedAt: new Date().toISOString(),
    });
    expect(entry.taskShape).toBe(taskShapeFor('add a database migration'));
    expect(entry.approvalLatencyMs).toBeGreaterThanOrEqual(4900);
    expect(store.readAll()).toHaveLength(1);
  });

  it('persists across store instances (file-backed, load-on-construct — same shape as lessons/store.ts)', () => {
    const store1 = createOwnerProfileStore({ store: STORE_FILE });
    store1.record({
      taskDescription: 'add a database migration',
      sectionsAtApproval: ['Plan', 'Rollback'],
      proposedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
    });
    const store2 = createOwnerProfileStore({ store: STORE_FILE });
    expect(store2.readAll()).toHaveLength(1);
  });
});

describe('buildScaffold — advisory pre-fill from prior approvals (never skips the pause itself)', () => {
  it('falls back to the default Plan+Rollback sections when no prior history exists for this task shape', () => {
    const store = createOwnerProfileStore({ store: STORE_FILE });
    const scaffold = buildScaffold('add a database migration', store);
    expect(scaffold).toContain('## Plan');
    expect(scaffold).toContain('## Rollback');
  });

  it('pre-fills a section the owner previously always added for a similarly-shaped task', () => {
    const store = createOwnerProfileStore({ store: STORE_FILE });
    // Two prior approvals for the same task shape, both included a 'Testing' section the default scaffold lacks.
    store.record({
      taskDescription: 'add a database migration',
      sectionsAtApproval: ['Plan', 'Rollback', 'Testing'],
      proposedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
    });
    store.record({
      taskDescription: 'add another migration script',
      sectionsAtApproval: ['Plan', 'Rollback', 'Testing'],
      proposedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
    });
    const scaffold = buildScaffold('add a fresh migration', store);
    expect(scaffold).toContain('## Testing');
  });

  it('never removes the pause/approval mechanic — the scaffold always still requires an explicit approved: line to pass the guard', () => {
    const store = createOwnerProfileStore({ store: STORE_FILE });
    const scaffold = buildScaffold('add a database migration', store);
    expect(scaffold).not.toMatch(/^approved:/m);
  });
});
