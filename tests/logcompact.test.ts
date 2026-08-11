import { describe, it, expect } from 'vitest';
import { capLines, filterErrors, compact } from '../src/logcompact/compact.js';
import { createLogCompactHelper } from '../src/logcompact/index.js';

function lines(n: number, factory: (i: number) => string = (i) => `line ${i}`): string {
  return Array.from({ length: n }, (_, i) => factory(i)).join('\n');
}

describe('capLines', () => {
  it('returns input unchanged when under the cap', () => {
    const input = lines(5);
    expect(capLines(input, 100)).toBe(input);
  });

  it('truncates to the first N lines when over the cap', () => {
    const input = lines(500);
    const out = capLines(input, 100);
    expect(out.split('\n')).toHaveLength(100);
    expect(out.split('\n')[0]).toBe('line 0');
    expect(out.split('\n')[99]).toBe('line 99');
  });

  it('handles empty input', () => {
    expect(capLines('', 100)).toBe('');
  });
});

describe('filterErrors', () => {
  it('keeps only ERROR/FAIL/FATAL/Exception lines plus surrounding context', () => {
    const input = [
      'info: starting up',
      'info: connecting to db',
      'ERROR: connection refused',
      'info: retrying',
      'info: done',
    ].join('\n');
    const out = filterErrors(input, 1);
    expect(out).toContain('ERROR: connection refused');
    // context line before/after the match is kept
    expect(out).toContain('info: connecting to db');
    expect(out).toContain('info: retrying');
    // unrelated lines far from any match are dropped
    expect(out).not.toContain('info: starting up');
    expect(out).not.toContain('info: done');
  });

  it('matches FAIL, FATAL, Exception, and "error:" (case-insensitive) markers', () => {
    for (const marker of ['FAIL', 'FATAL', 'Exception', 'error:', 'Error:']) {
      const input = `noise line\n${marker} something broke\nmore noise`;
      const out = filterErrors(input, 0);
      expect(out).toContain(marker);
    }
  });

  it('returns empty string when no error markers are present', () => {
    const input = lines(50, (i) => `info: step ${i} ok`);
    expect(filterErrors(input, 2)).toBe('');
  });

  it('deduplicates overlapping context windows from adjacent matches', () => {
    const input = ['ERROR: one', 'ERROR: two', 'info: tail'].join('\n');
    const out = filterErrors(input, 1);
    // both errors + shared context line should appear without duplication
    expect(out.split('\n').filter((l) => l === 'ERROR: one')).toHaveLength(1);
    expect(out.split('\n').filter((l) => l === 'ERROR: two')).toHaveLength(1);
  });
});

describe('compact — strategy dispatch', () => {
  it('"cap" strategy caps lines without filtering', () => {
    const input = lines(300, (i) => (i === 150 ? 'ERROR: boom' : `info: step ${i}`));
    const out = compact(input, { strategy: 'cap', maxLines: 100 });
    expect(out.split('\n')).toHaveLength(100);
    // cap-only strategy does not guarantee the error line survives (it's before line 100... wait it's at 150)
  });

  it('"errors-only" strategy filters to error context and caps the result', () => {
    const input = lines(1000, (i) => (i === 500 ? 'ERROR: boom' : `info: step ${i}`));
    const out = compact(input, { strategy: 'errors-only', maxLines: 50 });
    expect(out).toContain('ERROR: boom');
    expect(out.split('\n').length).toBeLessThanOrEqual(50);
  });

  it('"incremental" strategy returns a summary (line count + first/last lines) for very large input', () => {
    const input = lines(2000);
    const out = compact(input, { strategy: 'incremental', maxLines: 20 });
    expect(out).toContain('2000');
    expect(out).toContain('line 0');
  });

  it('defaults to "errors-only" when no strategy is specified', () => {
    const input = lines(200, (i) => (i === 50 ? 'FATAL: crash' : `info ${i}`));
    const out = compact(input, {});
    expect(out).toContain('FATAL: crash');
  });
});

describe('compact — escalateOnEmpty fallback', () => {
  it('falls back to a capped-but-unfiltered slice when filtering yields nothing and escalateOnEmpty is true (default)', () => {
    const input = lines(200, (i) => `info: step ${i} nothing wrong here`);
    const out = compact(input, { strategy: 'errors-only', maxLines: 30, escalateOnEmpty: true });
    expect(out).not.toBe('');
    expect(out.split('\n').length).toBeLessThanOrEqual(30);
  });

  it('returns empty string when filtering yields nothing and escalateOnEmpty is false', () => {
    const input = lines(200, (i) => `info: step ${i} nothing wrong here`);
    const out = compact(input, { strategy: 'errors-only', maxLines: 30, escalateOnEmpty: false });
    expect(out).toBe('');
  });
});

describe('createLogCompactHelper', () => {
  it('reports originalChars/compactedChars/reductionPct alongside the compacted text', () => {
    const helper = createLogCompactHelper({ strategy: 'errors-only', maxLines: 50 });
    const input = lines(1000, (i) => (i === 500 ? 'ERROR: boom' : `info: step ${i} all is well`));
    const result = helper.compact(input);
    expect(result.text).toContain('ERROR: boom');
    expect(result.originalChars).toBe(input.length);
    expect(result.compactedChars).toBeLessThan(result.originalChars);
    expect(result.reductionPct).toBeGreaterThan(0);
    expect(result.reductionPct).toBeLessThanOrEqual(100);
  });

  it('reductionPct is 0 (not negative/NaN) when input is already smaller than any cap', () => {
    const helper = createLogCompactHelper({ strategy: 'cap', maxLines: 100 });
    const input = 'a single short line';
    const result = helper.compact(input);
    expect(result.text).toBe(input);
    expect(result.reductionPct).toBe(0);
  });

  it('handles empty input without throwing', () => {
    const helper = createLogCompactHelper({});
    const result = helper.compact('');
    expect(result.text).toBe('');
    expect(result.originalChars).toBe(0);
    expect(result.compactedChars).toBe(0);
    expect(result.reductionPct).toBe(0);
  });
});
