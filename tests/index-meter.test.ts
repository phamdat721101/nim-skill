import { describe, it, expect } from 'vitest';
import { estimate } from '../src/index-meter/estimate.js';
import { readSkillsDir } from '../src/index-meter/adapters.js';
import { scanVolatility } from '../src/index-meter/volatility.js';
import { createIndexMeter } from '../src/index-meter/index.js';

function fixture(count: number) {
  return Array.from({ length: count }, (_, i) => ({ name: `t${i}`, description: 'reads a file from disk' }));
}

describe('estimate — risk band boundaries', () => {
  it.each([
    [10, 'low-risk'],
    [20, 'low-risk'],
    [25, 'watch'],
    [26, 'elevated-risk'],
    [100, 'elevated-risk'],
    [101, 'high-risk'],
  ] as const)('%i tools -> %s', (count, band) => {
    const r = estimate(fixture(count), { estimatedTurnsPerTask: 5 });
    expect(r.riskBand).toBe(band);
    expect(r.toolCount).toBe(count);
  });

  it('estimatedTokensPerTask = estimatedTokensPerTurn * estimatedTurnsPerTask', () => {
    const r = estimate(fixture(10), { estimatedTurnsPerTask: 5 });
    expect(r.estimatedTokensPerTask).toBe(r.estimatedTokensPerTurn * 5);
  });
});

describe('scanVolatility', () => {
  it.each([
    ['loaded at 2026-07-16T10:00:00Z', true],
    ['build: a1b2c3d4e5f6', true],
    ['42 files available', true],
    ['unix time based cache', true],
    ['reads a file from disk', false],
    ['lists all users in a table', false],
    ['sends an HTTP GET request', false],
    ['formats currency values', false],
  ])('%s -> %s', (desc, expected) => {
    expect(scanVolatility(desc)).toBe(expected);
  });
});

describe('readSkillsDir', () => {
  it('reads this repo\'s own skills/ directory (dogfood)', () => {
    const entries = readSkillsDir('skills');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => typeof e.name === 'string' && typeof e.description === 'string')).toBe(true);
  });
});

describe('createIndexMeter', () => {
  it('measure() on this repo\'s own skills/ tool surface stays low-risk (dogfood)', () => {
    const meter = createIndexMeter({ estimatedTurnsPerTask: 5, mcpConfigPath: '.mcp.json', skillsDir: 'skills' });
    const manifest = readSkillsDir('skills');
    const report = meter.measure(manifest);
    expect(report.toolCount).toBe(manifest.length);
    expect(report.riskBand).toBe('low-risk'); // well under the 21-tool watch threshold at nim-skill's current scale
  });

  it('trim() keeps exactly the --keep list, never silently drops or adds', () => {
    const meter = createIndexMeter({ estimatedTurnsPerTask: 5, mcpConfigPath: '.mcp.json', skillsDir: 'skills' });
    const trimmed = meter.trim(fixture(40), { keep: ['t0', 't1', 't2'] });
    expect(trimmed.map((e) => e.name)).toEqual(['t0', 't1', 't2']);
  });

  it('measure() flags cache-fragile tools', () => {
    const meter = createIndexMeter({ estimatedTurnsPerTask: 5, mcpConfigPath: '.mcp.json', skillsDir: 'skills' });
    const report = meter.measure([
      { name: 'a', description: 'stable helper' },
      { name: 'b', description: 'build: a1b2c3d4e5f6' },
    ]);
    expect(report.cacheFragileTools).toEqual(['b']);
  });
});
