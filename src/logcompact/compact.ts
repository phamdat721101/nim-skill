/**
 * src/logcompact/compact.ts
 * ---------------------------
 * Pure, zero-I/O compaction functions (mirrors index-meter/estimate.ts's
 * purity discipline). Grounded in bswen.com (2026-03-02, measured): shell/log
 * output is typically 90%+ of tool-output token spend; capping + error-focused
 * filtering + incremental narrowing recovers 60-96% with no loss of the
 * information that matters.
 */

import type { CompactStrategy, LogCompactConfig } from './types.js';
import { redactSecretText } from '../security/secrets.js';

const ERROR_MARKER = /\b(ERROR|FAIL|FATAL|Exception)\b|error:/i;
const DEFAULT_MAX_LINES = 100;
const DEFAULT_CONTEXT_LINES = 2;

/** Truncate to the first N lines. Under the cap ⇒ unchanged (never pads). */
export function capLines(text: string, maxLines: number): string {
  if (text === '') return '';
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n');
}

/**
 * Keep only lines matching an error marker plus `context` lines of
 * surrounding text on each side. Overlapping windows are merged (no
 * duplicated lines). Returns '' when no marker is found — callers decide
 * whether to escalate to an unfiltered slice.
 */
export function filterErrors(text: string, context = DEFAULT_CONTEXT_LINES): string {
  if (text === '') return '';
  const lines = text.split('\n');
  const keep = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (ERROR_MARKER.test(lines[i] ?? '')) {
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
        keep.add(j);
      }
    }
  }
  if (keep.size === 0) return '';
  const indices = [...keep].sort((a, b) => a - b);
  return indices.map((i) => lines[i] ?? '').join('\n');
}

/** Summarize very large input: total line count + a first/last slice, never the full body. */
function summarizeIncremental(text: string, maxLines: number): string {
  if (text === '') return '';
  const lines = text.split('\n');
  const half = Math.max(1, Math.floor(maxLines / 2));
  const head = lines.slice(0, half);
  const tail = lines.length > half ? lines.slice(-half) : [];
  const omitted = Math.max(0, lines.length - head.length - tail.length);
  const parts = [`[${lines.length} lines total]`, ...head];
  if (omitted > 0) parts.push(`... (${omitted} lines omitted) ...`);
  parts.push(...tail);
  return parts.join('\n');
}

/**
 * Dispatch by strategy, applying `escalateOnEmpty` (default true) so a
 * filtered-to-nothing result never silently hides real output — it falls
 * back to a capped-but-unfiltered slice instead.
 */
export function compact(text: string, cfg: LogCompactConfig): string {
  const safeText = redactSecretText(text);
  const maxLines = cfg.maxLines ?? DEFAULT_MAX_LINES;
  const strategy: CompactStrategy = cfg.strategy ?? 'errors-only';
  const escalateOnEmpty = cfg.escalateOnEmpty ?? true;

  if (strategy === 'cap') return capLines(safeText, maxLines);
  if (strategy === 'incremental') return summarizeIncremental(safeText, maxLines);

  // 'errors-only'
  const filtered = filterErrors(safeText, DEFAULT_CONTEXT_LINES);
  if (filtered !== '') return capLines(filtered, maxLines);
  if (escalateOnEmpty) return capLines(safeText, maxLines);
  return '';
}
