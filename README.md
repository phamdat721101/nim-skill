# `nim-skill` — the harness your agent runs inside

> **Status: ✅ P1 implemented (reliability trio).** `runHarnessed()` + `nim-guard` + `nim-error-handler` + `nim-monitor` + `nim-enforcer` are built, tested (70 tests, ~94% coverage), and installable. The PRD package lives in `docs/prd/`. P2 (token-saver + search) and P3 (MCP + publish) are follow-ups.
> **License**: MIT · **Author**: PhamDat / @nxNim9 · **Siblings**: [`goal-skill`](../goal-skill) (missions), HyperMove `/tools` (hosted registry).

## What it is

`nim-skill` is an **open, local-first, host-portable agent-harness toolkit**. Install it and every task your agent does runs inside a harness that makes it **reliable**:

- **catches + classifies + recovers from errors** (retry / backoff / circuit-breaker / fallback / escalate),
- **verifies the output before it ships** — the agent is *held to a check it cannot skip* ("enforce, don't instruct"),
- **monitors every run** (tokens, cost, latency, verify pass/fail, heal count),
- **minimizes tokens** (route cheap steps to cheap models + compress context), and
- **searches semantically** for the resources it needs.

It works in **any agent host** (Claude Code, Cursor, Kiro, Hermes, OpenClaw, or any MCP client), runs **offline by default** (external services are opt-in), and ships **MIT**.

## Why (the thesis)

> *"The agent harness is the architecture — the model is not the bottleneck."*

2026 research is consistent: past a capability threshold, **reliability comes from the harness, not the model**. Multi-agent systems **fail 41-86% of the time without error-recovery discipline** (Taskade, 2026); context degrades as it grows (Chroma "Context Rot"); **13% of marketplace agent-skills contain critical vulnerabilities**; the agentjacking attack class is live. Agents without a harness *leak tokens, loop uncontrolled, ship unverified output, and fail silently.* `nim-skill` is the harness — as drop-in skills, not a framework you rewrite your agent into.

## The 6 primitives (each = an installable skill + a runtime module)

| Skill | Solves | One line |
|---|---|---|
| **`nim-error-handler`** | error handler | Capture + classify (transient/permanent/critical) → retry-backoff / circuit-breaker / fallback / escalate + feed tracebacks back for self-heal |
| **`nim-enforcer`** | enforce blind agent | Verify output (schema/test/lint/math/command) **before it ships**; fail → self-heal loop; **unbypassable** (no `--no-verify`) |
| **`nim-monitor`** | monitor result | Trace every run (tokens/cost/latency/verify/heal) → console/file/Sentry/OTel + local dashboard |
| **`nim-token-saver`** | saving-token workflow | Route trivial steps to cheap models (DeepSeek via LiteLLM, ~100× cheaper) + compress/budget context (Context-Rot remediation) |
| **`nim-search`** | semantic search | Goal-framed neural search (~95% token cut) over a pluggable backend: local pgvector, Exa, or keyword — local-first, Exa optional |
| **`nim-guard`** | safety substrate | Cost cap + rate limit + tool allowlist + agentjacking defense + input validation (Zod) — makes the other five safe |

Plus **`nim-harness`** — the `runHarnessed(skill, input, ctx)` core that composes them into one pipeline.

## Install & use (P1 — implemented)

Same familiar flow as any npm/GitHub skill — no npm-publish needed (a `prepare` hook builds `dist/` on clone):

```bash
# ── Run once, no install ───────────────────────────────────────────────
npx github:phamdat721101/nim-skill --help
npx github:phamdat721101/nim-skill enforce "npm test"

# ── One-line install into your agent host (auto-detects claude/kiro/cursor) ──
npx github:phamdat721101/nim-skill install

# ── Persistent global CLI ──────────────────────────────────────────────
npm install -g github:phamdat721101/nim-skill
nim-skill install                      # or: nim-skill install --host kiro

# ── Drop-in skill folder (no CLI) ──────────────────────────────────────
git clone https://github.com/phamdat721101/nim-skill ~/.claude/skills/nim-skill
```

`install` (zero flags) auto-detects which hosts you have (`~/.claude`, `~/.kiro`, `~/.cursor`) and copies all 4 primitive skills + the umbrella into each. Pick one with `--host`, or a custom path with `--dir`. `add <name...>` installs specific primitives.

Everyday use:

```bash
nim-skill run "npm test" --enforce --monitor   # run a command inside the harness
nim-skill enforce "npm test"                    # unbypassable verify-gate (exit 1 on fail)
nim-skill monitor                               # local trace dashboard
```

Library:

```ts
import { runHarnessed } from 'nim-skill';
const { output, verified, heals, checks, trace } = await runHarnessed(skill, input, { agentId });
```

> `nim-skill mcp` (MCP server) + `nim-token-saver` / `nim-search` are P2/P3 follow-ups.

Host-delegated by default (uses the host's own LLM — **no API keys required**). Keys only for autonomous mode / Exa / DeepSeek / Sentry export.

## Docs (the PRD package)

- [`docs/prd/00-master-prd.md`](./docs/prd/00-master-prd.md) — context, positioning, Gstack summary, phasing, decisions.
- [`docs/prd/01-harness-primitives.md`](./docs/prd/01-harness-primitives.md) — the 6 primitives + harness core: contracts + behaviors.
- [`docs/prd/02-architecture-and-packaging.md`](./docs/prd/02-architecture-and-packaging.md) — `runHarnessed()` runtime, project layout, npm/Skill/MCP/CLI packaging, local-first.
- [`docs/prd/03-gstack-and-pre-mortem.md`](./docs/prd/03-gstack-and-pre-mortem.md) — Gstack 15-frame + pre-mortem.
- [`docs/prd/04-tasks-and-roadmap.md`](./docs/prd/04-tasks-and-roadmap.md) — phased task list + acceptance + ship-gates.

## Relationship to the rest of the stack

- **`goal-skill`** (sibling) — goal orchestration (Worker/Judge/Loop missions). goal-skill's sprints **run inside** nim-skill's harness.
- **HyperMove `/tools`** — the *hosted* skill registry + marketplace + monetization. nim-skill is the **OSS upstream harness runtime** HyperMove productizes; HyperMove can adopt nim-skill as its `runHarnessed()` core.
- **n-payment** — optional settlement rail (only if a harnessed skill is monetized).
- **brain-skill** — optional durable memory for the harness.
