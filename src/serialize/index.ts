/**
 * src/serialize/index.ts
 * ----------------------
 * U5b — token-optimized serialization for TERMINAL one-shot payloads ONLY
 * (final trace export, a batch result). Real reduction comes from de-duplicating
 * repeated object keys in a uniform array into a single header row.
 *
 * ⚠️ HARD GUARDRAIL (arxiv 2605.29676): token-optimized formats cascade on
 * multi-turn parse failures and collapse parallel tool-call output. They MUST
 * NOT be used for anything the model reads mid-loop. `assertTerminal()` enforces
 * this at the only call sites allowed to opt in; JSON stays the default.
 */

export type TerminalFormat = 'json' | 'toon' | 'tron';

export class SerializeGuardError extends Error {
  constructor(format: TerminalFormat) {
    super(`format '${format}' is terminal-only and must not be used for mid-loop/agent-facing payloads`);
    this.name = 'SerializeGuardError';
  }
}

/** Guard: a non-JSON format is only permitted for a terminal payload. */
export function assertTerminal(format: TerminalFormat, isTerminal: boolean): void {
  if (format !== 'json' && !isTerminal) throw new SerializeGuardError(format);
}

function isFlatObject(v: unknown): v is Record<string, string | number | boolean | null> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v).every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));
}

/** Uniform array of flat objects → header + rows. Otherwise compact JSON. */
function encodeTabular(payload: unknown, sep: string): string {
  if (!Array.isArray(payload) || payload.length === 0 || !payload.every(isFlatObject)) {
    return JSON.stringify(payload);
  }
  const keys = Object.keys(payload[0] as object);
  const sameShape = payload.every(
    (row) => Object.keys(row as object).length === keys.length && keys.every((k) => k in (row as object)),
  );
  if (!sameShape) return JSON.stringify(payload);

  const cell = (x: unknown): string => (x === null ? '' : String(x));
  const header = keys.join(sep);
  const rows = payload.map((row) => keys.map((k) => cell((row as Record<string, unknown>)[k])).join(sep));
  return [header, ...rows].join('\n');
}

/**
 * Serialize a TERMINAL payload. Never call for mid-loop/agent-facing/parallel
 * output — pass isTerminal:true to opt into a compact format.
 */
export function toTerminal(payload: unknown, format: TerminalFormat = 'json', isTerminal = true): string {
  assertTerminal(format, isTerminal);
  if (format === 'json') return JSON.stringify(payload);
  return encodeTabular(payload, format === 'tron' ? '|' : ',');
}
