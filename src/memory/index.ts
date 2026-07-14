/**
 * src/memory/index.ts
 * -------------------
 * U4 `nim-memory-lite` — the "remember" verb. A content-addressed verify-result
 * cache (skip re-verifying an unchanged output) + a small episodic priors store.
 * Local JSONL, TTL'd, zero-network. A cache is never load-bearing: every write
 * is best-effort and a read miss simply falls through to normal work.
 *
 * `null` config ⇒ a no-op helper (byte-identical bare run).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ResolvedMemory } from '../config.js';
import type { MemoryHelper } from '../harness/types.js';

/** Content-addressed key for a verify result: hash of {output, strategies}. */
export function verifyKey(output: unknown, strategies: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ output, strategies }) ?? '')
    .digest('hex')
    .slice(0, 32);
}

interface Entry {
  kind: 'verify' | 'prior';
  k: string;
  v: unknown;
  exp: number;
}

class ActiveMemory implements MemoryHelper {
  private readonly map = new Map<string, Entry>();

  constructor(private readonly cfg: ResolvedMemory) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.cfg.store)) return;
    for (const line of readFileSync(this.cfg.store, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t) as Entry;
        this.map.set(`${e.kind}:${e.k}`, e); // last write wins
      } catch {
        /* skip corrupt line */
      }
    }
  }

  private fresh(e: Entry | undefined): e is Entry {
    return !!e && e.exp > Date.now();
  }

  private persist(e: Entry): void {
    try {
      mkdirSync(dirname(this.cfg.store), { recursive: true });
      appendFileSync(this.cfg.store, JSON.stringify(e) + '\n');
    } catch {
      /* best-effort — memory is a cache, not a source of truth */
    }
  }

  getVerify(key: string): boolean | undefined {
    if (!this.cfg.verifyCache) return undefined;
    const e = this.map.get(`verify:${key}`);
    return this.fresh(e) ? Boolean(e.v) : undefined;
  }

  setVerify(key: string, verdict: boolean): void {
    if (!this.cfg.verifyCache) return;
    const e: Entry = { kind: 'verify', k: key, v: verdict, exp: Date.now() + this.cfg.ttlMs };
    this.map.set(`verify:${key}`, e);
    this.persist(e);
  }

  getPrior(category: string): unknown {
    if (!this.cfg.priors) return undefined;
    const e = this.map.get(`prior:${category}`);
    return this.fresh(e) ? e.v : undefined;
  }

  setPrior(category: string, value: unknown): void {
    if (!this.cfg.priors) return;
    const e: Entry = { kind: 'prior', k: category, v: value, exp: Date.now() + this.cfg.ttlMs };
    this.map.set(`prior:${category}`, e);
    this.persist(e);
  }
}

class DisabledMemory implements MemoryHelper {
  getVerify(): undefined {
    return undefined;
  }
  setVerify(): void {}
  getPrior(): undefined {
    return undefined;
  }
  setPrior(): void {}
}

export function createMemoryHelper(cfg: ResolvedMemory | null): MemoryHelper {
  return cfg ? new ActiveMemory(cfg) : new DisabledMemory();
}
