/**
 * src/cache/adapters.ts
 * ---------------------
 * Provider adapters for nim-cache. Only ~3 real code paths exist, so this is
 * one file, not a directory of near-duplicates:
 *   • explicit inline marker  — Anthropic (+ MiniMax via base-url swap), Qwen
 *   • explicit resource ref   — Gemini (cached-content)
 *   • implicit prefix-only    — OpenAI / GLM / DeepSeek (+ unknown fallback)
 *
 * `shape()` differs per provider; `parseUsage()` is a single generic reader
 * (scans known cache-usage field paths) so a renamed field degrades to
 * 0-saved + `known:false` rather than crashing (pre-mortem: provider drift).
 */

import type { CacheBlock, CacheProvider } from '../harness/types.js';

export interface ParsedUsage {
  cachedTokens: number;
  writeTokens: number;
  readTokens: number;
  known: boolean;
}

export interface ShapeOpts {
  ttl: '5m' | '1h';
  explicit: boolean;
}

export interface CacheAdapter {
  readonly id: string;
  /** Whether the provider honors explicit cache markers (Lever 2). */
  readonly explicit: boolean;
  shape(staticBlocks: CacheBlock[], dynamicBlocks: CacheBlock[], opts: ShapeOpts): CacheBlock[];
  parseUsage(usage: Record<string, unknown>): ParsedUsage;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Stable content first (reusable prefix), variable input last. */
function order(staticBlocks: CacheBlock[], dynamicBlocks: CacheBlock[]): CacheBlock[] {
  return [...staticBlocks, ...dynamicBlocks];
}

/** Return a copy of `blocks` with `marker` merged onto the LAST static block. */
function markLastStatic(
  staticBlocks: CacheBlock[],
  dynamicBlocks: CacheBlock[],
  marker: Record<string, unknown>,
): CacheBlock[] {
  if (staticBlocks.length === 0) return order(staticBlocks, dynamicBlocks);
  const marked = staticBlocks.map((b, i) => (i === staticBlocks.length - 1 ? { ...b, ...marker } : b));
  return order(marked, dynamicBlocks);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function at(obj: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>(
    (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

// Known cache-read + cache-write field paths across providers (OpenAI/Anthropic/
// Gemini/DeepSeek/Qwen). First non-zero wins.
const READ_PATHS: string[][] = [
  ['cache_read_input_tokens'],
  ['prompt_tokens_details', 'cached_tokens'],
  ['prompt_cache_hit_tokens'],
  ['cachedContentTokenCount'],
  ['usageMetadata', 'cachedContentTokenCount'],
  ['cached_tokens'],
];
const WRITE_PATHS: string[][] = [['cache_creation_input_tokens'], ['prompt_cache_miss_tokens']];

/** Generic usage parser — provider-agnostic, drift-tolerant. */
export function parseUsage(usage: Record<string, unknown>): ParsedUsage {
  const u = (usage.usage as Record<string, unknown>) ?? usage;
  let read = 0;
  let known = false;
  for (const p of READ_PATHS) {
    const v = at(u, p);
    if (v !== undefined) known = true;
    read = num(v);
    if (read > 0) break;
  }
  let write = 0;
  for (const p of WRITE_PATHS) {
    const v = at(u, p);
    if (v !== undefined) known = true;
    write = num(v);
    if (write > 0) break;
  }
  return { cachedTokens: read, readTokens: read, writeTokens: write, known };
}

// ─── The three shape strategies ──────────────────────────────────────────────

function makeExplicitInline(id: string, marker: (opts: ShapeOpts) => Record<string, unknown>): CacheAdapter {
  return {
    id,
    explicit: true,
    shape: (s, d, opts) => (opts.explicit ? markLastStatic(s, d, marker(opts)) : order(s, d)),
    parseUsage,
  };
}

/** Anthropic cache_control (MiniMax reuses this via base-url only). */
const anthropic = makeExplicitInline('anthropic', (o) => ({ cache_control: { type: 'ephemeral', ttl: o.ttl } }));

/** Qwen Model Studio explicit cache flag. */
const qwen = makeExplicitInline('qwen', () => ({ cache: true }));

/** Gemini cached-content resource reference. */
const gemini: CacheAdapter = {
  id: 'gemini',
  explicit: true,
  shape: (s, d, opts) => (opts.explicit ? markLastStatic(s, d, { cachedContent: true, ttl: opts.ttl }) : order(s, d)),
  parseUsage,
};

/** Implicit providers (OpenAI / GLM / DeepSeek / unknown): prefix-order only. */
const implicit: CacheAdapter = {
  id: 'implicit',
  explicit: false,
  shape: (s, d) => order(s, d),
  parseUsage,
};

// ─── Registry + auto detection ───────────────────────────────────────────────

const REGISTRY: Record<Exclude<CacheProvider, 'auto'>, CacheAdapter> = {
  anthropic,
  minimax: anthropic, // Anthropic-protocol drop-in
  qwen,
  gemini,
  openai: implicit,
  glm: implicit,
  deepseek: implicit,
};

const BASEURL_HINTS: Array<[RegExp, Exclude<CacheProvider, 'auto'>]> = [
  [/anthropic|claude/i, 'anthropic'],
  [/minimax/i, 'minimax'],
  [/dashscope|qwen|aliyun/i, 'qwen'],
  [/generativelanguage|gemini|googleapis/i, 'gemini'],
  [/deepseek/i, 'deepseek'],
  [/bigmodel|glm|z\.ai/i, 'glm'],
  [/openai/i, 'openai'],
];

function detect(hint: { baseUrl?: string; model?: string }): CacheAdapter {
  const hay = `${hint.baseUrl ?? ''} ${hint.model ?? ''}`;
  for (const [re, provider] of BASEURL_HINTS) if (re.test(hay)) return REGISTRY[provider];
  return implicit; // unknown ⇒ safe prefix-only
}

/** Pick an adapter from an explicit provider or `auto` (base-url/model heuristic). */
export function pickAdapter(provider: CacheProvider, hint: { baseUrl?: string; model?: string } = {}): CacheAdapter {
  return provider === 'auto' ? detect(hint) : REGISTRY[provider];
}
