/**
 * src/monitor/sinks/console.ts
 * ----------------------------
 * EventSink that prints a compact one-line trace summary to stderr. Local,
 * zero-dep, non-throwing (sink-liveness contract).
 */

import type { TraceRecord } from '../../harness/types.js';
import type { EventSink } from '../capture.js';

export class ConsoleSink implements EventSink {
  readonly name = 'console';

  emit(t: TraceRecord): void {
    try {
      const parts = [
        `[nim] ${t.skill}`,
        t.status,
        `${t.durationMs}ms`,
        t.verifyPassed === undefined ? '' : `verify=${t.verifyPassed ? 'pass' : 'fail'}`,
        t.healCount ? `heals=${t.healCount}` : '',
        t.errorClass ? `err=${t.errorClass}` : '',
      ].filter(Boolean);
      // eslint-disable-next-line no-console
      console.error(parts.join(' · '));
    } catch {
      /* sink-liveness: never throw upstream */
    }
  }
}
