/**
 * src/guard/injection.ts
 * ----------------------
 * Heuristic prompt-injection / agentjacking detection. Regex + control-char
 * scan, zero deps, <1ms. This is the SINGLE source of the heuristic — the
 * guard imports it; it is never duplicated (matches the seed's discipline of
 * re-exporting, not copying, `looksLikePromptInjection`).
 *
 * Regex set ported verbatim from HyperMove `sentinel/sentinel.ts`.
 */

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(prior|previous)\s+instructions/i,
  /system\s*prompt\s*[:=]/i,
  /you\s+are\s+now\s+a\s+different/i,
  /reveal\s+your\s+(system\s+)?prompt/i,
  /jailbreak/i,
  /developer\s+mode\s+enabled/i,
  /<\/?script[\s>]/i,
];

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** True when `text` matches a known injection pattern. */
export function looksLikePromptInjection(text: string): boolean {
  if (!text) return false;
  const normalized = text.replace(CONTROL_CHAR_RE, ' ');
  for (const re of INJECTION_PATTERNS) if (re.test(normalized)) return true;
  return false;
}

/** Recursively scan a payload for injection strings, depth-capped. */
export function scanPayload(v: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof v === 'string') return looksLikePromptInjection(v);
  if (Array.isArray(v)) {
    for (const item of v) if (scanPayload(item, depth + 1)) return true;
    return false;
  }
  if (v && typeof v === 'object') {
    for (const val of Object.values(v)) if (scanPayload(val, depth + 1)) return true;
  }
  return false;
}
