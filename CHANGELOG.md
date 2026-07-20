# Changelog

All notable changes to `nim-skill`. Format loosely follows Keep-a-Changelog;
every layer is additive + config-gated (absent/`false` ⇒ byte-identical bare run).

## [Unreleased] — v0.7 `nim-search` (docs-only PRD, awaiting approval)

- Master PRD for `nim-search` — a call-time tool filter that is `nim-index`'s
  missing runtime half: `nim-index measure` reports the standing MCP/skill
  disclosure tax; `nim-search` gives an agent (via CLI or an injected
  `ctx.search` helper) a way to filter that same manifest live, per query,
  at a detail level (`name` / `name+description` / `full`) — BM25-style
  lexical scoring, zero network, zero vector DB. Grounded in 5 dated 2026
  sources (Anthropic's Nov 2025 code-execution-with-MCP post + an
  independent replication + arXiv 2605.15184 + stackone.com + MDPI). Gstack
  15-frame score 38/42 on 14 relevant frames (F13 n/a); pre-mortem weighted
  ≈3.5/15 (below the 6/15 ship-it threshold). **No runtime code shipped
  yet** — docs-only in `docs/prd/13-master-prd-v07-nim-search.md`, same
  approval gate as every prior PRD.

## [0.6.0] — 2026-07-20 · `nim-workrule` (agent self-check + tracked memory)

### Added
- **`nim-workrule`** — the 6-rule working checklist an agent self-checks
  against ITS OWN editing behavior (not the content it produces — that's
  `nim-baseline`'s job): clean/simple/SOLID (WR-01), no repeated mistakes
  across modules (WR-02), essential files only (WR-03), partial reads +
  no new files unless essential (WR-04), high quality/performance/simple-
  to-deploy (WR-05), and tracked memory of which primitive helped a task
  and by how much (WR-06). `workrule` top-level `nim.json` block, sibling
  of `harness`/`baseline`/`profile`/`workspace`. WR-01 through WR-05 are
  advisory self-check questions only (no automated linter — no cited
  threshold exists for code-structure judgments the way `nim-index` has
  cited tool-count bands); WR-06 has a concrete artifact:
  `.nim/agent-support-log.md` (gitignored markdown log, one row per
  primitive-assisted moment, appended via `nim-skill workrule log`).
  `nim-skill workrule check|log|history`.
- Fixed pre-existing version drift across `package.json`, root `SKILL.md`
  (`sub_skills` was missing `nim-workspace`/`nim-lessons` entirely),
  `.anthropic-skills.yaml`, and `clawhub.toml` — all four now correctly
  list all 12 primitives at 0.6.0 (they had silently stopped being updated
  when `nim-workspace`/`nim-lessons` shipped at 0.5.0).
- `schema/workrule-config.json`. 249 tests pass (was 173 → +76 across
  0.5.0's unreleased workspace/lessons work + this release's 7 new tests),
  `tsc --noEmit` clean.

## [0.5.0] — 2026-07-18 · `nim-workspace` + `nim-lessons`

### Added
- **`nim-workspace`** — hook-native existence + identity + subject-matter +
  staleness gate for a proposed Write/Edit (`workspace` top-level
  `nim.json` block). Deterministic glob/grep/regex/mtime checks only, no
  LLM call, no network. Runs OUTSIDE `runHarnessed()` — gates a raw tool
  call before a skill even runs. `nim-skill workspace check|audit|hook`;
  dual hook adapters emit ready-to-paste Claude Code / Kiro CLI decision
  JSON from a `PreToolUse` payload on stdin. Advisory (`mode:'warn'`) by
  default; only an explicit `mode:'strict'` opt-in ever hard-blocks.
- **`nim-lessons`** — auto-captured, queryable error/lesson log (`ctx.lessons`
  runtime helper, nested under `harness`, plus a standalone
  `nim-skill lessons capture|check|list` CLI path for raw tool calls that
  never go through `runHarnessed()`). Answers "has a similarly-shaped
  action previously failed, for a reason that generalizes beyond this
  one output's content?" — deterministic shape-match (glob + literal
  equality), not semantic search. `TraceRecord.lessonsMatch` (additive,
  optional).
- Dual hook-adapter layer (`src/hook-adapters/`) shared by both primitives.

## [0.4.0] — 2026-07-16 · `nim-baseline` + `nim-index` + `nim-profile`

### Added
- **`nim-baseline`** — memory-file scaffold + lint + audit (`baseline` top-level `nim.json`
  block, sibling of `harness`). Six rules (`BL-LEN`, `BL-BUDGET`, `BL-DERIVABLE`,
  `BL-LINTABLE`, `BL-TASKSPECIFIC`, `BL-PROGRESSIVE`/`BL-EMPTYFOLDER`), advisory by default;
  only `BL-LEN` can hard-block. `nim-skill baseline lint|scaffold|audit`. Composes with the
  existing enforcer `command` strategy to make a bloated memory file CI-blocking with zero
  new runtime surface.
- **`nim-index`** — tool/skill disclosure-tax meter (`index` top-level `nim.json` block).
  Reuses `estimateTokensOf` (no new estimator); reports a cited accuracy-risk band
  (low-risk/watch/elevated-risk/high-risk) from a lookup table, not a fitted curve; flags
  cache-fragile (volatile) tool descriptions. `nim-skill index measure|trim` — `trim` never
  writes without explicit `--write`. `TraceRecord.disclosure` (additive, optional).
