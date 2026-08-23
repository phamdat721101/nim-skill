export interface CompactionInput {
  /** Audit-only identity of the append-only source. It is never read or written. */
  sourcePath: string;
  /** A separate distilled artifact path. */
  outputPath: string;
}

export interface CompactionOutput {
  updatedInvariants: string[];
  archiveEntry: { date: string; taskName: string; rootCause: string; resolution: string; modifiedFiles?: string[] };
  resetScratchpad: string;
}

export interface CompactConfig { outputSuffix?: string; maxInvariants?: number; }
export interface CompactionResult { written: boolean; outputPath: string; invariantCount: number; archiveEntryCount: number; }

export interface CompactHelper {
  apply(input: CompactionInput, candidate: CompactionOutput): CompactionResult;
  readInvariants(outputPath: string): string[];
}
