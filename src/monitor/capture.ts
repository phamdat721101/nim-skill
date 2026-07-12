/**
 * src/monitor/capture.ts
 * ----------------------
 * Non-blocking trace capture with pluggable Strategy-pattern sinks. Consumers
 * depend on the EventSink interface, never a concrete sink (Dependency
 * Inversion). Every sink is guaranteed non-throwing — telemetry failures never
 * break the execution path. captureTrace() returns synchronously; I/O is
 * scheduled via queueMicrotask so the hot path is never blocked.
 *
 * Ported from HyperMove `observability/capture.ts`, decoupled from Postgres:
 * the default transport is console + file(JSONL), not a database.
 */

import type { TraceRecord } from '../harness/types.js';
import type { ResolvedMonitor } from '../config.js';
import { ConsoleSink } from './sinks/console.js';
import { FileSink } from './sinks/file.js';
import { SentrySink } from './sinks/sentry.js';

/** Strategy interface — one method, one contract. MUST NOT throw. */
export interface EventSink {
  readonly name: string;
  emit(trace: TraceRecord): void | Promise<void>;
}

/** The monitor surface the runtime depends on. */
export interface Monitor {
  readonly sinks: readonly EventSink[];
  /** Fan-out a trace to every sink, non-blocking. No-op when disabled. */
  capture(trace: TraceRecord): void;
}

function buildSinks(cfg: ResolvedMonitor): EventSink[] {
  const sinks: EventSink[] = [];
  for (const name of cfg.exporters ?? ['console']) {
    if (name === 'console') sinks.push(new ConsoleSink());
    else if (name === 'file') sinks.push(new FileSink(cfg.traceFile));
    else if (name === 'sentry') sinks.push(new SentrySink());
  }
  return sinks;
}

class DisabledMonitor implements Monitor {
  readonly sinks: readonly EventSink[] = [];
  capture(): void {
    /* no-op passthrough — byte-identical bare run */
  }
}

class ActiveMonitor implements Monitor {
  constructor(readonly sinks: readonly EventSink[]) {}

  capture(trace: TraceRecord): void {
    for (const sink of this.sinks) {
      // Fire-and-forget; a sink can never block another or throw upstream.
      queueMicrotask(() => {
        try {
          void sink.emit(trace);
        } catch {
          /* swallowed — sink-liveness contract */
        }
      });
    }
  }
}

/** Build a monitor from resolved config. `null` ⇒ disabled (no-op). */
export function createMonitor(cfg: ResolvedMonitor | null): Monitor {
  if (!cfg) return new DisabledMonitor();
  return new ActiveMonitor(buildSinks(cfg));
}
