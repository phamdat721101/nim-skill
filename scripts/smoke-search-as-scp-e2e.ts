#!/usr/bin/env tsx
/**
 * scripts/smoke-search-as-scp-e2e.ts
 * ------------------------------------
 * Task 8/AS-SCP — a standalone end-to-end smoke test of the full 4-tier
 * AS-SCP retrieval pipeline, run ONCE for real against this actual repo:
 *
 *   Tier 1 (overview)  -> coreSearchOverview()
 *   Tier 2 (graph)     -> coreSearchGraph()   (origin = a real candidate's entity_id)
 *   Tier 3 (hydrate)   -> coreSearchHydrate() (a real node id found via Tier 2, or Tier 1)
 *   Tier 4 (compile)   -> coreSearchCompile() (a SpecEnvelope referencing a real symbol)
 *
 * Every reported token number goes through `estimateTokens`/`estimateTokensOf`
 * from ../src/tokens.js — nothing here is a hardcoded figure. Exits 0 on
 * success (prints the real total token cost across all 4 tiers), exits 1
 * with a clear message identifying which tier threw.
 *
 * No scripts/ directory pre-existed in this repo (checked via glob before
 * writing this file), so this establishes the convention: a single-purpose,
 * directly `tsx`-runnable script, no shared scaffolding assumed.
 */

import { coreSearchOverview, coreSearchGraph, coreSearchHydrate, coreSearchCompile } from '../src/search/cli.js';
import { estimateTokens, estimateTokensOf } from '../src/tokens.js';
import { extractAnySymbols } from '../src/search/ast-symbols.js';
import { walk, shouldSkip } from '../src/search/indexer.js';

const ROOT = process.cwd();

function findOneRealSymbolName(root: string): string {
  for (const filePath of walk(root)) {
    let result;
    try {
      result = shouldSkip(filePath);
    } catch {
      continue;
    }
    if (result.skip || result.content === undefined) continue;
    for (const symbol of extractAnySymbols(filePath, result.content)) {
      if (symbol.isExported) return symbol.name;
    }
  }
  throw new Error('no exported symbol found anywhere in the workspace');
}

