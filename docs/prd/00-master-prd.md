# 00 — Master PRD — `nim-skill`

> **Status: DRAFT for approval.** Docs-only; no runtime code until this PRD is approved.
> **Date**: 2026-07-12 · **Owner**: Pham · **Location**: `/Users/phamdat/pqd/nim-skill`

---

## 1. Problem

Agents are now capable but **unreliable**. Without a harness they leak tokens, loop, ship unverified output, and fail silently. 2026 evidence:
- **"The agent harness is the architecture — the model is not the bottleneck"** (Medium/Augment/arXiv 2605.18747, 2605.26112) — past a capability threshold, harness > model for reliability.
- **Multi-agent systems fail 41-86% of the time without error-recovery discipline** (Taskade 2026): classify (transient/permanent/critical) → retry-backoff / circuit-breaker / fallback / escalate.
- **Context Rot** (Chroma): quality degrades as input tokens grow → context budgeting matters.
- **13% of marketplace agent-skills contain critical vulnerabilities** + the **agentjacking** attack class is live → unguarded skills are dangerous.

Existing tools solve *slices*: Guardrails-AI (output validation), Sentry (monitoring), WorkOS (enforcement/governance), LiteLLM (routing), Exa/Mixedbread (search). **None ship all the reliability levers as drop-in, host-portable, local-first, MIT skills.**

## 2. What `nim-skill` is (one paragraph)

An **open, local-first, host-portable agent-harness toolkit**: a `runHarnessed()` runtime + **6 composable harness primitives** (error-handler, enforcer, monitor, token-saver, search, guard) each installable as an Anthropic Skill / npm module / MCP tool / CLI, that wrap an agent's work so it is error-recovered, output-verified-before-ship, monitored, token-minimized, and semantically-searched — in **any** agent host, **offline by default**, MIT.

## 3. Positioning (the "only-X")

- **Portable, not a framework**: you don't rewrite your agent into nim-skill; you `npx nim-skill add …` into the host you already use (Claude Code, Cursor, Kiro, Hermes, OpenClaw, MCP).
- **Local-first, not a SaaS**: runs offline; Exa/DeepSeek/Sentry are opt-in, not required.
- **Bundled, not a slice**: all 6 reliability levers behind one runtime + one install, vs stitching Guardrails + Sentry + WorkOS + LiteLLM + Exa yourself.
- **OSS upstream of a hosted product**: nim-skill is the open core; **HyperMove `/tools` is the hosted registry/marketplace that can adopt nim-skill as its `runHarnessed()` runtime.** Clean open-core/hosted split (no cannibalization — different jobs).

## 4. Scope (v0.x)

**In scope (this PRD):** `nim-harness` core + the 6 primitives + packaging (npm + SKILL.md-per-primitive + MCP + CLI) + local-first defaults + docs.

**Out of scope (v0.x):** a hosted marketplace (that's HyperMove `/tools`); a payment rail (n-payment, only if a harnessed skill is monetized); a new model; a new agent host.

## 5. Design principles

1. **Author writes only `execute()`** — the harness supplies guard/policy/monitor/enforce. (Ported from HyperMove's shipped `lib/harness/runtime.ts`.)
2. **Enforce, don't instruct** — verification runs *in the harness*, unbypassable by the agent.
3. **Local-first** — zero external calls on the default path; external services are declared opt-ins.
4. **Composable** — each primitive works standalone AND inside `runHarnessed()`.
5. **Portable skill format** — SKILL.md (Markdown + YAML frontmatter) so it installs into 20+ hosts; differentiate on the *runtime*, not the format.
6. **Reuse the seed** — port HyperMove's already-shipped `harness/{runtime,output-enforcer}` + `observability/{capture,wrap}` as the starting code (de-risks + speeds).

## 6. Phasing (de-risk scope sprawl — pre-mortem T1)

| Phase | Ships | Why first |
|---|---|---|
| **P1 — Reliability trio** | `nim-harness` core + `nim-error-handler` + `nim-enforcer` + `nim-monitor` + `nim-guard` | The core value: catch errors, verify output, watch it, keep it safe. Directly the 41-86%-failure fix. |
| **P2 — Efficiency** | `nim-token-saver` + `nim-search` | Cost + research levers; depend on optional external APIs (DeepSeek/Exa) so they layer on after the reliability core is solid. |
| **P3 — Packaging + publish** | CLI polish + MCP server + SKILL.md per primitive + companion-publish (clawhub + anthropic-skills-registry + npm) + examples/tests | Distribution once the substance is proven. |

## 7. Gstack summary (full scoring in `03`)

Aggregate **~41/45**. Maxed: **F3** (only portable+local-first+MIT bundle of all 6 levers), **F9** (structural forcing — 41-86% failure + 13%-vuln + agentjacking + Context Rot), **F11** (composes with goal-skill / HyperMove / n-payment / brain-skill), **F12** (harness-is-the-bottleneck thesis), **F15** (MIT, no lock-in). Weaker: **F1** cash 2/3 (OSS — indirect monetization via HyperMove hosting / nim-cloud managed harness / router markup), **F4** 2/3 (pre-adoption), **F2** 2/3.

## 8. Monetization (honest — indirect)

nim-skill itself is free OSS (drives adoption + credibility). Revenue is **downstream/optional**:
- **HyperMove `/tools`** hosts + monetizes harnessed skills using nim-skill as runtime (payout-rail lighthouse #2).
- **`nim-cloud`** (future) — managed hosted harness + dashboard for teams that don't want to self-host ($X/mo).
- **Router/search markup** — optional managed DeepSeek/Exa keys with a small margin (like the XRPL-skill PRD's $5/mo RLUSD tier pattern).
- **Grants** — Anthropic Skills / OSS agent-reliability grants; goal-skill already targets clawhub + anthropic-skills-registry.

## 9. KPIs (Day-90 after P1 ship)
- ≥100 npm installs/wk; ≥3 external agents/repos running a harnessed skill.
- Measured: ≥1 real error-class recovery + ≥1 blocked-bad-output (enforcer) in a dogfood run; ≥30% token reduction on a representative task (token-saver, P2).
- ≥1 host beyond Claude Code verified (Cursor/Kiro/MCP).
- HyperMove `/tools` adopts nim-skill runtime OR ≥1 external project cites it.

## 10. Decisions to confirm before build
1. **Name/scope** — `nim-skill` as the open harness toolkit (vs folding into HyperMove)? (Recommend: standalone OSS — clean open-core story.)
2. **Phasing** — P1 reliability trio (error+enforce+monitor+guard) first, P2 token+search, P3 publish? (Recommend: yes.)
3. **Seed** — port HyperMove's shipped `harness/` + `observability/` as the starting code (fastest, proven)? (Recommend: yes.)
4. **Language** — TypeScript (matches goal-skill + HyperMove + npm/Skill ecosystem)? (Recommend: yes.)
5. **License** — MIT? (Recommend: yes — matches goal-skill.)

**On approval → execute P1 per `04-tasks-and-roadmap.md`. Until then this is a plan.**
