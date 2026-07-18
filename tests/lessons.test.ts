import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { createLessonsStore } from '../src/lessons/store.js';
import { matchesShape } from '../src/lessons/match.js';
import { createLessonsHelper } from '../src/lessons/index.js';
import type { TriggerShape } from '../src/lessons/types.js';

function cleanup(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

describe('createLessonsStore (LS-02)', () => {
  it('appends and reads back a lesson from a fresh store file', () => {
    const path = '.nim/test-lessons.jsonl';
    cleanup(path);
    const store = createLessonsStore({ store: path, ttlMs: 86_400_000 });
    store.append({
      id: 'l1',
      capturedAt: new Date().toISOString(),
      triggerShape: { toolName: 'Write', pathGlob: '**/*.md', contentSignal: null },
      whatWentWrong: 'x',
      correctPattern: 'y',
      severity: 'info',
      source: 'manual',
    });
    expect(store.readAll()).toHaveLength(1);
    cleanup(path);
  });

  it('expires lessons past ttlMs on read', () => {
    const path = '.nim/test-lessons-ttl.jsonl';
    cleanup(path);
    const store = createLessonsStore({ store: path, ttlMs: 1 });
    store.append({
      id: 'l2',
      capturedAt: new Date(Date.now() - 10_000).toISOString(),
      triggerShape: { toolName: 'Write', pathGlob: '*', contentSignal: null },
      whatWentWrong: 'x',
      correctPattern: 'y',
      severity: 'info',
      source: 'manual',
    });
    expect(store.readAll()).toHaveLength(0);
    cleanup(path);
  });

  it('persists across store instances (file-backed, same as src/memory)', () => {
    const path = '.nim/test-lessons-persist.jsonl';
    cleanup(path);
    const store1 = createLessonsStore({ store: path, ttlMs: 86_400_000 });
    store1.append({
      id: 'l3',
      capturedAt: new Date().toISOString(),
      triggerShape: { toolName: 'Write', pathGlob: '*', contentSignal: null },
      whatWentWrong: 'x',
      correctPattern: 'y',
      severity: 'info',
      source: 'manual',
    });
    const store2 = createLessonsStore({ store: path, ttlMs: 86_400_000 });
    expect(store2.readAll()).toHaveLength(1);
    cleanup(path);
  });
});

describe('matchesShape (LS-03)', () => {
  it('matches on exact toolName + glob pathGlob + matching contentSignal', () => {
    const logged: TriggerShape = { toolName: 'Write', pathGlob: 'research/**/*.md', contentSignal: 'off-stack-cluster' };
    const candidate: TriggerShape = { toolName: 'Write', pathGlob: 'research/cross-product/foo.md', contentSignal: 'off-stack-cluster' };
    expect(matchesShape(candidate, logged)).toBe(true);
  });

  it('does not match a different toolName', () => {
    const logged: TriggerShape = { toolName: 'Write', pathGlob: '*', contentSignal: null };
    const candidate: TriggerShape = { toolName: 'Read', pathGlob: 'anything.md', contentSignal: null };
    expect(matchesShape(candidate, logged)).toBe(false);
  });

  it('matches any toolName when logged.toolName is a wildcard', () => {
    const logged: TriggerShape = { toolName: '*', pathGlob: '*.md', contentSignal: null };
    const candidate: TriggerShape = { toolName: 'Edit', pathGlob: 'foo.md', contentSignal: null };
    expect(matchesShape(candidate, logged)).toBe(true);
  });

  it('treats a null contentSignal on either side as a wildcard match', () => {
    const logged: TriggerShape = { toolName: 'Write', pathGlob: '*', contentSignal: null };
    const candidate: TriggerShape = { toolName: 'Write', pathGlob: 'foo.md', contentSignal: 'off-stack-cluster' };
    expect(matchesShape(candidate, logged)).toBe(true);
  });

  it('does not match when both sides declare a different non-null contentSignal', () => {
    const logged: TriggerShape = { toolName: 'Write', pathGlob: '*', contentSignal: 'off-stack-cluster' };
    const candidate: TriggerShape = { toolName: 'Write', pathGlob: 'foo.md', contentSignal: 'something-else' };
    expect(matchesShape(candidate, logged)).toBe(false);
  });

  it('does not match a candidate path outside the logged glob', () => {
    const logged: TriggerShape = { toolName: 'Write', pathGlob: 'research/**/*.md', contentSignal: null };
    const candidate: TriggerShape = { toolName: 'Write', pathGlob: 'src/index.ts', contentSignal: null };
    expect(matchesShape(candidate, logged)).toBe(false);
  });
});

describe('createLessonsHelper (LS-04)', () => {
  const path = '.nim/test-lessons-helper.jsonl';

  afterEach(() => cleanup(path));

  it('capture() appends a lesson with a generated id + capturedAt, check() finds it by shape', () => {
    const helper = createLessonsHelper({ store: path, ttlMs: 86_400_000 });
    const captured = helper.capture({
      triggerShape: { toolName: 'Write', pathGlob: 'research/**/*.md', contentSignal: 'off-stack-cluster' },
      whatWentWrong: 'Wrote Java/Spring content into a TypeScript/web3 workspace.',
      correctPattern: 'Verify content stack signal against workspace.stack before writing.',
      severity: 'critical',
      source: 'auto',
    });
    expect(captured.id).toBeTruthy();
    expect(captured.capturedAt).toBeTruthy();

    const matches = helper.check({ toolName: 'Write', pathGlob: 'research/cross-product/x.md', contentSignal: 'off-stack-cluster' });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(captured.id);
  });

  it('check() returns no matches for an unrelated shape', () => {
    const helper = createLessonsHelper({ store: path, ttlMs: 86_400_000 });
    helper.capture({
      triggerShape: { toolName: 'Write', pathGlob: 'research/**/*.md', contentSignal: 'off-stack-cluster' },
      whatWentWrong: 'x',
      correctPattern: 'y',
      severity: 'info',
      source: 'manual',
    });
    const matches = helper.check({ toolName: 'Read', pathGlob: 'anything', contentSignal: null });
    expect(matches).toHaveLength(0);
  });
});
