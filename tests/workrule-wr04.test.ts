import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { isUnfilteredGradleTest, checkWr04MandatoryFilter } from '../src/workrule/rules/wr04.js';
import { createWorkruleStore } from '../src/workrule/store.js';

const TEST_LOG = '.nim-test-wr04/agent-support-log.md';

afterEach(() => {
  if (existsSync('.nim-test-wr04')) rmSync('.nim-test-wr04', { recursive: true, force: true });
});

describe('WR-04 mandatory-filter rule (Task 5)', () => {
  it('isUnfilteredGradleTest() detects a raw ./gradlew test with no --tests filter', () => {
    expect(isUnfilteredGradleTest('./gradlew test')).toBe(true);
    expect(isUnfilteredGradleTest('run ./gradlew test now')).toBe(true);
  });

  it('isUnfilteredGradleTest() does not flag a filtered invocation', () => {
    expect(isUnfilteredGradleTest('./gradlew test --tests com.example.FooTest')).toBe(false);
  });

  it('isUnfilteredGradleTest() does not flag unrelated commands', () => {
    expect(isUnfilteredGradleTest('npm test')).toBe(false);
    expect(isUnfilteredGradleTest('./gradlew build')).toBe(false);
  });

  it('does not trigger on a single logged unfiltered run', () => {
    const store = createWorkruleStore({ logFile: TEST_LOG });
    store.append({ primitive: 'manual', effect: 'ran ./gradlew test to check the build' });
    const finding = checkWr04MandatoryFilter(store);
    expect(finding.triggered).toBe(false);
    expect(finding.occurrences).toBe(1);
  });

  it('triggers a warning at 2+ logged unfiltered runs (iterative-loop signal)', () => {
    const store = createWorkruleStore({ logFile: TEST_LOG });
    store.append({ primitive: 'manual', effect: 'ran ./gradlew test to check the build' });
    store.append({ primitive: 'manual', effect: 'ran ./gradlew test again after a fix' });
    const finding = checkWr04MandatoryFilter(store);
    expect(finding.triggered).toBe(true);
    expect(finding.occurrences).toBe(2);
    expect(finding.message).toMatch(/WR-04/);
    expect(finding.message).toMatch(/--tests/);
  });

  it('does not count filtered runs toward the occurrence total', () => {
    const store = createWorkruleStore({ logFile: TEST_LOG });
    store.append({ primitive: 'manual', effect: 'ran ./gradlew test --tests com.example.FooTest' });
    store.append({ primitive: 'manual', effect: 'ran ./gradlew test --tests com.example.BarTest' });
    const finding = checkWr04MandatoryFilter(store);
    expect(finding.triggered).toBe(false);
    expect(finding.occurrences).toBe(0);
  });
});
