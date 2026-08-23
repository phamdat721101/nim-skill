export interface MemoryChunk {
  sourcePath: string;
  headerPath: string[];
  text: string;
  tokenEstimate: number;
}

export interface SearchOpts { topK?: number; minScore?: number; }
export interface SearchConfig { topK?: number; minScore?: number; }

export interface SearchResultEntry {
  sourcePath: string;
  headerPath: string[];
  text: string;
  score: number;
}

export interface SearchTrace {
  query: string;
  chunkCount: number;
  returnedCount: number;
}

export interface SearchHelper {
  search(query: string, chunks: MemoryChunk[], opts?: SearchOpts): SearchResultEntry[];
  searchFiles(query: string, filePaths: string[], opts?: SearchOpts): SearchResultEntry[];
}
