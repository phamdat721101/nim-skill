import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { CompactConfig, CompactHelper, CompactionInput, CompactionOutput, CompactionResult } from './types.js';

const candidateSchema = z.object({
  updatedInvariants: z.array(z.string().min(1)),
  archiveEntry: z.object({ date: z.string().min(1), taskName: z.string().min(1), rootCause: z.string().min(1), resolution: z.string().min(1), modifiedFiles: z.array(z.string()).optional() }).strict(),
  resetScratchpad: z.string(),
}).strict();

export function validateCompactionOutput(value: unknown): CompactionOutput { return candidateSchema.parse(value); }

function readArchiveCount(text: string): number { return (text.match(/^## Archive Entry /gm) ?? []).length; }
function parseInvariants(text: string): string[] {
  const match = /^## Curated Invariants\n([\s\S]*?)(?=^## |\z)/m.exec(text.replace(/\n?$/, '\n'));
  return match ? (match[1] ?? '').split('\n').map((line) => /^-\s+(.+)$/.exec(line)?.[1]).filter((line): line is string => !!line) : [];
}
function render(candidate: CompactionOutput, maxInvariants: number, previous: string): string {
  const invariants = [...new Set(candidate.updatedInvariants.map((value) => value.trim()).filter(Boolean))].slice(-maxInvariants);
  const archive = candidate.archiveEntry;
  const files = archive.modifiedFiles?.length ? `\nModified files: ${archive.modifiedFiles.join(', ')}` : '';
  const existingArchives = previous.replace(/^[\s\S]*?(?=^## Archive Entry |\z)/m, '').trim();
  const entry = `## Archive Entry ${archive.date}\nTask: ${archive.taskName}\n\nRoot cause: ${archive.rootCause}\n\nResolution: ${archive.resolution}${files}\n\nReset scratchpad: ${candidate.resetScratchpad}`;
  return `# Distilled Memory\n\n## Curated Invariants\n${invariants.map((value) => `- ${value}`).join('\n') || '- None'}\n\n${[existingArchives, entry].filter(Boolean).join('\n\n')}\n`;
}

export function createCompactor(cfg: CompactConfig = {}): CompactHelper {
  const maxInvariants = cfg.maxInvariants ?? 10;
  if (maxInvariants < 1) throw new Error('compact.maxInvariants must be positive');
  return {
    apply(input: CompactionInput, rawCandidate: CompactionOutput): CompactionResult {
      if (!input.sourcePath || !input.outputPath || input.sourcePath === input.outputPath) throw new Error('sourcePath and outputPath must be distinct');
      const candidate = validateCompactionOutput(rawCandidate);
      const previous = existsSync(input.outputPath) ? readFileSync(input.outputPath, 'utf8') : '';
      const output = render(candidate, maxInvariants, previous);
      mkdirSync(dirname(input.outputPath), { recursive: true });
      const temporary = `${input.outputPath}.tmp`;
      writeFileSync(temporary, output, 'utf8');
      renameSync(temporary, input.outputPath);
      return { written: true, outputPath: input.outputPath, invariantCount: parseInvariants(output).length, archiveEntryCount: readArchiveCount(output) };
    },
    readInvariants(outputPath: string): string[] { return existsSync(outputPath) ? parseInvariants(readFileSync(outputPath, 'utf8')) : []; },
  };
}

export type { CompactConfig, CompactHelper, CompactionInput, CompactionOutput, CompactionResult } from './types.js';