async function main(): Promise<void> {
  let tokensTotal = 0;
  const breakdown: Array<{ tier: string; tokens: number }> = [];

  // ── Tier 1: search_overview ──────────────────────────────────────────────
  console.log('[tier1] running coreSearchOverview()...');
  const overview = coreSearchOverview('find the CLI command that registers the search subcommands', { root: ROOT });
  if (overview.candidates.length === 0) throw new Error('tier1 (overview): zero candidates returned — cannot proceed to tier2/3');
  const tier1Tokens = overview.candidates.reduce((sum, c) => sum + c.token_cost, 0);
  tokensTotal += tier1Tokens;
  breakdown.push({ tier: 'tier1_overview', tokens: tier1Tokens });
  console.log(`[tier1] ${overview.candidates.length} candidates, ${tier1Tokens} tokens, serp=${overview.vfs_serp_path}`);

  const originCandidate = overview.candidates[0]!;
  console.log(`[tier1] picked candidate entity_id=${originCandidate.entity_id}`);

  // ── Tier 2: traverse_context_graph ───────────────────────────────────────
  // The origin picked from Tier 1 is a `file::` (CodeFile) node. The
  // IMPLEMENTS relationship (wired in buildWorkspaceGraph(), src/search/cli.ts)
  // points from a CodeFile to the exported `symbol::` nodes it defines — this
  // is the real, natural path from an overview candidate to a hydrate-able
  // symbol node id, since coreSearchHydrate() only resolves `symbol::` ids
  // (found via extractWorkspaceSymbols()), never bare `file::` ids.
  console.log('[tier2] running coreSearchGraph()...');
  let symbolNodeId: string | undefined;
  let origin = originCandidate.entity_id;
  for (const candidate of overview.candidates) {
    const graphOutput = await coreSearchGraph(candidate.entity_id, { relationship: 'IMPLEMENTS', root: ROOT });
    const symbolHit = graphOutput.traversed_edges.find((edge) => edge.target_type === 'Symbol');
    if (symbolHit) {
      symbolNodeId = symbolHit.target_node_id;
      origin = candidate.entity_id;
      const tier2Tokens = estimateTokensOf(graphOutput);
      tokensTotal += tier2Tokens;
      breakdown.push({ tier: 'tier2_graph', tokens: tier2Tokens });
      console.log(`[tier2] origin=${origin}: ${graphOutput.traversed_edges.length} traversed edges, ${tier2Tokens} tokens; picked Symbol node ${symbolNodeId}`);
      break;
    }
  }
  if (!symbolNodeId) throw new Error('tier2 (graph): no candidate in the overview result yielded an IMPLEMENTS edge to a Symbol node');

  const hydrateTargetNodeId = symbolNodeId;

  // ── Tier 3: hydrate_spec_context ─────────────────────────────────────────
  console.log(`[tier3] running coreSearchHydrate() on node_id=${hydrateTargetNodeId}...`);
  const hydrateOutput = await coreSearchHydrate([hydrateTargetNodeId], { root: ROOT });
  const tier3Tokens = hydrateOutput.total_tokens_consumed;
  tokensTotal += tier3Tokens;
  breakdown.push({ tier: 'tier3_hydrate', tokens: tier3Tokens });
  console.log(`[tier3] ${hydrateOutput.hydrated_nodes.length} hydrated node(s), ${tier3Tokens} tokens, dir=${hydrateOutput.vfs_hydrated_dir}`);

  // ── Tier 4: compile_specification_artifact ───────────────────────────────
  console.log('[tier4] finding a real symbol for the spec, then running coreSearchCompile()...');
  const realSymbol = findOneRealSymbolName(ROOT);
  console.log(`[tier4] using real symbol: ${realSymbol}`);
  const spec = {
    spec_id: 'SPEC-2026-950001',
    feature_name: 'AS-SCP end-to-end smoke test specification artifact',
    dependencies: [{ package_or_module: 'workspace', symbol: realSymbol, file_location: 'workspace' }],
    architecture: {
      pattern: 'smoke-test probe',
      isolation_boundaries: 'none — this is a throwaway verification artifact',
      execution_flow: ['tier1 overview', 'tier2 graph', 'tier3 hydrate', 'tier4 compile'],
    },
    data_contracts: { inputs: {}, outputs: {}, error_states: [] },
    test_criteria: ['the full 4-tier AS-SCP pipeline runs end-to-end against a real workspace without throwing'],
  };
  const compileOutput = coreSearchCompile({ title: 'AS-SCP smoke e2e', specValue: spec, root: ROOT });
  if (compileOutput.verification_status !== 'PASS') {
    throw new Error(`tier4 (compile): expected PASS against a real symbol, got ${compileOutput.verification_status}; hallucinated_symbols=${JSON.stringify(compileOutput.hallucinated_symbols)}`);
  }
  const tier4Tokens = estimateTokens(JSON.stringify(compileOutput));
  tokensTotal += tier4Tokens;
  breakdown.push({ tier: 'tier4_compile', tokens: tier4Tokens });
  console.log(`[tier4] verification_status=${compileOutput.verification_status}, spec_id=${compileOutput.spec_id}, ${tier4Tokens} tokens`);

  console.log('\n=== AS-SCP 4-tier smoke test: real per-tier token cost ===');
  for (const item of breakdown) console.log(`  ${item.tier}: ${item.tokens} tokens`);
  console.log(`  TOTAL: ${tokensTotal} tokens`);
  console.log('\n[smoke] PASS — full 4-tier pipeline ran end-to-end against this real workspace.');
}

main().catch((err) => {
  console.error(`[smoke] FAIL — ${(err as Error).message}`);
  process.exitCode = 1;
});
