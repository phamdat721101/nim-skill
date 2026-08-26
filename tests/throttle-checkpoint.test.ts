import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { buildCheckpointSnapshot, writeCheckpoint } from '../src/throttle/checkpoint.js';

const TEST_DIR = '.nim-test-throttle-checkpoint';
const TEST_PATH = `${TEST_DIR}/active_session.md`;

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('checkpoint writer (Task 3)', () => {
  it('creates the file with a header on first write', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const snapshot = buildCheckpointSnapshot({ progress: 'implemented schema', next: 'implement trajectory gate', stepsUsed: 20 });
    writeCheckpoint(snapshot, TEST_PATH);
    expect(existsSync(TEST_PATH)).toBe(true);
    const content = readFileSync(TEST_PATH, 'utf8');
    expect(content).toContain('# Active session');
    expect(content).toContain('## Throttle checkpoint');
    expect(content).toContain('- Progress: implemented schema');
    expect(content).toContain('- Next: implement trajectory gate');
    expect(content).toContain('- Steps used: 20');
  });

  it('is append-only — a second write never removes the first entry', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeCheckpoint(buildCheckpointSnapshot({ progress: 'first', next: 'second task', stepsUsed: 20 }), TEST_PATH);
    writeCheckpoint(buildCheckpointSnapshot({ progress: 'second', next: 'third task', stepsUsed: 20 }), TEST_PATH);
    const content = readFileSync(TEST_PATH, 'utf8');
    expect(content).toContain('- Progress: first');
    expect(content).toContain('- Progress: second');
    expect(content.indexOf('- Progress: first')).toBeLessThan(content.indexOf('- Progress: second'));
  });

  it('renders exactly a 3-line body per snapshot (progress/next/steps-used)', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeCheckpoint(buildCheckpointSnapshot({ progress: 'p', next: 'n', stepsUsed: 20 }), TEST_PATH);
    const content = readFileSync(TEST_PATH, 'utf8');
    const block = content.split('## Throttle checkpoint').pop()!;
    const bodyLines = block.split('\n').filter((l) => l.trim().startsWith('- '));
    expect(bodyLines).toHaveLength(3);
  });
});
