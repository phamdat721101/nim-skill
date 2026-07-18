/**
 * src/hook-adapters/stdin-read.ts
 * ---------------------------------
 * `readHookInputFromStdin()` — reads a JSON object piped on stdin by a
 * PreToolUse hook host (Claude Code, Kiro CLI). Deterministic, no network,
 * no LLM call: plain buffered stdin read + JSON.parse.
 */

export function readHookInputFromStdin(): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        rejectPromise(new Error(`nim: invalid JSON on stdin: ${(err as Error).message}`));
      }
    });
    process.stdin.on('error', (err) => rejectPromise(err));
  });
}
