/**
 * src/search/cli.ts
 * -------------------
 * Task 7/AS-SCP — registers the `nim-skill search` command GROUP.
 *
 * `registerSearchCommands(program)` restructures the previously-leaf
 * `search` command into a Commander group that still runs the EXACT same
 * legacy behavior (`nim-skill search "<query>" --files <paths...>`) as its
 * own default action (verified live: attaching `.argument()`/`.action()`
 * directly on a group Command object fires precisely when no subcommand
 * matches — Commander does support this; see the task report's probe run),
 * while adding four new named subcommands as siblings: `overview`, `graph`,
 * `hydrate`, `compile`.
 *
 * Structure: every subcommand's real logic lives in a throwing "core"
 * function (`coreSearchOverview`, `coreSearchGraph`, `coreSearchHydrate`,
 * `coreSearchCompile`) that validates input via Zod and throws a plain
 * `Error` with a single clean message on any failure — never a stack trace
 * is the CONTRACT, but tests need a throwable, awaitable function rather
 * than one that mutates `process.exitCode` and swallows. The thin
 * `registerSearchCommands()` CLI layer is the only place that catches these
 * errors and converts them into "one-line stderr + exit code 1" (CHAOS-01).
 * Every reported token count goes through estimateTokens/estimateTokensOf
 * from '../tokens.js'; none is ever hardcoded.
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Command } from 'commander';
import { z } from 'zod';
import { createSearchHelper } from './index.js';
import { buildIncrementalIndex, shouldSkip, walk } from './indexer.js';
import { tokenizeIdentifier, scoreBm25, buildCorpusStats } from './bm25.js';
import { extractAnySymbols, type AstSymbol } from './ast-symbols.js';
import { ContextGraph } from './graph.js';
import type { GraphEdge, GraphNode, GraphRelationship } from './graph-sources/types.js';
import { GitSource } from './graph-sources/git-source.js';
import { VfsSerpManager, type SerpCandidate, type HydrateSnippet } from './vfs.js';
import { SpecEnvelopeZodSchema, SpecCompiler, type SpecEnvelope } from './compiler.js';
import { estimateTokens } from '../tokens.js';

const RELATIONSHIPS = ['IMPLEMENTS', 'CALLS', 'DEPENDS_ON', 'SUPERSEDES', 'DISCUSSED_IN', 'OWNED_BY'] as const;
const GRANULARITIES = ['signatures_only', 'full_block', 'dependencies_table'] as const;
const SCOPES = ['codebase', 'specs', 'discussions', 'all'] as const;

const GIST_TOKEN_CAP = 40;
const HYDRATE_TOKEN_CAP = 150;
const OVERVIEW_TOP_K_DEFAULT = 30;
const OVERVIEW_TOP_K_MAX = 50;
const HYDRATE_MAX_NODES = 10;

/**
 * `declarative_intent` must read like a sentence, not a "caveman query" —
 * at least 3 whitespace-separated tokens AND at least 15 characters total.
 * Deliberately not real NLP; a bounded, deterministic heuristic per the
 * PRD's own guidance not to over-engineer this check.
 */
const SearchOverviewInputSchema = z.object({
  declarative_intent: z
    .string()
    .min(15, 'declarative_intent must be at least 15 characters — describe the intent as a full sentence, not a keyword query')
    .refine(
      (value) => value.trim().split(/\s+/).filter(Boolean).length >= 3,
      'declarative_intent must contain at least 3 words — describe the intent as a full sentence, not a keyword query',
    ),
  scope: z.enum(SCOPES).optional(),
  top_k: z.number().int().positive().max(OVERVIEW_TOP_K_MAX).optional(),
  min_score: z.number().nonnegative().optional(),
  root: z.string().optional(),
});

const TraverseContextGraphInputSchema = z.object({
  origin_node_id: z.string().min(1, 'origin_node_id must not be empty'),
  relationship: z.enum(RELATIONSHIPS),
  max_depth: z.number().int().positive().optional(),
  root: z.string().optional(),
});

const HydrateSpecContextInputSchema = z.object({
  node_ids: z
    .array(z.string().min(1))
    .min(1, 'at least one node_id is required')
    .max(HYDRATE_MAX_NODES, `at most ${HYDRATE_MAX_NODES} node_ids may be hydrated per call`),
  granularity: z.enum(GRANULARITIES).optional(),
  root: z.string().optional(),
  query_hash: z.string().optional(),
});

