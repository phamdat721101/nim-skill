/**
 * src/baseline/rules.ts
 * ----------------------
 * The 6 nim-baseline lint rules, codified from tianpan.co (2026-02-14). Each
 * rule is a pure `(text, cfg) -> CheckResult` — zero I/O, same discipline as
 * `src/guard/injection.ts`'s `scanPayload`. The CLI layer owns all file reads.
 * Reuses `CheckResult` from harness/types.ts verbatim — no new result type.
 */

import type { CheckResult } from '../harness/types.js';

function countLines(text: string): number {
  return text.split('\n').length;
}

/** BL-LEN — root memory file total line count. Warn > maxLines, block > blockLines. */
export function checkLen(text: string, cfg: { maxLines: number; blockLines: number }): CheckResult {
  const n = countLines(text);
  if (n <= cfg.maxLines) return { strategy: 'BL-LEN', pass: true };
  return {
    strategy: 'BL-LEN',
    pass: false,
    reason:
      n > cfg.blockLines
        ? `${n} lines exceeds the block threshold (${cfg.blockLines}); split into a progressive-disclosure detail file`
        : `${n} lines exceeds the warn threshold (${cfg.maxLines}); consider trimming or splitting`,
  };
}

/** Estimate instruction count: bullet points + imperative sentences (a line starting with an imperative verb or "-"). */
function estimateInstructionCount(text: string): number {
  const lines = text.split('\n');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-*]\s+/.test(trimmed)) count += 1;
    else if (/^(always|never|use|avoid|prefer|write|keep|ensure|do not|don't)\b/i.test(trimmed)) count += 1;
  }
  return count;
}

/** BL-BUDGET — estimated instruction count vs a configurable ceiling. */
export function checkBudget(text: string, cfg: { maxInstructions: number }): CheckResult {
  const n = estimateInstructionCount(text);
  const pass = n <= cfg.maxInstructions;
  return {
    strategy: 'BL-BUDGET',
    pass,
    reason: pass ? undefined : `~${n} estimated instructions exceeds the ceiling (${cfg.maxInstructions})`,
  };
}

/** BL-DERIVABLE — flags generic advice a model would follow anyway. Suggestion-level. */
export function checkDerivable(text: string, phrases: readonly RegExp[]): CheckResult {
  const hits = phrases.filter((re) => re.test(text));
  const pass = hits.length === 0;
  return {
    strategy: 'BL-DERIVABLE',
    pass,
    reason: pass ? undefined : `matches ${hits.length} generic-advice pattern(s); consider removing (model would do this anyway)`,
  };
}

/** BL-LINTABLE — flags style rules a linter should own; requires a detected lint config too. */
export function checkLintable(text: string, phrases: readonly RegExp[], hasLintConfig: boolean): CheckResult {
  if (!hasLintConfig) return { strategy: 'BL-LINTABLE', pass: true };
  const hits = phrases.filter((re) => re.test(text));
  const pass = hits.length === 0;
  return {
    strategy: 'BL-LINTABLE',
    pass,
    reason: pass ? undefined : `matches ${hits.length} lint-duplicate pattern(s) with a lint config present; let the linter own this, not prose`,
  };
}

/** BL-TASKSPECIFIC — a contiguous >=8-line block with >=3 clustered domain stopwords, not behind a link. */
export function checkTaskSpecific(text: string, stopwords: readonly string[]): CheckResult {
  const lines = text.split('\n');
  const WINDOW = 8;
  for (let start = 0; start <= lines.length - WINDOW; start++) {
    const block = lines.slice(start, start + WINDOW).join(' ').toLowerCase();
    const matched = new Set(stopwords.filter((w) => block.includes(w.toLowerCase())));
    if (matched.size >= 3) {
      return {
        strategy: 'BL-TASKSPECIFIC',
        pass: false,
        reason: `lines ${start + 1}-${start + WINDOW} cluster ${matched.size} domain terms (${[...matched].join(', ')}); consider extracting to a referenced detail file`,
      };
    }
  }
  return { strategy: 'BL-TASKSPECIFIC', pass: true };
}

/** BL-PROGRESSIVE + BL-EMPTYFOLDER — root file references a detail file once it crosses maxLines. */
export function checkProgressive(text: string, cfg: { maxLines: number; detailDir: string }): CheckResult[] {
  const n = countLines(text);
  if (n <= cfg.maxLines) {
    return [
      { strategy: 'BL-PROGRESSIVE', pass: true },
      { strategy: 'BL-EMPTYFOLDER', pass: true },
    ];
  }
  const linkPattern = new RegExp(`\\]\\(${cfg.detailDir}/[^)]+\\)`);
  const hasDetailLink = linkPattern.test(text);
  return [
    {
      strategy: 'BL-PROGRESSIVE',
      pass: hasDetailLink,
      reason: hasDetailLink
        ? undefined
        : `${n} lines exceeds maxLines (${cfg.maxLines}) with no referenced detail file under '${cfg.detailDir}/'`,
    },
    // BL-EMPTYFOLDER (dangling/orphaned detail files) requires directory access — checked by audit(), not this pure fn.
    { strategy: 'BL-EMPTYFOLDER', pass: true },
  ];
}
