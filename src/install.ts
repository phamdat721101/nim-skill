/**
 * src/install.ts
 * --------------
 * Skill-install logic, extracted from the CLI so it is unit-testable without
 * triggering commander's argv parse. Copies self-contained SKILL.md folders
 * into a host skills directory (Claude / Kiro / Cursor / custom).
 */

import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root (dist/.. or src/.. — both resolve to the repo root). */
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PRIMITIVES = ['nim-guard', 'nim-error-handler', 'nim-monitor', 'nim-enforcer', 'nim-context', 'nim-cache', 'nim-baseline', 'nim-index', 'nim-profile', 'nim-workspace', 'nim-lessons', 'nim-workrule'] as const;

/** The umbrella skill installs as a folder containing the top-level SKILL.md. */
export const UMBRELLA = 'nim-skill';

const CLAUDE_DIR = join(homedir(), '.claude', 'skills');

export const HOST_DIRS: Record<string, string> = {
  claude: CLAUDE_DIR,
  kiro: join(homedir(), '.kiro', 'skills'),
  cursor: join(homedir(), '.cursor', 'skills'),
};

/** Resolve the target skills directory from an explicit dir or a host name. */
export function resolveHostDir(host?: string, dir?: string): string | null {
  if (dir) return dir;
  return HOST_DIRS[host ?? 'claude'] ?? null;
}

/**
 * Auto-detect installed hosts by checking whether their base dir (e.g. ~/.claude)
 * exists. Returns the skills dirs for every detected host, or [claude] as a
 * sensible default when none are present. `exists` is injectable for tests.
 */
export function detectHostDirs(exists: (p: string) => boolean = existsSync): string[] {
  const found = Object.values(HOST_DIRS).filter((dir) => exists(dirname(dir)));
  return found.length ? found : [CLAUDE_DIR];
}

/**
 * Resolve where to install: explicit --dir wins; then --host; else auto-detect
 * every installed host. Returns null only when an explicit host is unknown.
 */
export function resolveTargetDirs(
  host?: string,
  dir?: string,
  exists: (p: string) => boolean = existsSync,
): string[] | null {
  if (dir) return [dir];
  if (host) {
    const d = HOST_DIRS[host];
    return d ? [d] : null;
  }
  return detectHostDirs(exists);
}

/** Expand targets (`all` or empty → every primitive + umbrella) and report unknowns. */
export function expandTargets(targets: string[]): { names: string[]; unknown: string[] } {
  const known = new Set<string>([...PRIMITIVES, UMBRELLA]);
  const list = targets.length === 0 ? ['all'] : targets;
  const expanded = list.flatMap((t) => (t === 'all' ? [...PRIMITIVES, UMBRELLA] : [t]));
  const unknown = expanded.filter((t) => !known.has(t));
  return { names: [...new Set(expanded)], unknown };
}

/** Source path for a target within the package. */
export function sourceOf(name: string, root: string = PKG_ROOT): string {
  return name === UMBRELLA ? join(root, 'SKILL.md') : join(root, 'skills', name);
}

/**
 * U1 `--lean`: trim reference sections for hosts without progressive disclosure.
 * Cuts everything from a `<!-- lean:cut -->` marker onward; otherwise keeps the
 * frontmatter + everything up to (but not including) the first `## Cross-links`
 * / `## Reference` heading. The trigger (frontmatter description) is preserved.
 */
export function leanFilter(md: string): string {
  const marker = md.indexOf('\n<!-- lean:cut -->');
  if (marker !== -1) return md.slice(0, marker).trimEnd() + '\n';
  const ref = md.search(/\n#{1,6}\s+(Cross-links|Reference)\b/i);
  return ref !== -1 ? md.slice(0, ref).trimEnd() + '\n' : md;
}

function applyLean(file: string): void {
  if (!existsSync(file)) return;
  writeFileSync(file, leanFilter(readFileSync(file, 'utf8')));
}

/** Install one skill into `dir`; returns the destination path. */
export function installSkill(name: string, dir: string, root: string = PKG_ROOT, lean = false): string {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, name);
  if (name === UMBRELLA) {
    mkdirSync(dest, { recursive: true });
    const destFile = join(dest, 'SKILL.md');
    cpSync(sourceOf(name, root), destFile);
    if (lean) applyLean(destFile);
  } else {
    cpSync(sourceOf(name, root), dest, { recursive: true });
    if (lean) applyLean(join(dest, 'SKILL.md'));
  }
  return dest;
}
