/**
 * src/guard/owner-profile.ts
 * ---------------------------
 * `nim-propose`'s "learn the owner" half. Reuses `lessons/store.ts`'s exact
 * file-backed JSONL pattern verbatim (load-on-construct + in-memory list +
 * best-effort append) — zero new persistence architecture invented, per the
 * plan's explicit instruction. Advisory only: `buildScaffold()` pre-fills a
 * proposal's sections toward previously-approved patterns, but NEVER removes
 * the approval line the guard actually checks (`propose.ts`'s
 * `APPROVED_LINE` convention) — the pause itself is never skipped.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface OwnerProfileEntry {
  taskShape: string;
  taskDescription: string;
  sectionsAtApproval: string[];
  proposedAt: string;
  approvedAt: string;
  approvalLatencyMs: number;
}

export interface OwnerProfileRecordInput {
  taskDescription: string;
  sectionsAtApproval: string[];
  proposedAt: string;
  approvedAt: string;
}

export interface OwnerProfileStoreConfig {
  store: string;
}

export interface OwnerProfileStore {
  record(entry: OwnerProfileRecordInput): OwnerProfileEntry;
  readAll(): OwnerProfileEntry[];
}

/**
 * Deterministic task-shape grouping key: the LAST "significant" (non-stop-
 * word) keyword in the description, lowercased — i.e. the head noun a task
 * description typically ends on ("add a database migration" / "add another
 * migration script" both end their significant-word run on "migration").
 * Deliberately coarse and deterministic (not semantic/embedding-based — same
 * discipline nim-lessons already applies to trigger-shape matching).
 */
const STOP_WORDS = new Set(['a', 'an', 'the', 'add', 'another', 'new', 'to', 'for', 'and', 'or', 'fresh', 'script']);

export function taskShapeFor(taskDescription: string): string {
  const words = taskDescription.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const significant = words.filter((w) => !STOP_WORDS.has(w));
  const pool = significant.length > 0 ? significant : words;
  return pool[pool.length - 1] ?? taskDescription.toLowerCase();
}

/** Extract `## Section` header names from a markdown proposal body, in order. */
export function sectionsPresentIn(body: string): string[] {
  const matches = body.matchAll(/^##\s+(.+)$/gm);
  return [...matches].map((m) => m[1]!.trim());
}

class FileOwnerProfileStore implements OwnerProfileStore {
  private readonly entries: OwnerProfileEntry[] = [];

  constructor(private readonly cfg: OwnerProfileStoreConfig) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.cfg.store)) return;
    for (const line of readFileSync(this.cfg.store, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        this.entries.push(JSON.parse(t) as OwnerProfileEntry);
      } catch {
        /* skip corrupt line */
      }
    }
  }

  record(input: OwnerProfileRecordInput): OwnerProfileEntry {
    const entry: OwnerProfileEntry = {
      taskShape: taskShapeFor(input.taskDescription),
      taskDescription: input.taskDescription,
      sectionsAtApproval: input.sectionsAtApproval,
      proposedAt: input.proposedAt,
      approvedAt: input.approvedAt,
      approvalLatencyMs: new Date(input.approvedAt).getTime() - new Date(input.proposedAt).getTime(),
    };
    this.entries.push(entry);
    try {
      mkdirSync(dirname(this.cfg.store), { recursive: true });
      appendFileSync(this.cfg.store, JSON.stringify(entry) + '\n');
    } catch {
      /* best-effort — an owner-profile log is advisory, not a source of truth */
    }
    return entry;
  }

  readAll(): OwnerProfileEntry[] {
    return [...this.entries];
  }
}

export function createOwnerProfileStore(cfg: OwnerProfileStoreConfig): OwnerProfileStore {
  return new FileOwnerProfileStore(cfg);
}

const DEFAULT_SECTIONS = ['Plan', 'Rollback'];

/**
 * Advisory pre-fill: sections that appear in EVERY prior approved proposal
 * for this task shape (and aren't already in the default scaffold) get
 * added. Falls back to the plain default when there's no history yet.
 * Never emits an `approved:` line — the pause/approval mechanic `propose.ts`
 * checks is never bypassed by this pre-fill.
 */
export function buildScaffold(taskDescription: string, store: OwnerProfileStore): string {
  const shape = taskShapeFor(taskDescription);
  const priors = store.readAll().filter((e) => e.taskShape === shape);

  let sections = DEFAULT_SECTIONS;
  if (priors.length > 0) {
    const alwaysPresent = priors[0]!.sectionsAtApproval.filter((s) => priors.every((p) => p.sectionsAtApproval.includes(s)));
    sections = [...new Set([...DEFAULT_SECTIONS, ...alwaysPresent])];
  }

  const body = sections.map((s) => `## ${s}\n\n_(describe here)_\n`).join('\n');
  return [`# Proposal: ${taskDescription}`, '', body].join('\n');
}
