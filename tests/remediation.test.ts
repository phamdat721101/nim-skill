import { describe, it, expect } from 'vitest';
import { lookupRemediation, DEFAULT_REMEDIATION_TABLE, type RemediationRule } from '../src/error-handler/remediation.js';

describe('lookupRemediation', () => {
  it('matches file-not-found (ENOENT-shaped message)', () => {
    const r = lookupRemediation('Error: ENOENT: no such file or directory');
    expect(r).toEqual({
      errorType: 'file-not-found',
      actionRequired: 'Stop guessing the path. List the parent directory to verify the exact name before retrying.',
    });
  });

  it('matches compilation-failed', () => {
    const r = lookupRemediation('TypeScript compilation failed with 3 errors');
    expect(r).toEqual({
      errorType: 'compilation-failed',
      actionRequired: 'Read only the first reported failure location. Do not modify files unrelated to that location.',
    });
  });

  it('matches tool-syntax-error', () => {
    const r = lookupRemediation('invalid arguments: missing required field "path"');
    expect(r).toEqual({
      errorType: 'tool-syntax-error',
      actionRequired: 'The arguments did not match the tool schema. Re-check required fields and types before retrying — do not repeat the same call unchanged.',
    });
  });

  it('matches search-zero-results', () => {
    const r = lookupRemediation('search returned 0 results found for pattern');
    expect(r).toEqual({
      errorType: 'search-zero-results',
      actionRequired: 'A single zero-result search is not proof of absence. Verify with a second, independent method (e.g. a direct filesystem check) before concluding the target does not exist.',
    });
  });

  it('returns undefined when nothing matches', () => {
    expect(lookupRemediation('unrelated message with no known shape')).toBeUndefined();
  });

  it('gives extraRules precedence over a default rule that would also match', () => {
    const customRule: RemediationRule = {
      pattern: /no such file/i,
      errorType: 'custom-file-missing',
      actionRequired: 'Use the custom project-specific recovery path.',
    };
    const r = lookupRemediation('no such file or directory: /tmp/x', [customRule]);
    expect(r).toEqual({
      errorType: 'custom-file-missing',
      actionRequired: 'Use the custom project-specific recovery path.',
    });
  });

  it('falls back to the default table when extraRules do not match', () => {
    const customRule: RemediationRule = {
      pattern: /never-matches-anything-xyz/,
      errorType: 'custom',
      actionRequired: 'n/a',
    };
    const r = lookupRemediation('ENOENT: no such file', [customRule]);
    expect(r?.errorType).toBe('file-not-found');
  });

  it('exposes exactly 4 default rules', () => {
    expect(DEFAULT_REMEDIATION_TABLE).toHaveLength(4);
  });
});
