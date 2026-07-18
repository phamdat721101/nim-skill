/**
 * src/lessons/store.ts
 * ---------------------
 * Append-only local JSONL store for `Lesson` entries. Mirrors
 * `src/memory/index.ts`'s file-backed pattern exactly: same load-on-construct
 * + in-memory map + best-effort persist + TTL-on-read shape, zero new
 * architecture invented. Local-first, zero network.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Lesson } from './types.js';

export interface LessonsStoreConfig {
  store: string;
  ttlMs: number;
}

export interface LessonsStore {
  append(lesson: Lesson): void;
  readAll(): Lesson[];
}

class FileLessonsStore implements LessonsStore {
  private readonly byId = new Map<string, Lesson>();

  constructor(private readonly cfg: LessonsStoreConfig) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.cfg.store)) return;
    for (const line of readFileSync(this.cfg.store, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const lesson = JSON.parse(t) as Lesson;
        this.byId.set(lesson.id, lesson); // last write wins
      } catch {
        /* skip corrupt line */
      }
    }
  }

  private fresh(lesson: Lesson): boolean {
    return Date.now() - new Date(lesson.capturedAt).getTime() < this.cfg.ttlMs;
  }

  append(lesson: Lesson): void {
    this.byId.set(lesson.id, lesson);
    try {
      mkdirSync(dirname(this.cfg.store), { recursive: true });
      appendFileSync(this.cfg.store, JSON.stringify(lesson) + '\n');
    } catch {
      /* best-effort — a lesson log is advisory, not a source of truth */
    }
  }

  readAll(): Lesson[] {
    return [...this.byId.values()].filter((l) => this.fresh(l));
  }
}

/** Always file-backed — a lesson log has no "disabled" variant of its own; disabling `nim-lessons` entirely is handled one layer up (`createLessonsHelper(null)`). */
export function createLessonsStore(cfg: LessonsStoreConfig): LessonsStore {
  return new FileLessonsStore(cfg);
}
