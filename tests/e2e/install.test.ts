import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRIMITIVES,
  UMBRELLA,
  resolveHostDir,
  resolveTargetDirs,
  detectHostDirs,
  expandTargets,
  sourceOf,
  installSkill,
  HOST_DIRS,
} from '../../src/install.js';

const TMP = '.nim-install-test';
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('expandTargets', () => {
  it('expands `all` to every primitive + the umbrella', () => {
    const { names, unknown } = expandTargets(['all']);
    expect(unknown).toHaveLength(0);
    expect(names).toEqual([...PRIMITIVES, UMBRELLA]);
  });
  it('defaults empty targets to `all`', () => {
    expect(expandTargets([]).names).toEqual([...PRIMITIVES, UMBRELLA]);
  });
  it('dedupes and flags unknown targets', () => {
    const { names, unknown } = expandTargets(['nim-guard', 'nim-guard', 'bogus']);
    expect(names).toEqual(['nim-guard', 'bogus']);
    expect(unknown).toEqual(['bogus']);
  });
});

describe('detectHostDirs', () => {
  it('returns skills dirs for hosts whose base dir exists', () => {
    const onlyKiro = (p: string) => p.includes('.kiro');
    expect(detectHostDirs(onlyKiro)).toEqual([HOST_DIRS.kiro]);
  });
  it('falls back to claude when no host is detected', () => {
    expect(detectHostDirs(() => false)).toEqual([HOST_DIRS.claude]);
  });
});

describe('resolveTargetDirs', () => {
  it('explicit --dir wins', () => {
    expect(resolveTargetDirs(undefined, '/custom')).toEqual(['/custom']);
  });
  it('explicit --host maps to its dir', () => {
    expect(resolveTargetDirs('kiro')).toEqual([HOST_DIRS.kiro]);
  });
  it('returns null for an unknown host', () => {
    expect(resolveTargetDirs('nope')).toBeNull();
  });
  it('auto-detects when neither host nor dir given', () => {
    expect(resolveTargetDirs(undefined, undefined, () => false)).toEqual([HOST_DIRS.claude]);
  });
});

describe('resolveHostDir', () => {
  it('maps known hosts and defaults to claude', () => {
    expect(resolveHostDir('kiro')).toBe(HOST_DIRS.kiro);
    expect(resolveHostDir(undefined)).toBe(HOST_DIRS.claude);
  });
  it('an explicit dir overrides the host', () => {
    expect(resolveHostDir('kiro', '/custom')).toBe('/custom');
  });
  it('returns null for an unknown host', () => {
    expect(resolveHostDir('nope')).toBeNull();
  });
});

describe('installSkill', () => {
  it('copies a primitive folder with its SKILL.md', () => {
    const dest = installSkill('nim-enforcer', TMP);
    expect(dest).toBe(join(TMP, 'nim-enforcer'));
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toMatch(/name: nim-enforcer/);
  });

  it('installs the umbrella as nim-skill/SKILL.md', () => {
    const dest = installSkill(UMBRELLA, TMP);
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toMatch(/name: nim-skill/);
  });

  it('every primitive source exists and installs', () => {
    for (const p of PRIMITIVES) {
      expect(existsSync(sourceOf(p))).toBe(true);
      const dest = installSkill(p, TMP);
      expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toMatch(new RegExp(`name: ${p}`));
    }
  });
});
