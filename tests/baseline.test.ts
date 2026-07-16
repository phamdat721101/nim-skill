import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  checkLen,
  checkBudget,
  checkDerivable,
  checkLintable,
  checkTaskSpecific,
  checkProgressive,
} from '../src/baseline/rules.js';
import { DERIVABLE_PHRASES, LINTABLE_PHRASES, TASKSPECIFIC_STOPWORDS } from '../src/baseline/generic-phrases.js';
import { scaffold } from '../src/baseline/scaffold.js';
import { createBaselineLinter } from '../src/baseline/index.js';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i} does something specific`).join('\n');

describe('checkLen (BL-LEN)', () => {
  it('passes a clean 40-line fixture', () => {
    const r = checkLen(lines(40), { maxLines: 100, blockLines: 150 });
    expect(r.pass).toBe(true);
  });

  it('warns (fails, non-blocking) past maxLines but under blockLines', () => {
    const r = checkLen(lines(120), { maxLines: 100, blockLines: 150 });
    expect(r.pass).toBe(false);
    expect(r.strategy).toBe('BL-LEN');
  });

  it('fires on a 400-line fixture exceeding blockLines', () => {
    const r = checkLen(lines(400), { maxLines: 100, blockLines: 150 });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/150/);
  });
});

describe('checkBudget (BL-BUDGET)', () => {
  it('passes under the instruction ceiling', () => {
    const text = Array.from({ length: 10 }, (_, i) => `- do thing ${i}`).join('\n');
    expect(checkBudget(text, { maxInstructions: 100 }).pass).toBe(true);
  });

  it('fails over the instruction ceiling', () => {
    const text = Array.from({ length: 150 }, (_, i) => `- always do thing ${i}`).join('\n');
    const r = checkBudget(text, { maxInstructions: 100 });
    expect(r.pass).toBe(false);
    expect(r.strategy).toBe('BL-BUDGET');
  });
});

describe('checkDerivable (BL-DERIVABLE)', () => {
  it('zero false positives on this repo\'s own AGENTS.md', () => {
    const text = readFileSync('AGENTS.md', 'utf8');
    expect(checkDerivable(text, DERIVABLE_PHRASES).pass).toBe(true);
  });

  it('fires on generic advice phrasing', () => {
    const r = checkDerivable('Always write readable code and use meaningful variable names.', DERIVABLE_PHRASES);
    expect(r.pass).toBe(false);
    expect(r.strategy).toBe('BL-DERIVABLE');
  });
});

describe('checkLintable (BL-LINTABLE)', () => {
  it('does not fire without a detected lint config', () => {
    const r = checkLintable('Always use single quotes, never double quotes.', LINTABLE_PHRASES, false);
    expect(r.pass).toBe(true);
  });

  it('fires when a lint-duplicate phrase AND a lint config are both present', () => {
    const r = checkLintable('Always use single quotes, never double quotes.', LINTABLE_PHRASES, true);
    expect(r.pass).toBe(false);
    expect(r.strategy).toBe('BL-LINTABLE');
  });
});

describe('checkTaskSpecific (BL-TASKSPECIFIC)', () => {
  it('passes short unrelated prose', () => {
    expect(checkTaskSpecific('This is a short orientation file.', TASKSPECIFIC_STOPWORDS).pass).toBe(true);
  });

  it('fires on a clustered domain-specific block >=8 lines with >=3 stopwords', () => {
    const block = [
      'The users table has a schema migration pending.',
      'Each column in the table maps to an endpoint field.',
      'The migration script rewrites the schema.',
      'Endpoint responses read directly from the table.',
      'A new column was added to support the endpoint.',
      'The schema migration also touches a second table.',
      'Row-level data in the table follows the endpoint schema.',
      'This column and that column both feed the same endpoint.',
    ].join('\n');
    const r = checkTaskSpecific(block, TASKSPECIFIC_STOPWORDS);
    expect(r.pass).toBe(false);
    expect(r.strategy).toBe('BL-TASKSPECIFIC');
  });
});

describe('checkProgressive (BL-PROGRESSIVE + BL-EMPTYFOLDER)', () => {
  it('does not fire below the maxLines warn threshold', () => {
    const results = checkProgressive(lines(40), { maxLines: 100, detailDir: 'agent_docs' });
    expect(results.every((r) => r.pass)).toBe(true);
  });

  it('fires BL-PROGRESSIVE past maxLines with no referenced detail file', () => {
    const results = checkProgressive(lines(120), { maxLines: 100, detailDir: 'agent_docs' });
    const progressive = results.find((r) => r.strategy === 'BL-PROGRESSIVE');
    expect(progressive?.pass).toBe(false);
  });

  it('passes BL-PROGRESSIVE when a detail-dir link is referenced past threshold', () => {
    const text = lines(120) + '\nSee [details](agent_docs/schema.md) for more.';
    const results = checkProgressive(text, { maxLines: 100, detailDir: 'agent_docs' });
    const progressive = results.find((r) => r.strategy === 'BL-PROGRESSIVE');
    expect(progressive?.pass).toBe(true);
  });
});

describe('scaffold', () => {
  it('round-trips through the linter with 0 blocking findings', () => {
    const md = scaffold({ projectType: 'ts-lib', testCmd: 'npm test', buildCmd: 'npm run build', styleDeviations: [] });
    const linter = createBaselineLinter({ maxLines: 100, blockLines: 150, maxInstructions: 100, mode: 'warn', detailDir: 'agent_docs' });
    const findings = linter.lint(md).filter((c) => !c.pass);
    expect(findings).toHaveLength(0);
  });
});

describe('createBaselineLinter', () => {
  it('lints this repo\'s own AGENTS.md with 0 findings (dogfood)', () => {
    const text = readFileSync('AGENTS.md', 'utf8');
    const linter = createBaselineLinter({ maxLines: 100, blockLines: 150, maxInstructions: 100, mode: 'warn', detailDir: 'agent_docs' });
    const findings = linter.lint(text).filter((c) => !c.pass);
    expect(findings).toHaveLength(0);
  });

  it('audit() checks progressive-disclosure structure for a directory', () => {
    const linter = createBaselineLinter({ maxLines: 100, blockLines: 150, maxInstructions: 100, mode: 'warn', detailDir: 'agent_docs' });
    const results = linter.audit('.');
    expect(Array.isArray(results)).toBe(true);
  });
});
