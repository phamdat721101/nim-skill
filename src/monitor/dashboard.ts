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

  const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${Math.round((a / b) * 100)}%`);
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
    `  verify:      ${pct(verifyPass, verifyRun)} pass (${verifyPass}/${verifyRun})`,
    `  heals:       ${heals} total`,
    `  avg latency: ${Math.round(totalMs / n)}ms`,
    `  recent:`,
    recent,
  ].join('\n');
}

/** Render the dashboard for a trace file path (missing file ⇒ friendly message). */
export function renderDashboard(traceFile: string): string {
  if (!existsSync(traceFile)) return `nim monitor — no trace file at ${traceFile}`;
  return summarize(parseTraces(readFileSync(traceFile, 'utf8')));
}