const CompileSpecificationArtifactInputSchema = z.object({
  title: z.string().min(1, 'title must not be empty'),
  spec: z.unknown(),
  root: z.string().optional(),
});

export interface SearchOverviewCandidate {
  entity_id: string;
  entity_type: string;
  title: string;
  uri: string;
  gist: string;
  score: number;
  token_cost: number;
}

export interface SearchOverviewOutput {
  query_hash: string;
  total_candidates: number;
  vfs_serp_path: string;
  candidates: SearchOverviewCandidate[];
}

export interface TraverseContextGraphOutput {
  origin_node_id: string;
  traversed_edges: ReturnType<ContextGraph['traverseGraph']>;
}

export interface HydratedNode {
  node_id: string;
  uri: string;
  token_count: number;
}

export interface HydrateSpecContextOutput {
  vfs_hydrated_dir: string;
  hydrated_nodes: HydratedNode[];
  total_tokens_consumed: number;
}

export interface CompileSpecificationArtifactOutput {
  spec_id: string;
  markdown_path: string;
  json_path: string;
  verification_status: 'PASS' | 'FAILED';
  verified_symbol_count: number;
  hallucinated_symbols: string[];
}

/** One-line gist: first non-empty line of the file, collapsed to whitespace, capped at GIST_TOKEN_CAP tokens. */
function buildGist(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  let gist = firstLine.replace(/\s+/g, ' ');
  while (estimateTokens(gist) > GIST_TOKEN_CAP && gist.length > 0) {
    gist = gist.slice(0, Math.floor(gist.length * 0.9));
  }
  return gist;
}

/** Bounded workspace file listing shared by graph/compile symbol extraction — reuses indexer.ts's walk()/shouldSkip(), never re-implemented. */
function collectWorkspaceFiles(root: string): Array<{ filePath: string; content: string }> {
  const out: Array<{ filePath: string; content: string }> = [];
  for (const filePath of walk(root)) {
    let result;
    try {
      result = shouldSkip(filePath);
    } catch {
      continue;
    }
    if (result.skip || result.content === undefined) continue;
    out.push({ filePath, content: result.content });
  }
  return out;
}

interface SymbolLocation {
  nodeId: string;
  filePath: string;
  symbol: AstSymbol;
}

/** Extracts AST symbols across the bounded workspace file set, keyed by a stable `symbol::<relPath>::<name>` node id. */
function extractWorkspaceSymbols(root: string): { files: Array<{ filePath: string; content: string }>; symbols: SymbolLocation[] } {
  const files = collectWorkspaceFiles(root);
  const symbols: SymbolLocation[] = [];
  for (const { filePath, content } of files) {
    const relPath = relative(root, filePath);
    for (const symbol of extractAnySymbols(filePath, content)) {
      symbols.push({ nodeId: `symbol::${relPath}::${symbol.name}`, filePath, symbol });
    }
  }
  return { files, symbols };
}

interface WorkspaceGraph {
  graph: ContextGraph;
  /**
   * `ContextGraph`'s own node map is private and its exported surface has no
   * `hasNode()`/lookup method (an existing export we must not modify) — this
   * sibling Set is built from the exact same node lists handed to
   * `graph.addNodes()`, so it always matches reality without reaching into
   * the class's internals.
   */
  nodeIds: Set<string>;
}

