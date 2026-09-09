/**
 * src/install.ts
 * --------------
 * Skill-install logic, extracted from the CLI so it is unit-testable without
 * triggering commander's argv parse. Copies self-contained SKILL.md folders
 * into a host skills directory (Claude / Kiro / Cursor / custom).
 */

import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root (dist/.. or src/.. — both resolve to the repo root). */
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PRIMITIVES = ['nim-guard', 'nim-error-handler', 'nim-monitor', 'nim-enforcer', 'nim-context', 'nim-cache', 'nim-baseline', 'nim-index', 'nim-profile', 'nim-workspace', 'nim-lessons', 'nim-workrule', 'nim-logcompact', 'nim-propose', 'nim-grill', 'nim-deliver', 'nim-search', 'nim-compact', 'nim-globalmem', 'nim-auditor'] as const;

/** The umbrella skill installs as a folder containing the top-level SKILL.md. */
export const UMBRELLA = 'nim-skill';

const CLAUDE_DIR = join(homedir(), '.claude', 'skills');

export const HOST_DIRS: Record<string, string> = {
  claude: CLAUDE_DIR,
  kiro: join(homedir(), '.kiro', 'skills'),
  cursor: join(homedir(), '.cursor', 'skills'),
  codex: join(homedir(), '.codex', 'skills'),
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

export type HookHost = keyof typeof HOST_DIRS;

/** Native config path and events used by the default profile. Kept data-only so
 * tests can assert exact host contracts without touching a real home directory. */
export function lifecycleRegistration(host: HookHost, command = `node ${join(PKG_ROOT, 'dist', 'cli.js')} hooks dispatch`): { path: string; config: Record<string, unknown> } {
  const root = homedir();
  const event = (name: string) => `${command} --host ${host} --event ${name} --stdin`;
  if (host === 'kiro') return { path: join(root, '.kiro', 'hooks', 'nim-skill.json'), config: { version: 'v1', hooks: [{ name: 'nim-skill-start', trigger: 'AgentSpawn', action: { type: 'command', command: event('start') } }, { name: 'nim-skill-pre-tool', trigger: 'PreToolUse', matcher: '*', action: { type: 'command', command: event('pre-tool') } }, { name: 'nim-skill-post-tool', trigger: 'PostToolUse', matcher: '*', action: { type: 'command', command: event('post-tool') } }, { name: 'nim-skill-end', trigger: 'AgentStop', action: { type: 'command', command: event('end') } }] } };
  const native = host === 'cursor' ? { sessionStart: [{ command: event('start') }], preToolUse: [{ command: event('pre-tool'), failClosed: true }], postToolUse: [{ command: event('post-tool') }], sessionEnd: [{ command: event('end') }] } : host === 'codex' ? { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: event('start') }] }], PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: event('pre-tool') }] }], PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: event('post-tool') }] }], SessionEnd: [{ matcher: '', hooks: [{ type: 'command', command: event('end') }] }] } : { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: event('start') }] }], PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: event('pre-tool') }] }], PostToolUseFailure: [{ matcher: '', hooks: [{ type: 'command', command: event('post-tool') }] }], SessionEnd: [{ matcher: '', hooks: [{ type: 'command', command: event('end') }] }] };
  const file = host === 'cursor' ? join(root, '.cursor', 'hooks.json') : join(root, `.${host}`, 'hooks.json');
  return { path: file, config: { description: 'nim-skill default lifecycle hooks', hooks: native } };
}

/** Transactional replacement for the nim-owned config file. Host configuration
 * remains opt-in through `install`; unrelated JSON is merged at the top level. */
export function installLifecycleHooks(host: HookHost): string {
  const registration = lifecycleRegistration(host); mkdirSync(dirname(registration.path), { recursive: true });
  let current: Record<string, unknown> = {};
  if (existsSync(registration.path)) {
    try { current = JSON.parse(readFileSync(registration.path, 'utf8')) as Record<string, unknown>; } catch { throw new Error(`nim: cannot safely merge invalid JSON at ${registration.path}`); }
  }
  const backup = `${registration.path}.nim-skill-${Date.now()}.bak`;
  if (existsSync(registration.path)) cpSync(registration.path, backup);
  const tmp = `${registration.path}.nim-skill-tmp`;
  const currentHooks = current.hooks;
  const installedHooks = registration.config.hooks;
  const isOurs = (value: unknown): boolean => JSON.stringify(value).includes('hooks dispatch');
  let hooks: unknown = installedHooks;
  if (Array.isArray(currentHooks) && Array.isArray(installedHooks)) hooks = [...currentHooks.filter((entry) => !isOurs(entry)), ...installedHooks];
  else if (currentHooks && installedHooks && typeof currentHooks === 'object' && typeof installedHooks === 'object') {
    hooks = Object.fromEntries([...new Set([...Object.keys(currentHooks as Record<string, unknown>), ...Object.keys(installedHooks as Record<string, unknown>)])].map((key) => {
      const prior = (currentHooks as Record<string, unknown>)[key]; const next = (installedHooks as Record<string, unknown>)[key];
      return [key, Array.isArray(prior) && Array.isArray(next) ? [...prior.filter((entry) => !isOurs(entry)), ...next] : next ?? prior];
    }));
  }
  try { writeFileSync(tmp, `${JSON.stringify({ ...current, ...registration.config, hooks }, null, 2)}\n`); renameSync(tmp, registration.path); } catch (error) { if (existsSync(backup)) cpSync(backup, registration.path); throw error; }
  return registration.path;
}

/** Remove only nim-owned handlers, retaining unrelated host settings. */
export function disableLifecycleHooks(host: HookHost): boolean {
  const registration = lifecycleRegistration(host); if (!existsSync(registration.path)) return false;
  let current: Record<string, unknown>; try { current = JSON.parse(readFileSync(registration.path, 'utf8')) as Record<string, unknown>; } catch { throw new Error(`nim: cannot safely edit invalid JSON at ${registration.path}`); }
  const isOurs = (value: unknown): boolean => JSON.stringify(value).includes('hooks dispatch');
  const source = current.hooks;
  const hooks = Array.isArray(source) ? source.filter((entry) => !isOurs(entry)) : source && typeof source === 'object' ? Object.fromEntries(Object.entries(source as Record<string, unknown>).map(([key, value]) => [key, Array.isArray(value) ? value.filter((entry) => !isOurs(entry)) : value]).filter(([, value]) => !Array.isArray(value) || value.length > 0)) : source;
  const tmp = `${registration.path}.nim-skill-tmp`; writeFileSync(tmp, `${JSON.stringify({ ...current, ...(hooks === undefined ? {} : { hooks }) }, null, 2)}\n`); renameSync(tmp, registration.path); return true;
}
