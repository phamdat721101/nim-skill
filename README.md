# `nim-skill` — the harness your agent runs inside

> **Status: ✅ P1 implemented (reliability trio).** `runHarnessed()` + `nim-guard` + `nim-error-handler` + `nim-monitor` + `nim-enforcer` are built, tested (**85 tests, ~94% coverage**), and installable. P2 (`nim-token-saver` + `nim-search`) and P3 (MCP + registry publish) are follow-ups.
> **License**: MIT · **Author**: PhamDat / @nxNim9 · **Siblings**: `goal-skill` (missions), HyperMove `/tools` (hosted registry).

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

| Skill | Status | One line |
|---|---|---|
| **`nim-guard`** | ✅ P1 | Cost cap + rate limit + tool allowlist + agentjacking defense + input validation (Zod) — the safety substrate that makes the rest safe |
| **`nim-error-handler`** | ✅ P1 | Capture + classify (transient/permanent/critical) → retry-backoff / circuit-breaker / fallback / escalate + self-heal feedback |
| **`nim-monitor`** | ✅ P1 | Trace every run (duration/status/verify/heal/error-class) → console / file (JSONL) / opt-in Sentry + local dashboard |
| **`nim-enforcer`** | ✅ P1 | Verify output (nonempty/json/schema/math/test/lint/command) **before it ships**; fail → bounded self-heal; **unbypassable** |
| **`nim-token-saver`** | 🔜 P2 | Route trivial steps to cheap models (DeepSeek via LiteLLM) + compress/budget context (Context-Rot remediation) |
| **`nim-search`** | 🔜 P2 | Goal-framed neural search over a pluggable backend: local pgvector, Exa, or keyword — local-first, Exa optional |

Plus **`nim-harness`** — the `runHarnessed(skill, input, ctx)` core that composes them into one pipeline.

## How it works

```
runHarnessed(skill, input, ctx):
  ① guard.validate(input)      Zod + agentjacking → throws GuardError
  ② guard.checkPolicy(ctx)     cost cap / rate / allowlist → throws GuardError
  ③ errorHandler.run(          classify → retry / backoff / circuit-breaker / fallback / escalate
       skill.execute)          ← your logic (the only part you write)
  ④ enforcer.verifyOrHeal      block-before-ship + bounded self-heal (unbypassable)
  ⑤ monitor.capture(trace) → return { output, verified, heals, checks, trace }
```

Every layer is config-gated in `nim.json`; a disabled layer is a byte-identical no-op (rollback contract). Declare only what you want:

```jsonc
{ "harness": {
    "guard":        { "maxCostUsd": 0.5, "ratePerMin": 30, "allowTools": ["*"], "injection": "strict" },
    "errorHandler": { "retries": 3, "backoff": "exp-jitter", "circuitBreaker": { "failN": 5, "cooldownMs": 60000 } },
    "enforcer":     { "strategies": [{ "kind": "schema", "required": ["id"] }], "maxHeals": 3, "strict": true },
    "monitor":      { "exporters": ["console", "file"] } } }
```

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

## Orientation

- [`AGENTS.md`](./AGENTS.md) — single-page architecture orientation (read this first if you're an agent working on the repo).
- [`SKILL.md`](./SKILL.md) — the portable Agent-Skill manifest; per-primitive manifests live in [`skills/`](./skills).
- [`schema/`](./schema) — JSON schemas for the `nim.json` harness config, trace record, verify result, and classified error.
- Public API: `import { runHarnessed, createGuard, recover, createMonitor, verifyOrHeal } from 'nim-skill'`.

> The design/PRD package (Gstack analysis, pre-mortem, phased roadmap) is kept as a local-only reference and is not tracked in this repo.

## Relationship to the rest of the stack

- **`goal-skill`** (sibling) — goal orchestration (Worker/Judge/Loop missions). goal-skill's sprints **run inside** nim-skill's harness.
- **HyperMove `/tools`** — the *hosted* skill registry + marketplace + monetization. nim-skill is the **OSS upstream harness runtime** HyperMove productizes; HyperMove can adopt nim-skill as its `runHarnessed()` core.
- **n-payment** — optional settlement rail (only if a harnessed skill is monetized).
- **brain-skill** — optional durable memory for the harness.
