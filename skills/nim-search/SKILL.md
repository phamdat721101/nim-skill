---
name: nim-search
description: Deterministic local BM25 recall over header-aware memory, lesson, and archive chunks. Zero network and no embedding model.
version: 0.15.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: Search a local memory-like corpus for prior decisions, incidents, lessons, or invariants before repeating work.
install: npx github:phamdat721101/nim-skill add nim-search
---

# nim-search

```bash
nim-skill search "why did deployment fail" --files .nim/agent-support-log.md .nim/lessons.jsonl --top-k 3
```

Configure `harness.search` to inject `ctx.search`; it is absent when disabled.

## AS-SCP additive surface: `search overview|graph|hydrate|compile`

The legacy `search "<query>" --files <paths...>` form above is unchanged and
remains the default action of the `search` command group. Four new sibling
subcommands add AST-aware code/spec search, relational graph traversal, and
spec compilation on top of the same local-first, zero-network design:

- **`nim-skill search overview <declarative_intent>`** — `search_overview`:
  BM25 recall over the workspace using a full-sentence `declarative_intent`
  (not a keyword query), mounted as a VFS SERP. Options: `--scope <codebase|specs|discussions|all>`,
  `--top-k <n>` (default 30, hard max 50), `--min-score <n>` (default 0),
  `--root <path>` (default: current directory).
- **`nim-skill search graph <origin_node_id>`** — `traverse_context_graph`:
  BFS traversal over the git+AST-derived context graph from an origin node
  id (obtained from a prior `overview`/`graph` result). Options:
  `--relationship <IMPLEMENTS|CALLS|DEPENDS_ON|SUPERSEDES|DISCUSSED_IN|OWNED_BY>`
  (required), `--max-depth <n>` (clamped to 3 internally), `--root <path>`.
- **`nim-skill search hydrate <node_id...>`** — `hydrate_spec_context`:
  resolves up to 10 node ids to real file snippets and writes them under the
  VFS SERP. Options: `--granularity <signatures_only|full_block|dependencies_table>`,
  `--root <path>`, `--query-hash <hash>` (default: mounts a fresh minimal SERP).
- **`nim-skill search compile --title <title> --spec <path>`** — `compile_specification_artifact`:
  verifies a SpecEnvelope JSON file's (or `-` for stdin) symbol dependencies
  against the real workspace AST, then writes the compiled artifact. Options:
  `--root <path>`.

All four subcommands print a single JSON line to stdout and convert any
validation/runtime error into a one-line stderr message + exit code 1 —
never a stack trace.

**Known quality gap (honest caveat):** the `overview` gist heuristic
currently produces degenerate (near-empty or unhelpful) one-line gists for a
meaningful fraction of candidates in real measured runs — see
`docs/prd/30-as-scp-measured-results.md` for the actual measured rates and
methodology. Treat `overview` output as a lead to verify against the real
file, not as ground truth.
