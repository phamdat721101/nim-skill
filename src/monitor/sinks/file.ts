/**
 * src/monitor/sinks/file.ts
 * -------------------------
 * EventSink that appends each trace as one JSON line (JSONL) to a local file.
 * Creates the parent directory on first write. Non-throwing (sink-liveness).
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TraceRecord } from '../../harness/types.js';
import type { EventSink } from '../capture.js';

export class FileSink implements EventSink {
  readonly name = 'file';
  private ensured = false;

  constructor(private readonly path: string) {}

  emit(t: TraceRecord): void {
    try {
      if (!this.ensured) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.ensured = true;
      }
      appendFileSync(this.path, JSON.stringify(t) + '\n');
    } catch {
      /* sink-liveness: never throw upstream */
    }
  }
}
