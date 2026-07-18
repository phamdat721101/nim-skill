/**
 * src/workspace/existence-scan.ts
 * ---------------------------------
 * Deterministic glob + word-overlap search for existing artifacts that claim
 * the same territory as a proposed write. No LLM call — "measure, don't
 * guess," matching `nim-index`'s own precedent (04 §2.1 point 2).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ExistingArtifact {
  path: string;
  declaredPurpose: string;
}

export interface ExistenceOverlapThresholds {
  extend: number;
  compose: number;
  iterate: number;
}

export type ExistenceRecommendation = 'PROCEED' | 'EXTEND' | 'COMPOSE' | 'ITERATE';

export interface ExistenceOverlapResult {
  overlaps: Array<{ path: string; overlapPct: number }>;
  recommendation: ExistenceRecommendation;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

/** Jaccard-style word overlap, as a percentage of the proposed purpose's own token set. */
function overlapPercent(proposed: Set<string>, candidate: Set<string>): number {
  if (proposed.size === 0) return 0;
  let shared = 0;
  for (const w of proposed) if (candidate.has(w)) shared += 1;
  return Math.round((shared / proposed.size) * 100);
}

/**
 * Compares `proposedPurpose` against every candidate's `declaredPurpose` and
 * derives the 5-way (minus BLOCK, which is identity/location-only) existence
 * recommendation from the highest overlap found:
 *   - >=compose with 2+ candidates jointly covering it -> COMPOSE
 *   - single candidate >=extend -> EXTEND
 *   - single candidate >=iterate -> ITERATE
 *   - otherwise -> PROCEED
 */
export function scanExistenceOverlap(
  proposedPurpose: string,
  candidates: ExistingArtifact[],
  thresholds: ExistenceOverlapThresholds,
): ExistenceOverlapResult {
  const proposedTokens = tokenize(proposedPurpose);
  const overlaps = candidates
    .map((c) => ({ path: c.path, overlapPct: overlapPercent(proposedTokens, tokenize(c.declaredPurpose)) }))
    .filter((o) => o.overlapPct > 0)
    .sort((a, b) => b.overlapPct - a.overlapPct);

  if (overlaps.length === 0) {
    return { overlaps: [], recommendation: 'PROCEED' };
  }

  const top = overlaps[0]?.overlapPct ?? 0;

  if (overlaps.length >= 2) {
    const combined = overlaps.slice(0, 2).reduce((sum, o) => sum + o.overlapPct, 0);
    if (combined >= thresholds.compose) {
      return { overlaps, recommendation: 'COMPOSE' };
    }
  }

  if (top >= thresholds.extend) return { overlaps, recommendation: 'EXTEND' };
  if (top >= thresholds.iterate) return { overlaps, recommendation: 'ITERATE' };
  return { overlaps, recommendation: 'PROCEED' };
}

const PURPOSE_PATTERNS = [
  /^description:\s*\|?\s*(.*)$/im,
  /^#+\s*(.*)$/m,
];

/** Best-effort purpose extraction: frontmatter `description:` first line, else the first heading. */
function extractDeclaredPurpose(text: string): string {
  for (const re of PURPOSE_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return text.slice(0, 200);
}

/**
 * Walks `rootDir` recursively (skips common noise dirs), reads every file
 * matching `globPattern` (a simple suffix/glob, e.g. `**\/*.md` or `*.md`),
 * and derives a declared-purpose string per file. No LLM call.
 */
export function readWorkspaceArtifacts(rootDir: string, globPattern: string): ExistingArtifact[] {
  if (!existsSync(rootDir)) return [];
  const suffix = globPattern.replace(/^\*\*\//, '').replace(/^\*/, '');
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.nim']);
  const results: ExistingArtifact[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!ignoreDirs.has(entry)) walk(fullPath);
        continue;
      }
      if (suffix && !fullPath.endsWith(suffix)) continue;
      try {
        const text = readFileSync(fullPath, 'utf8');
        results.push({ path: fullPath, declaredPurpose: extractDeclaredPurpose(text) });
      } catch {
        continue;
      }
    }
  }

  walk(rootDir);
  return results;
}