/** Builds the ContextGraph from GitSource (always) plus AST CodeFile/Symbol nodes with IMPLEMENTS edges. */
async function buildWorkspaceGraph(root: string): Promise<WorkspaceGraph> {
  const graph = new ContextGraph();
  const nodeIds = new Set<string>();

  const gitResult = await new GitSource(root).ingest();
  graph.addNodes(gitResult.nodes);
  graph.addEdges(gitResult.edges);
  for (const node of gitResult.nodes) nodeIds.add(node.id);

  const { files, symbols } = extractWorkspaceSymbols(root);
  const now = new Date().toISOString();

  const fileNodes: GraphNode[] = files.map(({ filePath }) => {
    const relPath = relative(root, filePath);
    return {
      id: `file::${relPath}`,
      type: 'CodeFile',
      name: relPath,
      uri: `file://${relPath}`,
      digestSha256: ''.padEnd(64, '0'),
      lastModified: now,
    };
  });

  const symbolNodes: GraphNode[] = symbols.map(({ nodeId, filePath, symbol }) => {
    const relPath = relative(root, filePath);
    return {
      id: nodeId,
      type: 'Symbol',
      name: symbol.name,
      uri: `file://${relPath}#L${symbol.lineStart}-L${symbol.lineEnd}`,
      digestSha256: symbol.digestSha256,
      lastModified: now,
      astMetadata: { kind: symbol.kind, lineStart: symbol.lineStart, lineEnd: symbol.lineEnd, isExported: symbol.isExported },
    };
  });

  graph.addNodes(fileNodes);
  graph.addNodes(symbolNodes);
  for (const node of fileNodes) nodeIds.add(node.id);
  for (const node of symbolNodes) nodeIds.add(node.id);

  const implementsEdges: GraphEdge[] = symbols
    .filter(({ symbol }) => symbol.isExported)
    .map(({ nodeId, filePath }) => ({
      sourceId: `file::${relative(root, filePath)}`,
      targetId: nodeId,
      relationship: 'IMPLEMENTS' as GraphRelationship,
      metadata: { confidence: 1, createdAt: now },
    }));
  graph.addEdges(implementsEdges);

  return { graph, nodeIds };
}

function firstIssueMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

// ─── search_overview (core) ─────────────────────────────────────────────────

export interface SearchOverviewRawOpts {
  scope?: string;
  topK?: string;
  minScore?: string;
  root?: string;
}

export function coreSearchOverview(rawIntent: string, rawOpts: SearchOverviewRawOpts): SearchOverviewOutput {
  const parsedInput = SearchOverviewInputSchema.safeParse({
    declarative_intent: rawIntent,
    scope: rawOpts.scope,
    top_k: rawOpts.topK !== undefined ? Number(rawOpts.topK) : undefined,
    min_score: rawOpts.minScore !== undefined ? Number(rawOpts.minScore) : undefined,
    root: rawOpts.root,
  });
  if (!parsedInput.success) throw new Error(firstIssueMessage(parsedInput.error, 'invalid search overview input'));
  const input = parsedInput.data;

  const root = input.root ? join(input.root) : process.cwd();
  const topK = Math.min(input.top_k ?? OVERVIEW_TOP_K_DEFAULT, OVERVIEW_TOP_K_MAX);
  const minScore = input.min_score ?? 0;

  const { files } = buildIncrementalIndex(root);
  const queryTokens = tokenizeIdentifier(input.declarative_intent);

  // Re-tokenized from disk rather than read back off PersistedIndex's on-disk shape (not part of
  // the ground truth's exported API) — decouples this command from that internal file format, at
  // the cost of one extra read pass, which is acceptable for a CLI invocation.
  const docs = files.map((filePath) => {
    try {
      return tokenizeIdentifier(readFileSync(filePath, 'utf8'));
    } catch {
      return [];
    }
  });
  const stats = buildCorpusStats(docs);

  const scored = files
    .map((filePath, i) => ({ filePath, score: scoreBm25(queryTokens, docs[i] ?? [], stats) }))
    .filter((entry) => entry.score >= minScore && entry.score > 0)
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
    .slice(0, topK);

  const candidates: SearchOverviewCandidate[] = scored.map(({ filePath, score }) => {
    const relPath = relative(root, filePath);
    let content = '';
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      content = '';
    }
    const gist = buildGist(content);
    return {
      entity_id: `file::${relPath}`,
      entity_type: 'CodeFile',
      title: relPath,
      uri: `file://${relPath}`,
      gist,
      score,
      token_cost: estimateTokens(gist),
    };
  });

  const serpCandidates: SerpCandidate[] = candidates.map((c) => ({
    entity_id: c.entity_id,
    entity_type: c.entity_type,
    title: c.title,
    uri: c.uri,
    gist: c.gist,
    score: c.score,
  }));

  const vfs = new VfsSerpManager(root);
  const mounted = vfs.mountSerp(input.declarative_intent, serpCandidates);

  return {
    query_hash: mounted.query_hash,
    total_candidates: candidates.length,
    vfs_serp_path: mounted.serp_dir,
    candidates,
  };
}

