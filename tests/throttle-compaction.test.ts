import { describe, it, expect } from 'vitest';
import { isNoisyTestCommand, compactTestOutput, interceptTestCommand } from '../src/throttle/test-interceptor.js';
import { resolveThrottleConfig } from '../src/throttle/schema.js';

function buildSyntheticGradleLog(lines: number): string {
  const rows: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (i === 42) rows.push('ERROR: NullPointerException at com.example.Foo.bar(Foo.java:42)');
    else if (i === 150) rows.push('FAIL: com.example.BarTest > testSomething FAIL');
    else rows.push(`> Task :module${i % 10}:compileJava UP-TO-DATE`);
  }
  return rows.join('\n');
}

describe('nim-throttle Pillar 2 — test command interceptor (Task 4)', () => {
  const config = resolveThrottleConfig({});

  it('matches configured noisy patterns (gradlew, npm test, vitest, pytest, mvn, cargo test)', () => {
    expect(isNoisyTestCommand('./gradlew test', config)).toBe(true);
    expect(isNoisyTestCommand('npm test', config)).toBe(true);
    expect(isNoisyTestCommand('npx vitest run', config)).toBe(true);
    expect(isNoisyTestCommand('pytest -v', config)).toBe(true);
    expect(isNoisyTestCommand('mvn clean install', config)).toBe(true);
    expect(isNoisyTestCommand('cargo test --release', config)).toBe(true);
  });

  it('does not match ordinary commands', () => {
    expect(isNoisyTestCommand('git status', config)).toBe(false);
    expect(isNoisyTestCommand('ls -la', config)).toBe(false);
  });

  it('does not match anything when subprocessCompaction.enabled is false', () => {
    const disabled = resolveThrottleConfig({ subprocessCompaction: { enabled: false } });
    expect(isNoisyTestCommand('./gradlew test', disabled)).toBe(false);
  });

  it('reduces a synthetic 300-line Gradle log by >= 75% while preserving error lines', () => {
    const raw = buildSyntheticGradleLog(300);
    const result = compactTestOutput(raw, config);
    expect(result.reductionPct).toBeGreaterThanOrEqual(75);
    expect(result.text).toContain('NullPointerException');
    expect(result.text).toContain('FAIL: com.example.BarTest');
  });

  it('interceptTestCommand() passes through unchanged for a non-noisy command', () => {
    const raw = buildSyntheticGradleLog(300);
    const outcome = interceptTestCommand('git status', raw, config);
    expect(outcome.compacted).toBe(false);
    expect(outcome.output).toBe(raw);
  });

  it('interceptTestCommand() compacts for a matched noisy command', () => {
    const raw = buildSyntheticGradleLog(300);
    const outcome = interceptTestCommand('./gradlew test', raw, config);
    expect(outcome.compacted).toBe(true);
    expect(outcome.result?.reductionPct).toBeGreaterThanOrEqual(75);
  });
});