- **`nim-profile`** — model-tier detection + per-tier harness config resolution (`profile`
  top-level `nim.json` block). Three built-in tiers (`frontier` no-op,
  `open-weight-verified` +1 `maxHeals`, `open-weight-untested` tightens
  `enforcer.mode`/`guard.injection`/`circuitBreaker.failN`) — absolute never-loosen
  invariant. `applyProfile()` composes *around* `runHarnessed()`, never adds a 6th pipeline
  step. `nim-skill profile detect|show` (inspection-only). `TraceRecord.profileTier`
  (additive, optional).
- `schema/baseline-config.json`, `schema/index-config.json`, `schema/profile-config.json`.
- Grounded in tianpan.co (2026-02-14 + 2026-05-13) and Tessl.io (2026-06-18); full PRD in
  `docs/prd/12-final-prd-v04.md` (supersedes `06`/`10`/`11`, which remain as historical
  record). 173 tests pass (was 121 → +52), `tsc --noEmit` clean.

## [Unreleased] — v0.4 PRD package (docs-only, awaiting approval) — superseded by 0.4.0 above

- **2026-07-16** — Full PRD package for Phase P4: three new primitives —
  `nim-baseline` (memory-file scaffold + lint against the "would removing
  this line cause a mistake" test, mandatory progressive-disclosure
  structure), `nim-index` (MCP/skill tool-disclosure token-tax meter +
  cited accuracy-risk bands + selective-disclosure trim), `nim-profile`
  (declared/heuristic model-tier detection + per-tier `HarnessConfig`
  tightening, never-loosen invariant). Grounded in dated external research
  (tianpan.co 2026-02-14 + 2026-05-13; Tessl.io 2026-06-18) and Gstack
  (Garry Tan) 15-frame review scoring the rolled-up project at 44/45 (up
  from 41/45), pre-mortem weighted ≈3.8/15 (below the 6/15 ship-it
  threshold). **No runtime code shipped yet** — docs-only in
  `docs/prd/05-gstack-v04-baseline-consistency.md` through
  `docs/prd/11-pre-mortem-v04.md`, same approval gate as the original
  `00-master-prd.md`. See `docs/prd/06-master-prd-v04.md` for the full
  problem statement and `docs/prd/10-tasks-and-roadmap-v04.md` for the
  20-task, ~64h execution plan (P4-01 through P4-20).

## [0.3.0] — 2026-07-14 · `nim-cache` (provider-agnostic context caching)

### Added
- **`nim-cache`** — 5th token-efficiency layer (`harness.cache`). Cache-aware prompt
  assembly (stable content first as a reusable prefix, variable input last) + per-provider
  cache directives + a cache-ROI meter that proves tokens/dollars saved.
  - `ctx.cache.assemble(static, dynamic)` — prefix-first ordering, min-token floor gate,
    explicit markers where supported (Lever 2); `strategy:'prefix'` (default) is safe everywhere.
  - `ctx.cache.record(usage)` — folds the provider's cache-hit fields into `trace.cache`.
  - Provider adapters (one file, ~3 real code paths): Anthropic (+ MiniMax), Qwen, Gemini,
    implicit (OpenAI/GLM/DeepSeek); `provider:'auto'` detects from base-url/model; unknown
    fields degrade to 0-saved (`known:false`) instead of crashing.
  - **Break-even honesty**: `breakEvenOk=false` warns when reads/write < ~2; prices are
    estimates, user-overridable via `cache.prices`.
- `nim-skill monitor --cache` — hit-rate, tokens/dollars saved, break-even warnings.
- `schema/harness-config.json` + `examples/nim.cache.json` cover the full config surface.

## [0.2.1] — 2026-07-14 · isolation + memory + compact feedback

### Added
- **U2 execution isolation** (`harness.execution.isolate`) — run `execute` + heal retries
  against a cloned ctx so intermediate/retry state never leaks to the caller.
- **U4 `nim-memory-lite`** (`harness.memory`) — content-hash verify-result cache (skip
  re-verifying an unchanged output) + episodic priors; local JSONL, TTL'd, zero-network.
- **U5a compact heal-feedback** (`enforcer.healFeedback:'minimal'`) — structured
  `{rejected:[{strategy,reason}]}` instead of a prose dump.
- **U5b terminal-only serialization** (`toTerminal`) — TOON/TRON for one-shot terminal
  payloads only, enforced by `assertTerminal()` (JSON stays default mid-loop).

## [0.2.0] — 2026-07-13 · the "see" verb + token-ROI

### Added
- **U1 `nim-context`** (`harness.context`) — per-run token budget (`onExceed:
  warn|compact|block`), progressive disclosure, and `install --lean`.
- **U3 token-ROI accounting** (`monitor.tokenAccounting`) — measures tokens saved by
  guard denial / permanent-error classification / blocked-bad-output, emits
  `netTokens` (net-negative = savings). `nim-skill monitor --savings`.
- Shared approximate token estimator (`src/tokens.ts`).

## [0.1.0] — 2026-07-12 · reliability trio

### Added
- `runHarnessed()` core + `nim-guard`, `nim-error-handler`, `nim-monitor`, `nim-enforcer`.
- Config-gated `nim.json`; disabled layer ⇒ byte-identical bare run (rollback contract).
