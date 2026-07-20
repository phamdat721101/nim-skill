/**
 * src/workrule/store.ts
 * -----------------------
 * Append-only markdown log for `AgentSupportEntry` rows — WR-06's concrete
 * artifact. Deliberately markdown (not JSONL like nim-lessons/nim-memory):
 * this file is meant to be read directly by a human or an agent doing a
 * retro, not machine-parsed back into the harness, so a human-readable
 * table is the right shape (measure-don't-guess still applies to the
 * NUMBERS recorded, just not to the storage format). Same load-on-construct
 * + best-effort-append discipline as every other `.nim/*` store.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentSupportEntry } from './types.js';

const HEADER = '# Agent support log\n\n> How nim-skill\'s own primitives helped THIS project\'s agent work — appended by `nim-skill workrule log`, one row per primitive-assisted moment. Gitignored (same as every other `.nim/*` file).\n\n| at | primitive | effect | tokensSaved |\n|---|---|---|---|\n';

function toRow(e: AgentSupportEntry): string {
  const effect = e.effect.replace(/\|/g, '\\|');
  return `| ${e.at} | ${e.primitive} | ${effect} | ${e.tokensSaved ?? ''} |\n`;
}

export interface WorkruleStoreConfig {
  logFile: string;
}

export interface WorkruleStore {
  append(entry: Omit<AgentSupportEntry, 'at'>): AgentSupportEntry;
  readAll(): AgentSupportEntry[];
}

/** Split a markdown table row on unescaped `|` only (negative lookbehind for `\`), then trim + unescape each cell. */
function splitRow(line: string): string[] | null {
  if (!line.startsWith('|') || !line.endsWith('|')) return null;
  const inner = line.slice(1, -1);
  const cells = inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  return cells;
}

/** Parse the markdown table this store itself writes — best-effort, skips malformed rows. */
function parseRows(md: string): AgentSupportEntry[] {
  const rows: AgentSupportEntry[] = [];
  for (const line of md.split('\n')) {
    const cells = splitRow(line);
    if (!cells || cells.length !== 4) continue;
    const [at, primitive, effect, tokensSavedRaw] = cells;
    if (!at || at === 'at' || at.startsWith('---') || !primitive || !effect) continue;
    const tokensSaved = tokensSavedRaw ? Number(tokensSavedRaw) : undefined;
    rows.push({ at, primitive, effect, ...(tokensSaved !== undefined && !Number.isNaN(tokensSaved) ? { tokensSaved } : {}) });
  }
  return rows;
}

class FileWorkruleStore implements WorkruleStore {
  constructor(private readonly cfg: WorkruleStoreConfig) {}

  append(entry: Omit<AgentSupportEntry, 'at'>): AgentSupportEntry {
    const full: AgentSupportEntry = { ...entry, at: new Date().toISOString() };
    try {
      mkdirSync(dirname(this.cfg.logFile), { recursive: true });
      if (!existsSync(this.cfg.logFile)) writeFileSync(this.cfg.logFile, HEADER);
      appendFileSync(this.cfg.logFile, toRow(full));
    } catch {
      /* best-effort — an advisory log, not a source of truth */
    }
    return full;
  }

  readAll(): AgentSupportEntry[] {
    if (!existsSync(this.cfg.logFile)) return [];
    return parseRows(readFileSync(this.cfg.logFile, 'utf8'));
  }
}

export function createWorkruleStore(cfg: WorkruleStoreConfig): WorkruleStore {
  return new FileWorkruleStore(cfg);
}
