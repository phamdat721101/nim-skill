import { estimateTokens } from '../tokens.js';
import type { MemoryChunk } from './types.js';

const DEFAULT_MIN = 80;
const DEFAULT_MAX = 450;

function prefix(sourcePath: string, headers: string[]): string {
  return `[Source: ${sourcePath}${headers.length ? ` > ${headers.join(' > ')}` : ''}]`;
}

function splitBody(body: string, maxTokens: number): string[] {
  if (estimateTokens(body) <= maxTokens) return [body];
  const parts: string[] = [];
  let current = '';
  for (const paragraph of body.split(/\n\n+/)) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && estimateTokens(next) > maxTokens) {
      parts.push(current);
      current = paragraph;
    } else current = next;
  }
  if (current) parts.push(current);
  return parts;
}

/** JSONL and Markdown tables have no headings, so split them at their durable
 * record boundary before the normal token budget is applied. */
function recordBodies(body: string): string[] {
  const lines = body.split('\n').filter(Boolean);
  if (lines.length > 1 && lines.every((line) => line.trim().startsWith('{'))) return lines;
  const tableRows = lines.filter((line) => /^\|/.test(line) && !/^\|?\s*[-:| ]+\|/.test(line));
  return tableRows.length > 1 ? tableRows : [body];
}

/** Header-aware, deterministic Markdown chunking. Short header sections stay atomic. */
export function chunkMarkdown(sourcePath: string, text: string, opts: { minTokens?: number; maxTokens?: number } = {}): MemoryChunk[] {
  const minTokens = opts.minTokens ?? DEFAULT_MIN;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX;
  if (minTokens < 1 || maxTokens < minTokens) throw new Error('invalid chunk token bounds');
  const sections: Array<{ headers: string[]; body: string[] }> = [];
  let headers: string[] = [];
  let body: string[] = [];
  const flush = () => { if (body.join('\n').trim()) sections.push({ headers: [...headers], body: [...body] }); };
  for (const line of text.split('\n')) {
    const match = /^(##|###)\s+(.+?)\s*$/.exec(line);
    if (!match) { body.push(line); continue; }
    flush(); body = [];
    if (match[1] === '##') headers = [match[2]!];
    else headers = [headers[0] ?? '', match[2]!].filter(Boolean);
  }
  flush();
  return sections.flatMap(({ headers: path, body: lines }) => {
    const sectionBody = lines.join('\n').trim();
    const records = recordBodies(sectionBody);
    const bodies = records.flatMap((record) => estimateTokens(record) <= Math.max(maxTokens, minTokens) ? [record] : splitBody(record, maxTokens));
    return bodies.map((part) => {
      const chunkText = `${prefix(sourcePath, path)}\n${part}`;
      return { sourcePath, headerPath: path, text: chunkText, tokenEstimate: estimateTokens(chunkText) };
    });
  });
}
