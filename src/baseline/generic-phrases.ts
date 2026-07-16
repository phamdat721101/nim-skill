/**
 * src/baseline/generic-phrases.ts
 * --------------------------------
 * Curated stoplists for the BL-DERIVABLE / BL-LINTABLE / BL-TASKSPECIFIC
 * heuristics in rules.ts. Each entry cites why it's on the list (tianpan.co,
 * 2026-02-14, "the model would do the right thing anyway... the line should
 * go"). Pure data — no logic here, so rules.ts stays the single source of
 * check behavior (SOLID: one reason to change per file).
 */

/** BL-DERIVABLE — generic advice a model already follows without being told. */
export const DERIVABLE_PHRASES: readonly RegExp[] = [
  /write\s+(readable|clean|good)\s+code/i, // universally true of any capable model
  /use\s+meaningful\s+variable\s+names/i, // baseline coding competence, not project-specific
  /add\s+comments?\s+(for|to)\s+(complex|non-obvious)/i, // already a default instinct
  /follow\s+best\s+practices/i, // vacuous — no actionable delta
  /write\s+maintainable\s+code/i, // synonym of "write good code"
  /keep\s+functions?\s+small/i, // generic software-engineering advice
  /avoid\s+code\s+duplication/i, // generic DRY restatement
  /handle\s+errors?\s+(properly|gracefully|appropriately)/i, // no specific handling policy stated
  /write\s+(unit\s+)?tests?\s+for\s+(your|new)\s+code/i, // generic testing advice, not this-repo-specific
  /be\s+consistent\s+(with|in)\s+(your\s+)?(code|style)/i, // vacuous consistency directive
  /think\s+before\s+you\s+(code|act)/i, // not an operational instruction
  /prioriti[sz]e\s+(code\s+)?quality/i, // no measurable criterion attached
  /use\s+descriptive\s+(names|naming)/i, // duplicate of "meaningful variable names"
  /write\s+self-documenting\s+code/i, // generic advice, unfalsifiable
  /keep\s+(it|things)\s+simple/i, // vacuous KISS restatement
  /don'?t\s+repeat\s+yourself/i, // bare DRY acronym restatement
];

/** BL-LINTABLE — style rules a linter/formatter should own, not prose. */
export const LINTABLE_PHRASES: readonly RegExp[] = [
  /always\s+use\s+single\s+quotes/i,
  /never\s+use\s+double\s+quotes/i,
  /always\s+use\s+semicolons/i,
  /never\s+use\s+semicolons/i,
  /always\s+use\s+2\s+spaces/i,
  /always\s+use\s+4\s+spaces/i,
  /never\s+use\s+tabs/i,
  /always\s+use\s+tabs/i,
  /sort\s+imports\s+alphabetically/i,
  /always\s+use\s+trailing\s+commas/i,
  /never\s+use\s+trailing\s+commas/i,
  /line\s+length\s+(must|should)\s+not\s+exceed/i,
  /always\s+add\s+a\s+trailing\s+newline/i,
  /use\s+consistent\s+indentation/i,
  /always\s+use\s+camelCase/i,
  /always\s+use\s+snake_case/i,
];

/** BL-TASKSPECIFIC — domain nouns whose clustering signals a task-specific block. */
export const TASKSPECIFIC_STOPWORDS: readonly string[] = [
  'schema',
  'migration',
  'endpoint',
  'column',
  'table',
  'index',
  'foreign key',
  'query',
];
