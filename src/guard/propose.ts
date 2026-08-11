/**
 * src/guard/propose.ts
 * ---------------------
 * `nim-propose` — a pre-execute deny gate requiring an explicit, approved
 * plan artifact before a task runs. Pure decision logic reading one file
 * (same "filesystem-backed but otherwise pure" shape as nim-workspace's
 * existence-scan.ts) — `guard.ts` is the only caller that throws.
 *
 * Content-hash keyed to the task description (mirrors nim-memory-lite's
 * verify-cache key pattern) so re-proposing the SAME task re-finds its own
 * plan file rather than requiring an exact path to be threaded through.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export type ProposalDenyReason = 'no_proposal' | 'not_approved' | 'approval_expired';

export interface ProposalCheckResult {
  approved: boolean;
  reason?: ProposalDenyReason;
  approvedAt?: string;
}

export interface ProposeCheckConfig {
  proposalsDir: string;
  approvalTtlMs: number;
}

/** Deterministic short hash of a task description — same input, same id, across processes/runs. */
export function proposalHashFor(taskDescription: string): string {
  return createHash('sha256').update(taskDescription).digest('hex').slice(0, 16);
}

/** The plan artifact path for a given task description under a proposals dir. */
export function proposalPathFor(taskDescription: string, proposalsDir: string): string {
  return join(proposalsDir, `${proposalHashFor(taskDescription)}.md`);
}

const APPROVED_LINE = /^approved:\s*(.+)$/m;

/**
 * Check whether a task description has an approved, non-expired plan on
 * disk. Never throws — returns a structured result; `guard.ts` decides
 * whether to throw GuardError.
 */
export function checkProposal(taskDescription: string, cfg: ProposeCheckConfig): ProposalCheckResult {
  const path = proposalPathFor(taskDescription, cfg.proposalsDir);
  if (!existsSync(path)) return { approved: false, reason: 'no_proposal' };

  const content = readFileSync(path, 'utf8');
  const match = content.match(APPROVED_LINE);
  if (!match) return { approved: false, reason: 'not_approved' };

  const approvedAt = match[1]!.trim();
  const approvedAtMs = new Date(approvedAt).getTime();
  if (Number.isNaN(approvedAtMs)) return { approved: false, reason: 'not_approved' };

  if (Date.now() - approvedAtMs > cfg.approvalTtlMs) {
    return { approved: false, reason: 'approval_expired', approvedAt };
  }
  return { approved: true, approvedAt };
}
