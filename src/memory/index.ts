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
import type { ExternalSession, MemoryHelper, SessionOptions, SetSessionOptions } from '../harness/types.js';
import { assertNoSecrets } from '../security/secrets.js';

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

interface SessionEntry {
  provider: string;
  profile: string;
  session: ExternalSession;
  exp: number;
}

class ActiveMemory implements MemoryHelper {
  private readonly map = new Map<string, Entry>();
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(private readonly cfg: ResolvedMemory) {
    this.load();
    this.loadSessions();
  }

  private loadSessions(): void {
    if (!existsSync(this.cfg.sessionStore)) return;
    for (const line of readFileSync(this.cfg.sessionStore, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const entry = JSON.parse(t) as SessionEntry;
        if (typeof entry.provider !== 'string' || typeof entry.profile !== 'string' || !entry.session || typeof entry.exp !== 'number') continue;
        this.sessions.set(this.sessionKey(entry.provider, entry.profile), entry);
      } catch {
        /* skip corrupt line */
      }
    }
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

  private fresh<T extends { exp: number }>(e: T | undefined): e is T {
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

  private persistSession(entry: SessionEntry): void {
    try {
      mkdirSync(dirname(this.cfg.sessionStore), { recursive: true });
      appendFileSync(this.cfg.sessionStore, JSON.stringify(entry) + '\n');
    } catch {
      /* sessions remain best-effort local workflow state */
    }
  }

  private sessionKey(provider: string, profile: string): string {
    return `${profile}:${provider}`;
  }

  private profile(options?: SessionOptions): string {
    return options?.profile?.trim() || 'default';
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

  getSession<T extends ExternalSession = ExternalSession>(provider: string, options?: SessionOptions): T | undefined {
    const entry = this.sessions.get(this.sessionKey(provider, this.profile(options)));
    return this.fresh(entry) ? { ...entry.session } as T : undefined;
  }

  setSession(provider: string, session: ExternalSession, options?: SetSessionOptions): void {
    assertNoSecrets(session);
    if (session.provider && session.provider !== provider) throw new Error('session provider does not match its storage namespace');
    const profile = this.profile(options);
    const ttlMs = options?.ttlMs ?? this.cfg.ttlMs;
    const entry: SessionEntry = {
      provider,
      profile,
      session: { ...session, provider, updatedAt: new Date().toISOString() },
      exp: Date.now() + ttlMs,
    };
    this.sessions.set(this.sessionKey(provider, profile), entry);
    this.persistSession(entry);
  }

  clearSession(provider: string, options?: SessionOptions): void {
    const profile = this.profile(options);
    const entry: SessionEntry = { provider, profile, session: {}, exp: 0 };
    this.sessions.set(this.sessionKey(provider, profile), entry);
    this.persistSession(entry);
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
  getSession(): undefined {
    return undefined;
  }
  setSession(): void {}
  clearSession(): void {}
}

export function createMemoryHelper(cfg: ResolvedMemory | null): MemoryHelper {
  return cfg ? new ActiveMemory(cfg) : new DisabledMemory();
}
