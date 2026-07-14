/**
 * src/monitor/dashboard.ts
 * ------------------------
 * Read a JSONL trace file and render a compact terminal summary: recent runs,
 * status/error-class breakdown, verify pass-rate, heal-rate, avg latency.
 * Pure string output (no framework) so it is trivially testable.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { TraceRecord } from '../harness/types.js';

export function parseTraces(jsonl: string): TraceRecord[] {
  return jsonl
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as TraceRecord;
      } catch {
        return null;
      }
    })
    .filter((t): t is TraceRecord => t !== null);
}

export type DashboardView = 'default' | 'savings' | 'cache';

const pctOf = (a: number, b: number): string => (b === 0 ? 'n/a' : `${Math.round((a / b) * 100)}%`);

/** U3 — net-token savings aggregate. Figures are approximate estimates. */
export function summarizeSavings(traces: TraceRecord[]): string {
  const withRoi = traces.filter((t) => t.netTokens !== undefined);
  if (withRoi.length === 0) return 'nim monitor (savings) — no token-ROI traces yet (enable monitor.tokenAccounting).';
  let saved = 0;
  let spent = 0;
  for (const t of withRoi) {
    saved += t.tokensSavedEstimate ?? 0;
    spent += t.tokensSpentByHarness ?? 0;
  }
  const net = spent - saved;
  return [
    `nim monitor (savings) — ${withRoi.length} run(s) · estimates, not billed truth`,
    `  tokens saved:  ~${saved}`,
    `  tokens spent:  ~${spent} (deterministic checks)`,
    `  net tokens:    ~${net} (${net <= 0 ? 'net-negative ✓' : 'net-positive'})`,
  ].join('\n');
}

/** v0.3 — cache-ROI aggregate + break-even warnings. */
export function summarizeCache(traces: TraceRecord[]): string {
  const withCache = traces.filter((t) => t.cache !== undefined);
  if (withCache.length === 0) return 'nim monitor (cache) — no cache traces yet (enable harness.cache + ctx.cache.record).';
  let read = 0;
  let write = 0;
  let dollars = 0;
  let belowBreakEven = 0;
  for (const t of withCache) {
    const c = t.cache!;
    read += c.readTokens;
    write += c.writeTokens;
    dollars += c.dollarsSaved;
    if (!c.breakEvenOk) belowBreakEven += 1;
  }
  const lines = [
    `nim monitor (cache) — ${withCache.length} run(s) · prices are estimates`,
    `  cache reads:   ${read} tokens`,
    `  cache writes:  ${write} tokens`,
    `  hit-rate:      ${pctOf(read, read + write)}`,
    `  dollars saved: ~$${dollars.toFixed(6)}`,
  ];
  if (belowBreakEven > 0) {
    lines.push(`  ⚠ break-even: ${belowBreakEven} run(s) below ~2 reads/write — cache writes may be subsidizing waste.`);
  }
  return lines.join('\n');
}

export function summarize(traces: TraceRecord[]): string {
  if (traces.length === 0) return 'nim monitor — no traces yet.';

  const n = traces.length;
  const byStatus = new Map<string, number>();
  const byErrClass = new Map<string, number>();
  let verifyRun = 0;
  let verifyPass = 0;
  let heals = 0;
  let totalMs = 0;

  for (const t of traces) {
    byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    if (t.errorClass) byErrClass.set(t.errorClass, (byErrClass.get(t.errorClass) ?? 0) + 1);
    if (t.verifyPassed !== undefined) {
      verifyRun += 1;
      if (t.verifyPassed) verifyPass += 1;
    }
    heals += t.healCount ?? 0;
    totalMs += t.durationMs;
  }

  const statusLine = [...byStatus].map(([k, v]) => `${k}=${v}`).join(' ');
  const errLine = byErrClass.size ? [...byErrClass].map(([k, v]) => `${k}=${v}`).join(' ') : 'none';

  const recent = traces
    .slice(-5)
    .map((t) => `  ${t.startedAt}  ${t.skill}  ${t.status}  ${t.durationMs}ms`)
    .join('\n');

  return [
    `nim monitor — ${n} run(s)`,
    `  status:      ${statusLine}`,
    `  error-class: ${errLine}`,
    `  verify:      ${pctOf(verifyPass, verifyRun)} pass (${verifyPass}/${verifyRun})`,
    `  heals:       ${heals} total`,
    `  avg latency: ${Math.round(totalMs / n)}ms`,
    `  recent:`,
    recent,
  ].join('\n');
}

/** Render the dashboard for a trace file path (missing file ⇒ friendly message). */
export function renderDashboard(traceFile: string, view: DashboardView = 'default'): string {
  if (!existsSync(traceFile)) return `nim monitor — no trace file at ${traceFile}`;
  const traces = parseTraces(readFileSync(traceFile, 'utf8'));
  if (view === 'savings') return summarizeSavings(traces);
  if (view === 'cache') return summarizeCache(traces);
  return summarize(traces);
}