// ─── traverse_context_graph (core) ──────────────────────────────────────────

export interface TraverseContextGraphRawOpts {
  relationship?: string;
  maxDepth?: string;
  root?: string;
}

export async function coreSearchGraph(originNodeId: string, rawOpts: TraverseContextGraphRawOpts): Promise<TraverseContextGraphOutput> {
  const parsedInput = TraverseContextGraphInputSchema.safeParse({
    origin_node_id: originNodeId,
    relationship: rawOpts.relationship,
    max_depth: rawOpts.maxDepth !== undefined ? Number(rawOpts.maxDepth) : undefined,
    root: rawOpts.root,
  });
  if (!parsedInput.success) throw new Error(firstIssueMessage(parsedInput.error, 'invalid traverse_context_graph input'));
  const input = parsedInput.data;

  const root = input.root ? join(input.root) : process.cwd();
  const { graph, nodeIds } = await buildWorkspaceGraph(root);

  if (!nodeIds.has(input.origin_node_id)) {
    throw new Error(`origin_node_id not found in the built context graph: ${input.origin_node_id}`);
  }

  const traversed_edges = graph.traverseGraph(input.origin_node_id, input.relationship, input.max_depth ?? 1);
  return { origin_node_id: input.origin_node_id, traversed_edges };
}

// ─── hydrate_spec_context (core) ────────────────────────────────────────────

/** Truncates `text` to at most `capTokens` (estimateTokens), appending a clear marker rather than cutting silently. */
function truncateToTokenCap(text: string, capTokens: number): string {
  if (estimateTokens(text) <= capTokens) return text;
  const marker = '\n/* ...truncated... */';
  const markerTokens = estimateTokens(marker);
  const budgetChars = Math.max(0, (capTokens - markerTokens) * 4);
  return text.slice(0, budgetChars) + marker;
}

export interface HydrateSpecContextRawOpts {
  granularity?: string;
  root?: string;
  queryHash?: string;
}

export async function coreSearchHydrate(rawNodeIds: string[], rawOpts: HydrateSpecContextRawOpts): Promise<HydrateSpecContextOutput> {
  const parsedInput = HydrateSpecContextInputSchema.safeParse({
    node_ids: rawNodeIds,
    granularity: rawOpts.granularity,
    root: rawOpts.root,
    query_hash: rawOpts.queryHash,
  });
  if (!parsedInput.success) throw new Error(firstIssueMessage(parsedInput.error, 'invalid hydrate_spec_context input'));
  const input = parsedInput.data;

  const root = input.root ? join(input.root) : process.cwd();
  const { symbols } = extractWorkspaceSymbols(root);
  const byNodeId = new Map(symbols.map((entry) => [entry.nodeId, entry]));

  const vfs = new VfsSerpManager(root);
  // Simpler-correct choice (documented per the task's own instruction to pick one and note it):
  // when no --query-hash is supplied, mount a fresh, minimal SERP purely to obtain a real
  // query_hash from VfsSerpManager's own hashing — never synthesize a hash format that could
  // drift from mountSerp()'s actual convention (`q_<sha256 prefix>`).
  const queryHash = input.query_hash ?? vfs.mountSerp(`hydrate:${input.node_ids.join(',')}`, []).query_hash;

  const snippets: HydrateSnippet[] = [];
  const hydrated_nodes: HydratedNode[] = [];

  for (const nodeId of input.node_ids) {
    const location = byNodeId.get(nodeId);
    if (!location) {
      throw new Error(`node_id could not be resolved to a real file + line range: ${nodeId}`);
    }
    let fileContent: string;
    try {
      fileContent = readFileSync(location.filePath, 'utf8');
    } catch {
      throw new Error(`node_id's source file could not be read: ${nodeId}`);
    }
    const lines = fileContent.split('\n');
    const rawSnippet = lines.slice(location.symbol.lineStart - 1, location.symbol.lineEnd).join('\n');
    const snippet = truncateToTokenCap(rawSnippet, HYDRATE_TOKEN_CAP);
    const relPath = relative(root, location.filePath);
    const uri = `file://${relPath}#L${location.symbol.lineStart}-L${location.symbol.lineEnd}`;

    snippets.push({ nodeId, uri, snippet });
    hydrated_nodes.push({ node_id: nodeId, uri, token_count: estimateTokens(snippet) });
  }

  const vfs_hydrated_dir = vfs.hydrateSnippets(queryHash, snippets);
  const total_tokens_consumed = hydrated_nodes.reduce((sum, n) => sum + n.token_count, 0);

  return { vfs_hydrated_dir, hydrated_nodes, total_tokens_consumed };
}

