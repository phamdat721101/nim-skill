export interface CorpusStats { docCount: number; avgDocLength: number; documentFrequency: Map<string, number>; }

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Identifier-aware tokenizer, additive to `tokenize()` (which stays
 * unchanged for chunk.ts/index.ts callers). Splits camelCase, PascalCase,
 * and snake_case/SCREAMING_SNAKE_CASE identifiers into lowercase
 * sub-tokens, on top of plain Unicode word splitting — so a query like
 * "user name" can match a symbol like `getUserName`.
 */
export function tokenizeIdentifier(text: string): string[] {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  for (const word of words) {
    // Insert boundaries: lower→Upper (camel/Pascal humps), Upper+Upper→Upper+lower
    // (acronym followed by a new word), letter<->digit, and underscores.
    const withBoundaries = word
      .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1_$2')
      .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1_$2')
      .replace(/([\p{L}])([\p{N}])/gu, '$1_$2')
      .replace(/([\p{N}])([\p{L}])/gu, '$1_$2');
    for (const part of withBoundaries.split('_')) {
      if (part) out.push(part.toLowerCase());
    }
  }
  return out;
}

export function buildCorpusStats(docs: string[][]): CorpusStats {
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  return { docCount: docs.length, avgDocLength: docs.length ? docs.reduce((sum, d) => sum + d.length, 0) / docs.length : 0, documentFrequency };
}

export function scoreBm25(queryTokens: string[], docTokens: string[], stats: CorpusStats): number {
  if (!queryTokens.length || !docTokens.length || !stats.docCount) return 0;
  const k1 = 1.2;
  const b = 0.75;
  const frequencies = new Map<string, number>();
  for (const term of docTokens) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  let score = 0;
  for (const term of new Set(queryTokens)) {
    const frequency = frequencies.get(term) ?? 0;
    if (!frequency) continue;
    const df = stats.documentFrequency.get(term) ?? 0;
    const idf = Math.log(1 + (stats.docCount - df + 0.5) / (df + 0.5));
    const denominator = frequency + k1 * (1 - b + b * (docTokens.length / (stats.avgDocLength || 1)));
    score += idf * ((frequency * (k1 + 1)) / denominator);
  }
  return score;
}
