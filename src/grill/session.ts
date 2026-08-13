/**
 * src/grill/session.ts
 * --------------------
 * JSONL-backed session store for nim-grill. Mirrors the append-only pattern
 * of `src/lessons/store.ts` and `src/memory/index.ts`: each file is a JSONL
 * log; `load()` replays events to reconstruct the live session state. This
 * means concurrent CLI invocations can safely append answers without a lock
 * (append is atomic on POSIX at ≤PIPE_BUF, ~4 KB, well under our line size).
 *
 * Session ID is a 12-char hex derived from a SHA-256 of `domain + startedAt`,
 * mirroring nim-propose's `proposalHashFor()` pattern — no path needs to be
 * threaded through across CLI invocations.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GrillSession, GrillQuestion, GrillAnswer, GrillPRD } from './types.js';

// ─── JSONL event shapes ───────────────────────────────────────────────────────

type SessionEvent =
  | { kind: 'session'; data: Omit<GrillSession, 'answers'> }
  | { kind: 'answer'; sessionId: string; data: GrillAnswer }
  | { kind: 'compiled'; sessionId: string; prdFile: string; compiledAt: string };

// ─── ID derivation ────────────────────────────────────────────────────────────

/** Derive a stable 12-char hex session ID from domain + startedAt. */
export function sessionIdFor(domain: string, startedAt: string): string {
  return createHash('sha256')
    .update(`${domain}:${startedAt}`)
    .digest('hex')
    .slice(0, 12);
}

// ─── Store implementation ─────────────────────────────────────────────────────

export interface GrillStore {
  /** Create a new session with the given domain + question set. */
  create(domain: string, questions: GrillQuestion[]): GrillSession;
  /** Load a session by ID (replays JSONL). Returns undefined if not found. */
  load(id: string): GrillSession | undefined;
  /** Return the most recently started session, or undefined if none. */
  latest(): GrillSession | undefined;
  /** Append an answer event and mark the question resolved in-memory. Returns the GrillAnswer. */
  answer(sessionId: string, questionId: string, answer: string): GrillAnswer;
  /** Mark the session as compiled and record the PRD file path. */
  markCompiled(sessionId: string, prdFile: string): void;
}

export function createGrillStore(dir: string): GrillStore {
  const storeDir = resolve(dir);

  function sessionFile(id: string): string {
    return join(storeDir, `${id}.jsonl`);
  }

  function ensureDir(): void {
    mkdirSync(storeDir, { recursive: true });
  }

  function appendEvent(id: string, event: SessionEvent): void {
    ensureDir();
    appendFileSync(sessionFile(id), JSON.stringify(event) + '\n');
  }

  function replaySession(id: string): GrillSession | undefined {
    const file = sessionFile(id);
    if (!existsSync(file)) return undefined;

    let session: GrillSession | undefined;
    const answers: GrillAnswer[] = [];

    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const event = JSON.parse(t) as SessionEvent;
        if (event.kind === 'session') {
          session = { ...event.data, answers: [] };
        } else if (event.kind === 'answer' && session) {
          answers.push(event.data);
          const q = session.questions.find((q) => q.id === event.data.questionId);
          if (q) q.resolved = true;
        } else if (event.kind === 'compiled' && session) {
          session.status = 'compiled';
        }
      } catch {
        /* skip corrupt lines — same policy as memory/index.ts */
      }
    }

    if (session) session.answers = answers;
    return session;
  }

  function listSessionIds(): string[] {
    if (!existsSync(storeDir)) return [];
    return readdirSync(storeDir)
      .filter((f) => f.endsWith('.jsonl') && !f.endsWith('-prd.jsonl'))
      .map((f) => f.replace('.jsonl', ''));
  }

  return {
    create(domain, questions): GrillSession {
      ensureDir();
      const startedAt = new Date().toISOString();
      const id = sessionIdFor(domain, startedAt);
      const branches = [...new Set(questions.map((q) => q.branch))];
      const session: GrillSession = {
        id,
        domain,
        status: 'active',
        startedAt,
        branches,
        questions: questions.map((q) => ({ ...q, resolved: false })),
        answers: [],
      };
      // Write the session header event
      const { answers: _answers, ...sessionData } = session;
      void _answers; // not stored in the header — reconstructed from answer events
      appendEvent(id, { kind: 'session', data: sessionData });
      return session;
    },

    load(id) {
      return replaySession(id);
    },

    latest() {
      const ids = listSessionIds();
      if (ids.length === 0) return undefined;
      // Replay all and pick the most recent by startedAt
      const sessions = ids
        .map((id) => replaySession(id))
        .filter((s): s is GrillSession => s !== undefined);
      if (sessions.length === 0) return undefined;
      return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    },

    answer(sessionId, questionId, answer) {
      const resolved: GrillAnswer = {
        questionId,
        answer,
        resolvedAt: new Date().toISOString(),
      };
      appendEvent(sessionId, { kind: 'answer', sessionId, data: resolved });
      return resolved;
    },

    markCompiled(sessionId, prdFile) {
      appendEvent(sessionId, {
        kind: 'compiled',
        sessionId,
        prdFile,
        compiledAt: new Date().toISOString(),
      });
    },
  };
}

/** Write a compiled PRD markdown file. Returns the written path. */
export function writePRDFile(dir: string, sessionId: string, markdown: string): string {
  const storeDir = resolve(dir);
  mkdirSync(storeDir, { recursive: true });
  const file = join(storeDir, `${sessionId}-prd.md`);
  writeFileSync(file, markdown);
  return file;
}