// ─── compile_specification_artifact (core) ──────────────────────────────────

export interface CompileSpecificationArtifactRawOpts {
  title?: string;
  /** A parsed JSON value (already read from file/stdin by the CLI layer, or supplied directly by a test). */
  specValue?: unknown;
  root?: string;
}

export function coreSearchCompile(rawOpts: CompileSpecificationArtifactRawOpts): CompileSpecificationArtifactOutput {
  const parsedInput = CompileSpecificationArtifactInputSchema.safeParse({ title: rawOpts.title, spec: rawOpts.specValue, root: rawOpts.root });
  if (!parsedInput.success) throw new Error(firstIssueMessage(parsedInput.error, 'invalid compile_specification_artifact input'));
  const input = parsedInput.data;

  const specParse = SpecEnvelopeZodSchema.safeParse(input.spec);
  if (!specParse.success) throw new Error(`--spec failed SpecEnvelope schema validation: ${firstIssueMessage(specParse.error, 'invalid spec')}`);
  const spec: SpecEnvelope = specParse.data;

  const root = input.root ? join(input.root) : process.cwd();
  const { symbols } = extractWorkspaceSymbols(root);
  const knownSymbols = new Set(symbols.map((entry) => entry.symbol.name));

  // Independently derived (not parsed back out of the compiler's own human-readable
  // `missingSymbols` strings, which are formatted as "<symbol> (declared in <file>)")
  // so hallucinated_symbols reports exactly the bare symbol name per the output contract.
  const hallucinated_symbols = spec.dependencies.filter((dep) => !knownSymbols.has(dep.symbol)).map((dep) => dep.symbol);
  const verified_symbol_count = spec.dependencies.length - hallucinated_symbols.length;

  const compiler = new SpecCompiler(root);
  const result = compiler.compile(spec, knownSymbols);

  return {
    spec_id: spec.spec_id,
    markdown_path: result.markdownPath,
    json_path: result.jsonPath,
    verification_status: result.valid ? 'PASS' : 'FAILED',
    verified_symbol_count,
    hallucinated_symbols,
  };
}

function readSpecPayload(specPath: string): unknown {
  const raw = specPath === '-' ? readFileSync(0, 'utf8') : readFileSync(specPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`--spec did not contain valid JSON: ${specPath}`);
  }
}

// ─── legacy leaf action (byte-identical to the pre-Task-7 `search` command) ─

export interface LegacySearchOpts {
  files: string[];
  topK: string;
  minScore: string;
}

/** Exact pre-Task-7 leaf-command body, unchanged, moved here verbatim. */
export function runLegacySearch(query: string, opts: LegacySearchOpts): void {
  const results = createSearchHelper({}).searchFiles(query, opts.files, { topK: Number(opts.topK), minScore: Number(opts.minScore) });
  process.stdout.write(
    results.map((result) => `${result.score.toFixed(4)}\t${result.sourcePath}\t${result.headerPath.join(' > ')}\n${result.text}`).join('\n\n') +
      (results.length ? '\n' : ''),
  );
}

// ─── CLI wiring — the only layer that turns a thrown Error into stderr+exit ─

