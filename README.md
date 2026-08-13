# `nim-skill` — the harness your agent runs inside

> **Status: ✅ 15 primitives shipped through v1.0 — reliability trio (guard/error-handler/monitor/enforcer) + token-efficiency (context/memory/cache) + workspace hygiene (baseline/index/profile/workspace/lessons/workrule) + output compaction & approval gates (logcompact/propose) + design-tree interrogation (`nim-grill`, v1.0). 📝 `nim-search` (v0.7) is docs-only, awaiting approval (`docs/prd/13-master-prd-v07-nim-search.md`).** All 15 are built, tested (**374 tests**), and installable. Every layer is config-gated + byte-identical when off — see the [primitives table](#the-15-shipped-primitives--1-pending-prd) below for what each one does.
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

## The 15 shipped primitives + 1 pending PRD (each = an installable skill + a runtime module)

| Skill | Status | One line |
|---|---|---|
| **`nim-guard`** | ✅ P1 + v0.8 | Cost cap + rate limit + tool allowlist + agentjacking defense + input validation (Zod) + per-task budget ($/token-credit, default $5) + per-task duration cap (cooperative, default 5 min) — the safety substrate that makes the rest safe |
| **`nim-error-handler`** | ✅ P1 | Capture + classify (transient/permanent/critical) → retry-backoff / circuit-breaker / fallback / escalate + self-heal feedback |
| **`nim-monitor`** | ✅ P1 | Trace every run (duration/status/verify/heal/error-class) → console / file (JSONL) / opt-in Sentry + local dashboard |
| **`nim-enforcer`** | ✅ P1 | Verify output (nonempty/json/schema/math/test/lint/command) **before it ships**; fail → bounded self-heal; **unbypassable** |
| **`nim-context`** | ✅ v0.2 | The "see" verb — per-run token budget (warn/compact/block) + progressive disclosure + lean install. Stops the harness being a context tax |
| **`nim-memory-lite`** | ✅ v0.2 | The "remember" verb — content-hash verify-result cache + episodic priors (local JSONL, TTL); skip re-verifying unchanged work |
| **`nim-cache`** | ✅ v0.3 | Provider-agnostic context caching — cache-aware prompt assembly (prefix-first) + per-provider directives + ROI meter (45–80% input-cost cut, break-even-aware) |
| **`nim-baseline`** | ✅ v0.4 | Lint/scaffold/audit an agent memory file (AGENTS.md/CLAUDE.md-family) against the "would removing this line cause a mistake" test + progressive-disclosure structure |
| **`nim-index`** | ✅ v0.4 | Tool/skill disclosure-tax meter — measures the standing MCP/skill token cost + a cited accuracy-risk band; flags cache-fragile tool descriptions |
| **`nim-profile`** | ✅ v0.4 | Model-tier detection + per-tier harness config resolution — tightens (never loosens) reliability for models with weaker measured instruction-following |
| **`nim-workspace`** | ✅ v0.5 | Hook-native existence + identity + subject-matter + staleness gate for a proposed Write/Edit — deterministic glob/grep/regex/mtime, no LLM call |
| **`nim-lessons`** | ✅ v0.5 | Auto-captured, queryable error/lesson log — "has a similarly-shaped action previously failed?" via deterministic shape-match, not semantic search |
| **`nim-workrule`** | ✅ v0.6 | The 6-rule working checklist an agent self-checks against its own editing behavior (SOLID/no-repeat-mistakes/essential-files/partial-reads/deployability) + `.nim/agent-support-log.md` tracking which primitive helped a task and how much context/cache it saved |
| **`nim-logcompact`** | ✅ v0.9 | Compresses raw subprocess/tool output (stdout/stderr, log tails) before it reaches an agent's context — cap / errors-only (default) / incremental strategies, `escalateOnEmpty` guarantees a real failure never silently vanishes; wired into `nim-skill run --logcompact` and `ctx.logCompact` |
| **`nim-propose`** | ✅ v0.9 | Extends `nim-guard` with a pre-execute deny gate requiring an explicit, approved plan document (`nim-skill propose`/`--approve`) before a task runs, plus an owner-profile learning store that advisory-pre-fills a plan's sections toward patterns an owner has consistently kept — never bypasses the approval pause itself |
| **`nim-grill`** | ✅ v1.0 | Iterative interrogation loop — probes a design tree (x402 payment gateways, XLS-65 vaults, or a custom domain) one branch at a time, then compiles resolved answers into an enforcer-verified PRD; built on `enforce` + `memory` + `logCompact` + `workrule`, zero LLM calls inside the primitive itself. See [Using `nim-grill`](#using-nim-grill--interrogate-a-design-before-you-build-it) below |
| **`nim-search`** | 📝 PRD (v0.7, `docs/prd/13-master-prd-v07-nim-search.md`) | Call-time tool filter — BM25-style lexical scoring over a manifest `nim-index` already reads, detail-level-aware (`name` / `name+description` / `full`), zero network, zero vector DB. `nim-index`'s missing runtime half: it measures the disclosure tax; `nim-search` pays only the slice of it a task needs |

Plus **`nim-harness`** — the `runHarnessed(skill, input, ctx)` core that composes them into one pipeline.

## How it works

```
runHarnessed(skill, input, ctx):
  ① guard.validate(input)      Zod + agentjacking → throws GuardError
  ② guard.checkPolicy(ctx)     cost cap / rate / allowlist → throws GuardError
  ②b context.budget(est)       per-run token budget (see-verb) → warn/compact/block
  ③ errorHandler.run(          classify → retry / backoff / circuit-breaker / fallback / escalate
       skill.execute)          ← your logic (ctx carries cache/context/memory helpers)
  ④ enforcer.verifyOrHeal      block-before-ship + bounded self-heal (memory verify-cache short-circuit)
  ⑤ monitor.capture(trace) → return { output, verified, heals, checks, trace } + token-ROI + cache-ROI
```

Every layer is config-gated in `nim.json`; a disabled layer is a byte-identical no-op (rollback contract). Declare only what you want:

```jsonc
{ "harness": {
    "guard":        { "maxCostUsd": 0.5, "ratePerMin": 30, "allowTools": ["*"], "injection": "strict", "taskBudgetUsd": 5, "maxDurationMs": 300000 },
    "errorHandler": { "retries": 3, "backoff": "exp-jitter", "circuitBreaker": { "failN": 5, "cooldownMs": 60000 } },
    "enforcer":     { "strategies": [{ "kind": "schema", "required": ["id"] }], "maxHeals": 3, "strict": true, "healFeedback": "minimal" },
    "monitor":      { "exporters": ["console", "file"], "tokenAccounting": true },
    "context":      { "maxInputTokens": 8000, "onExceed": "warn" },
    "memory":       { "verifyCache": true, "priors": true },
    "execution":    { "isolate": true },
    "cache":        { "provider": "auto", "strategy": "prefix", "roi": true, "breakEvenReads": 2 } } }
```

## Using `nim-skill` effectively

A few practical rules that make the difference between "installed" and "actually reliable":

**1. Turn on layers incrementally, not all at once.** Start with `guard` + `enforcer` — they're the two that change behavior on day one (input validation/injection defense, and a verify-gate that blocks unverified output). Add `errorHandler` once you've seen what actually fails in practice, then `monitor` to see the trend, then `cache`/`context`/`memory` once token cost is a real line item. Turning on everything at once makes it hard to tell which layer caught what.

**2. Every layer is `false` or omitted by default — the "byte-identical-off" rollback contract is load-bearing, use it.** If a new layer misbehaves, delete its block from `nim.json` (or set it to `false`) and the harness returns to exactly its prior behavior — no partial state, no migration. This is the actual safety net for adopting a new primitive; don't route around it with feature flags of your own.

**3. `guard`'s v0.8 per-task budget/duration cap default the moment the block exists.** If your `nim.json` already has ANY `guard: {...}` block — even just `{ "allowTools": ["*"] }` — it now also gets `taskBudgetUsd: 5` and `maxDurationMs: 300000` (5 min) by default, not only when you set them explicitly. This is intentional (see `docs/prd/14-master-prd-v08-nim-guard-budget.md`), but if you're upgrading an existing project, check whether $5/5-min is actually right for your workload — set explicit values if not, or drop the `guard` block entirely to opt out of every guard-layer default at once.

**4. Prefer `taskBudgetUsd`/`taskBudgetTokens` for cost accountability per run, `maxCostUsd` for a rolling ceiling across an agent's whole session.** They're independent and both fire — a single expensive task can be denied for busting its own $5 budget even while nowhere near a session-wide cumulative cap, and vice versa. Don't try to use one to simulate the other.

**5. `ctx.signal`/`ctx.budget` are cooperative, not preemptive — a skill has to actually check them.** If your `execute()` calls something abort-aware (`fetch`, most SDK clients), just pass `{ signal: ctx.signal }` through and you get the duration cap for free. If it's a tight synchronous loop or a blocking call (like `spawnSync`, which the built-in `nim-skill run` CLI command uses — a documented, known exception to this), you need to poll `ctx.signal.aborted` or `ctx.budget.timedOut()` periodically yourself, or the cap will report a timeout in the trace without actually stopping your code.

**6. Use `nim-skill enforce "<verify-command>"` as an actual pre-commit/pre-ship gate, not just a demo.** It's designed to be unbypassable — wire it into a git hook or CI step so "did this pass verification" is answered by the harness, not by memory.

**7. Check `nim-skill monitor --savings` / `--cache` / `--budget` before tuning, not after.** Each view answers a different question — token-ROI, cache break-even, and per-task budget consumption respectively — and all three read from the same local JSONL trace file, so there's no reason to guess at a config change's effect when the last N runs already have the answer.

## Using `nim-grill` — interrogate a design before you build it

`nim-grill` turns "let's just start coding" into a structured Q&A: it walks a design tree branch-by-branch, records your answer to each question (with an agent-recommended answer alongside it), and won't let you compile a PRD until enough decisions are actually resolved.

- **① Start a session** — picks a built-in question bank:
  ```bash
  nim-skill grill start --domain x402      # 12 Qs: HTTP 402 headers, ERC-3009/Permit2, facilitator trust
  nim-skill grill start --domain xls65     # 10 Qs: MPT shares, VaultCreate/Set/Deposit, lending decoupling
  nim-skill grill start --domain custom    # 3 Qs, extensible — generic security/architecture fallback
  ```
- **② Work the questions** — `nim-skill grill next` returns up to 5 unresolved questions at a time, each with a recommended answer so you're reviewing a proposal, not staring at a blank page.
- **③ Answer one at a time**:
  ```bash
  nim-skill grill answer --id x402-001 --answer "Base64-encoded JSON, Zod-validated server-side, reject with 400 on schema failure"
  ```
- **④ Track progress** — `nim-skill grill status` reports `resolved / total` and whether you've crossed the `minResolved` threshold (default 10).
- **⑤ Compile the PRD** — once complete, `nim-skill grill compile --workrule-log` runs inside the harness: `nim-enforcer` verifies the PRD schema (`sessionId`, `resolvedDecisions`, `acceptanceCriteria`) before anything is written, then writes `.nim/grill/<id>-prd.md` and appends a WR-06 tracked-memory entry.

Everything is local and prompt-only — **zero LLM calls inside the primitive**; the host agent is the one running the generated question prompts. State lives in `.nim/grill/<id>.jsonl` (append-only, replayable), so a session survives across CLI invocations.

Opt in via `nim.json` (same byte-identical-off contract as every other layer):

```jsonc
{ "harness": { "grill": { "domain": "x402", "questionsPerBatch": 5, "minResolved": 10 } } }
```

Want a custom domain's questions? Drop a JSON file at `.nim/grill/questions/<domain>.json` — it merges with the built-in bank. Full reference: [`skills/nim-grill/SKILL.md`](./skills/nim-grill/SKILL.md).

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

`install` (zero flags) auto-detects which hosts you have (`~/.claude`, `~/.kiro`, `~/.cursor`) and copies all 15 primitive skills + the umbrella into each. Pick one with `--host`, or a custom path with `--dir`. `add <name...>` installs specific primitives.

Everyday use:

```bash
nim-skill run "npm test" --enforce --monitor   # run a command inside the harness
nim-skill run "npm test" --logcompact           # compact stdout/stderr before verification/output
nim-skill enforce "npm test"                    # unbypassable verify-gate (exit 1 on fail)
nim-skill propose "add a database migration"    # scaffold a plan doc (the pause half of nim-propose)
nim-skill propose --approve <hash>              # approve it — required before a guard.propose.require run proceeds
nim-skill grill start --domain x402             # start an interrogation session (x402 | xls65 | custom)
nim-skill grill next                            # next batch of unresolved questions + recommendations
nim-skill grill compile --workrule-log          # ≥10 resolved → enforcer-verified PRD + WR-06 log
nim-skill monitor                               # local trace dashboard
nim-skill monitor --savings                     # U3 net-token savings view
nim-skill monitor --cache                       # v0.3 cache-ROI + break-even view
nim-skill monitor --budget                      # v0.8 per-task budget consumption + timeout view
nim-skill monitor --logcompact                  # v0.9 output-compaction reduction view
nim-skill monitor --propose                     # v0.9 proposal-gate approval/denial view
```

Library:

```ts
import { runHarnessed } from 'nim-skill';
const { output, verified, heals, checks, trace } = await runHarnessed(skill, input, { agentId });
```

> `nim-skill mcp` (MCP server) + `nim-token-saver` are still-unspecced follow-ups. `nim-search` has a docs-only PRD (`docs/prd/13-master-prd-v07-nim-search.md`) awaiting approval — not yet built.

Host-delegated by default (uses the host's own LLM — **no API keys required**). Keys only for autonomous mode / Exa / DeepSeek / Sentry export.

## Orientation

- [`AGENTS.md`](./AGENTS.md) — single-page architecture orientation (read this first if you're an agent working on the repo).
- [`SKILL.md`](./SKILL.md) — the portable Agent-Skill manifest; per-primitive manifests live in [`skills/`](./skills).
- [`schema/`](./schema) — JSON schemas for the `nim.json` harness config, trace record, verify result, and classified error.
- [`TRACKER.md`](./TRACKER.md) — workspace tracker: indexes every project in `/Users/phamdat/pqd` (goal-skill, nim-blog, phamdat721101) with status + first-$ relevance. nim-skill is the hub.
- Public API: `import { runHarnessed, createGuard, recover, createMonitor, verifyOrHeal } from 'nim-skill'`.

> The design/PRD package (Gstack analysis, pre-mortem, phased roadmap) is kept as a local-only reference and is not tracked in this repo.

## Relationship to the rest of the stack

- **`goal-skill`** (sibling) — goal orchestration (Worker/Judge/Loop missions). goal-skill's sprints **run inside** nim-skill's harness.
- **HyperMove `/tools`** — the *hosted* skill registry + marketplace + monetization. nim-skill is the **OSS upstream harness runtime** HyperMove productizes; HyperMove can adopt nim-skill as its `runHarnessed()` core.
- **n-payment** — optional settlement rail (only if a harnessed skill is monetized).
- **brain-skill** — optional durable memory for the harness.
