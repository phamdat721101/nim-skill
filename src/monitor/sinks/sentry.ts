/**
 * src/monitor/sinks/sentry.ts
 * ---------------------------
 * Optional EventSink that forwards ERROR traces to Sentry. @sentry/node is an
 * optional peer dep, lazy-imported only when SENTRY_DSN is set; if the package
 * is absent the sink degrades to a no-op. Never throws (sink-liveness).
 */

import type { TraceRecord } from '../../harness/types.js';
import type { EventSink } from '../capture.js';

type SentryModule = { captureException?: (e: unknown, ctx?: unknown) => void };

export class SentrySink implements EventSink {
  readonly name = 'sentry';
  private mod: SentryModule | null = null;
  private tried = false;

  async emit(t: TraceRecord): Promise<void> {
    if (t.status !== 'error') return;
    if (!process.env.SENTRY_DSN) return;
    try {
      if (!this.tried) {
        this.tried = true;
        const spec = '@sentry/node';
        this.mod = (await import(/* @vite-ignore */ spec).catch(() => null)) as SentryModule | null;
      }
      if (!this.mod?.captureException) return;
      const err = new Error(`${t.skill}: ${t.errorClass ?? 'error'}`);
      this.mod.captureException(err, { tags: { skill: t.skill }, extra: { ...t } });
    } catch {
      /* sink-liveness: never throw upstream */
    }
  }
}