/** Runs a synchronous action, converting any thrown Error into a single clean stderr line + exit code 1 (never a stack trace). */
function runClean(action: () => void): void {
  try {
    action();
  } catch (err) {
    process.stderr.write(`nim: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

/** Async counterpart of `runClean()`. */
async function runCleanAsync(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    process.stderr.write(`nim: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

/**
 * Registers the `search` command group on `program`. The group itself keeps
 * the exact pre-existing leaf signature/behavior as its default action
 * (fires only when no subcommand matches — verified live against this
 * repo's installed `commander` version), and gains four new subcommands.
 */
export function registerSearchCommands(program: Command): void {
  const searchCmd = program
    .command('search')
    .argument('[query]', 'free-text recall query (legacy mode; omit when using a subcommand)')
    .option('--files <paths...>', 'memory, lesson, or archive files to search (legacy mode)')
    .option('--top-k <n>', 'maximum ranked results', '5')
    .option('--min-score <n>', 'minimum BM25 score', '0')
    .description('Search local memory-like Markdown/text files using deterministic BM25 ranking (legacy mode), or use a subcommand.')
    .action((query: string | undefined, opts: { files?: string[]; topK: string; minScore: string }) => {
      runClean(() => {
        if (!query || !opts.files || opts.files.length === 0) {
          throw new Error('the legacy `search "<query>" --files <paths...>` form requires both a query and --files; see `nim-skill search --help`');
        }
        runLegacySearch(query, opts as LegacySearchOpts);
      });
    });

  searchCmd
    .command('overview')
    .argument('<declarative_intent>', 'a full-sentence description of search intent (not a keyword query)')
    .option('--scope <scope>', 'codebase | specs | discussions | all')
    .option('--top-k <n>', `maximum ranked results (default ${OVERVIEW_TOP_K_DEFAULT}, hard max ${OVERVIEW_TOP_K_MAX})`)
    .option('--min-score <n>', 'minimum BM25 score (default 0)')
    .option('--root <path>', 'workspace root (default: current directory)')
    .description('search_overview — declarative-intent BM25 recall over the workspace, mounted as a VFS SERP.')
    .action((declarativeIntent: string, opts: SearchOverviewRawOpts) => {
      runClean(() => {
        const output = coreSearchOverview(declarativeIntent, opts);
        process.stdout.write(JSON.stringify(output) + '\n');
      });
    });

  searchCmd
    .command('graph')
    .argument('<origin_node_id>', 'a node id from a prior `search overview`/`search graph` result')
    .requiredOption('--relationship <relationship>', `one of ${RELATIONSHIPS.join('|')}`)
    .option('--max-depth <n>', 'traversal depth (clamped to 3 internally)')
    .option('--root <path>', 'workspace root (default: current directory)')
    .description('traverse_context_graph — BFS over the git+AST-derived context graph from an origin node.')
    .action(async (originNodeId: string, opts: TraverseContextGraphRawOpts) => {
      await runCleanAsync(async () => {
        const output = await coreSearchGraph(originNodeId, opts);
        process.stdout.write(JSON.stringify(output) + '\n');
      });
    });

  searchCmd
    .command('hydrate')
    .argument('<node_id...>', 'up to 10 node ids to hydrate into standalone snippet files')
    .option('--granularity <granularity>', `one of ${GRANULARITIES.join('|')}`)
    .option('--root <path>', 'workspace root (default: current directory)')
    .option('--query-hash <hash>', 'an existing SERP query_hash to hydrate into (default: mounts a fresh minimal SERP)')
    .description('hydrate_spec_context — resolve node ids to real file snippets and write them under the VFS SERP.')
    .action(async (nodeIds: string[], opts: HydrateSpecContextRawOpts) => {
      await runCleanAsync(async () => {
        const output = await coreSearchHydrate(nodeIds, opts);
        process.stdout.write(JSON.stringify(output) + '\n');
      });
    });

  searchCmd
    .command('compile')
    .requiredOption('--title <title>', 'feature title (informational; spec_id comes from the SpecEnvelope itself)')
    .requiredOption('--spec <path>', 'path to a SpecEnvelope JSON file, or - for stdin')
    .option('--root <path>', 'workspace root (default: current directory)')
    .description("compile_specification_artifact — verify a SpecEnvelope's symbol dependencies against the real workspace AST, then write it.")
    .action((opts: { title?: string; spec?: string; root?: string }) => {
      runClean(() => {
        const specValue = opts.spec ? readSpecPayload(opts.spec) : undefined;
        const output = coreSearchCompile({ title: opts.title, specValue, root: opts.root });
        process.stdout.write(JSON.stringify(output) + '\n');
        if (output.verification_status === 'FAILED') process.exitCode = 1;
      });
    });
}
