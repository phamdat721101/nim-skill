/**
 * src/index-meter/volatility.ts
 * -------------------------------
 * Cache-fragility scan for tool descriptions. Mirrors src/guard/injection.ts's
 * style: a fixed regex array, one pure function, zero I/O, no shared state.
 * A tool description matching any pattern would bust a provider's prompt-cache
 * prefix on every call (tianpan.co, 2026-05-13).
 */

const VOLATILE_PATTERNS: readonly RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/, // ISO timestamp
  /\bunix\s*time\b/i,
  /\b\d+\s+(files?|items?|records?|rows?)\s+(available|found|loaded)\b/i, // dynamic count
  /\bbuild\s*[:#]?\s*[0-9a-f]{6,}\b/i, // build hash
];

/** True when `description` matches a known volatile/cache-fragile pattern. */
export function scanVolatility(description: string): boolean {
  if (!description) return false;
  return VOLATILE_PATTERNS.some((re) => re.test(description));
}
