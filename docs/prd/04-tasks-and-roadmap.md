# 04 — Tasks + roadmap

> Phased to de-risk scope sprawl (pre-mortem T1). Seed = port HyperMove's shipped `harness/` + `observability/` (pre-mortem T4). Execution begins on approval of `00-master-prd.md`. TypeScript; MIT.

## Phase 1 — Reliability trio (the core value)

| ID | Task | Est | Acceptance |
|---|---|---|---|
| P1-01 | Scaffold repo from goal-skill template (package.json bin, tsconfig, vitest, LICENSE MIT, README, AGENTS.md, .anthropic-skills.yaml, clawhub.toml) | 3h | `npx github:…/nim-skill --help` runs; `dist/` builds via `prepare` |
| P1-02 | Port `nim-harness` core `runHarnessed()` from HyperMove `lib/harness/{runtime,types}` — config-gated, no-op-passthrough | 6h | Bare command runs unchanged with harness off; pipeline order guard→errorHandler→monitor→execute→enforce |
| P1-03 | `nim-guard` — Zod input validation + agentjacking reject + cost cap + rate + allowlist; throws `GuardError` | 6h | Breach throws before execute; injection input rejected; unit tests |
| P1-04 | `nim-error-handler` — capture + classify (transient/permanent/critical) + retry-backoff + circuit-breaker + fallback + escalate + self-heal feedback | 8h | Each class routed correctly; transient retries w/ backoff; critical escalates (no silent swallow); trace emitted |
| P1-05 | `nim-monitor` — port `observability/wrap` + trace schema + console/file exporters + `monitor dashboard` | 6h | Every run traced (tokens/cost/latency/verify/heal); console+file exporters; zero external calls by default |
| P1-06 | `nim-enforcer` — port `output-enforcer`; strategies schema/test/lint/math/command + verifyOrHeal(maxHeals) + strict/warn/off + unbypassable | 8h | Bad output blocked + self-heals; `strict` blocks, `warn` passes-with-log; cannot be skipped by the agent |
| P1-07 | CLI `nim-skill run "<cmd>" --harness [--enforce --monitor]` + `nim-skill add <primitive>` | 4h | One-command run inside harness; `add` copies SKILL.md to host skills dir |
| P1-08 | SKILL.md per P1 primitive + top-level SKILL.md (sub_skills) | 3h | Installs into `~/.claude/skills/`; readable by SKILL.md hosts |
| P1-09 | Dogfood e2e test + example (harness a real task; block a bad output; recover a transient error) | 5h | E2E green: ≥1 blocked-bad-output + ≥1 error-class recovery demonstrably captured in the trace |

**P1 total ≈ 49h (~1.5 weeks solo).** **P1 ship-gate**: dogfood run proves guard-blocks + error-recovery + output-enforcement + a monitor trace; installs into Claude Code + one other host.

## Phase 2 — Efficiency (token-saver + search)

| ID | Task | Est | Acceptance |
|---|---|---|---|
| P2-01 | `nim-token-saver` inference-router (LiteLLM/DeepSeek cheap tier + difficulty heuristic + host fallback) | 8h | Trivial steps route to cheap model; cost cap enforced via guard; falls back to host model if no key |
| P2-02 | `nim-token-saver` context-compressor + per-step budget (Context-Rot remediation) | 6h | ≥30% token reduction on a representative task; reports tokensSaved to monitor |
| P2-03 | `nim-search` local backend (pgvector/embeddings) + goal-framing intervention | 8h | Semantic search over a local corpus, no external key; goal-framed query |
| P2-04 | `nim-search` Exa backend (opt-in) — deep-lite + highlights + summary + output_schema; verified via enforcer | 5h | With Exa key → schema-valid results; without → local/keyword fallback |
| P2-05 | SKILL.md for token-saver + search + examples | 3h | Installs + documented |

**P2 total ≈ 30h.** **P2 ship-gate**: measured ≥30% token cut + semantic search working local-first (Exa opt-in).

## Phase 3 — Packaging + publish

| ID | Task | Est | Acceptance |
|---|---|---|---|
| P3-01 | MCP server `nim-skill mcp` — expose all primitives as MCP tools | 6h | Cursor/Kiro/MCP client can call the primitives |
| P3-02 | Companion-publish: clawhub + anthropic-skills-registry + npm | 3h | Discoverable in all three (mirrors goal-skill `companion_publish`) |
| P3-03 | Docs site / AGENTS.md polish + full examples + schema JSONs | 5h | AGENTS.md orientation complete; schemas published |
| P3-04 | Full test coverage + CI | 6h | ≥80% coverage; CI green |

**P3 total ≈ 20h.** **P3 ship-gate**: installable + discoverable across ≥3 hosts + published to the 3 registries.

## Roadmap summary

- **P1 (≈49h)** → the reliability harness works and installs. *Ship this first; it's the whole thesis.*
- **P2 (≈30h)** → token + search efficiency layers on.
- **P3 (≈20h)** → distribution + publish.
- **Total ≈ 99h** across ~3 phases; ~50% of P1 is porting proven HyperMove code, not net-new.

## Day-90 KPIs (post-P1)
- ≥100 npm installs/wk; ≥3 external repos/agents running a harnessed skill.
- Dogfood proof: ≥1 blocked-bad-output + ≥1 error-class recovery + ≥30% token cut (P2).
- ≥1 non-Claude host verified; HyperMove `/tools` adopts `runHarnessed()` OR ≥1 external citation.

## Cross-links
- Seed code: HyperMove `hypermove-app/src/lib/harness/*` + `observability/*` (port, don't rewrite).
- Packaging template: `../goal-skill` (verbatim scaffolding).
- Prior research: bd-team `research/hypermove/2026-07-11-tools-page-skill-harness-prds/` (harness catalog + architecture).
