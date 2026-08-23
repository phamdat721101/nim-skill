export interface CorpusStats { docCount: number; avgDocLength: number; documentFrequency: Map<string, number>; }

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
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
