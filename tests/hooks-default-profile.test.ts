import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRecall, CANONICAL_HOOK_PROMPT, DEFAULT_HOOKS, hookContext } from '../src/hooks/default-profile.js';

function fixtureCwd(): string {
  const root = mkdtempSync(join(tmpdir(), 'nim-hooks-default-profile-'));
  mkdirSync(join(root, '.nim'), { recursive: true });
  writeFileSync(join(root, '.nim', 'agent-support-log.md'), '## Incident\ngetUserName crashed while reading search_index.json on startup.');
  writeFileSync(join(root, '.nim', 'lessons.jsonl'), '{"whatWentWrong":"unrelated payment rail crash","correctPattern":"n/a"}');
  return root;
}

describe('hooks/default-profile.ts — CANONICAL_HOOK_PROMPT + buildRecall', () => {
  it('names the AS-SCP search subcommands explicitly in the canonical prompt', () => {
    expect(CANONICAL_HOOK_PROMPT).toContain('search overview');
    expect(CANONICAL_HOOK_PROMPT).toContain('search graph');
    expect(CANONICAL_HOOK_PROMPT).toContain('search hydrate');
    expect(CANONICAL_HOOK_PROMPT).toContain('search compile');
    // The memory-log recall guidance must remain — this is additive, not a replacement.
    expect(CANONICAL_HOOK_PROMPT).toContain('.nim/agent-support-log.md');
    expect(CANONICAL_HOOK_PROMPT).toContain('.nim/lessons.jsonl');
    expect(CANONICAL_HOOK_PROMPT).toContain('workrule check');
  });

  it('resolves memory files relative to the given cwd, not process.cwd() (regression: the legacy call site had this bug)', () => {
    const cwd = fixtureCwd();
    // Deliberately does NOT rely on process.cwd() matching `cwd` — proves the fix.
    const recall = buildRecall('getUserName search_index.json', DEFAULT_HOOKS, cwd);
    expect(recall.unavailable).toEqual([]);
    expect(recall.text).toContain('getUserName');
  });

  it('identifier-aware tokenizer matches a camelCase symbol query against a lesson containing that identifier', () => {
    const cwd = fixtureCwd();
    const recall = buildRecall('getUserName', DEFAULT_HOOKS, cwd);
    expect(recall.text).not.toBe('nim-skill recall: no matching local incidents.');
    expect(recall.sources).toContain('.nim/agent-support-log.md'.replace('.nim', join(cwd, '.nim')));
  });

  it('reports genuinely unavailable memory files without crashing', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'nim-hooks-empty-'));
    const recall = buildRecall('anything', DEFAULT_HOOKS, cwd);
    expect(recall.unavailable).toEqual(DEFAULT_HOOKS.memoryFiles);
    expect(recall.text).toBe('nim-skill recall: no readable local memory sources.');
  });

  it('hookContext prepends the canonical prompt ahead of the recall text', () => {
    const cwd = fixtureCwd();
    const context = hookContext('getUserName', DEFAULT_HOOKS, cwd);
    expect(context.startsWith(CANONICAL_HOOK_PROMPT)).toBe(true);
    expect(context).toContain('getUserName');
  });
});
