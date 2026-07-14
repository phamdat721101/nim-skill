import { rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Remove only `.nim/*.jsonl` test artifacts (traces, memory) — NEVER the `.nim`
 * directory itself or any `.md` file. This preserves the gitignored track-memory
 * file (`.nim/agent-learnings.md`) across `npm test` runs.
 */
export function cleanNimArtifacts(dir = '.nim'): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.jsonl')) rmSync(join(dir, f), { force: true });
  }
}
