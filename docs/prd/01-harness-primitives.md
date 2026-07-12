# 01 — Harness primitives + core spec

> Each primitive is (a) a standalone skill (SKILL.md + module) AND (b) a step in the `runHarnessed()` pipeline. Grounded in shipped HyperMove code + 2026 research.

---

## `nim-harness` — the core runtime

```ts
// The one function every harnessed run passes through (ported from HyperMove lib/harness/runtime.ts)
runHarnessed(skill, input, ctx):
  ① guard.validate(input)              // nim-guard — agentjacking + Zod
  ② guard.checkPolicy(ctx)             // nim-guard — cost cap / rate / allowlist  (throws on breach)
  ③ monitor.wrap( () =>                // nim-monitor — trace + capture
       errorHandler.run( () =>         // nim-error-handler — classify + retry/backoff/circuit-breaker/fallback
         skill.execute(input, ctx) ))
  ④ output = enforcer.verifyOrHeal(output)   // nim-enforcer — verify before ship; self-heal loop (bounded)
  ⑤ return output   (+ monitor.flush trace)
```
- Config-driven: `skill.manifest.harness` declares which steps apply (`guard`, `policy`, `errorHandler`, `enforcer`, plus opt-in `search`/`docExtract`).
- **No-op passthrough** when a step is disabled → byte-identical to running the bare skill (rollback contract).
- Works standalone (`runHarnessed`) or as a wrapper CLI (`nim-skill run "<cmd>" --harness`).

---

## 1. `nim-error-handler` — error handler

**Behavior** (Taskade 2026 error-recovery discipline):
- **Capture** every error with a structured trace (message, stack, tool, input hash, context) — ported from HyperMove `observability/capture.ts`.
- **Classify**: `transient` (network/rate/timeout) · `permanent` (bad input/logic) · `critical` (auth/safety/data-loss).
- **Recover by class**:
  - transient → **retry with exponential backoff** (configurable, jittered).
  - repeated transient → **circuit-breaker** (open after N fails, half-open probe).
  - permanent → **graceful fallback** (default value / cheaper path / cached result) OR feed the error back to the agent for **self-heal**.
  - critical → **clean escalate** (halt + structured human handoff; never silent-swallow).
- **Self-heal feedback**: passes the structured failure back as `input._feedback` and re-executes (bounded; shared budget with the enforcer).

**Contract**: `withErrorHandling(fn, policy) → Result<T, ClassifiedError>`; never throws unclassified; always emits a trace to `nim-monitor`.

---

## 2. `nim-enforcer` — "enforce blind agent" (output-enforcer)

**Behavior** (WorkOS "enforce, don't instruct" + HyperMove shipped `output-enforcer.ts`):
- Runs a **verify-gate on the agent's output BEFORE it ships**. Strategies (declared per skill): `schema` (Zod/JSON-Schema), `test` (run a suite), `lint` (static analysis), `math-check` (domain invariants, e.g. line-items sum to total), `command` (arbitrary verify command, like a pre-commit hook).
- **On fail → do NOT ship.** Feed the structured failure back → re-execute (bounded `maxHeals`, default 3) — recursive self-heal.
- **Unbypassable**: the check runs inside the harness runtime, not as an optional hook the agent can skip. Directly fixes the "agent ships broken output via `--no-verify`" failure mode. This is the "blind agent" idea — the agent is held to the check regardless of whether it "chooses" to run it.
- **Explained-diff mode** (opt-in): surface a diff + one-question quiz to a human before shipping high-risk output.
- **Tunable strictness** (pre-mortem T3): `strict | warn | off` per strategy to avoid false-positive blocking.

**Contract**: `verifyOrHeal(output, strategies, {reExecute, maxHeals}) → VerifiedOutput | EnforcerError`.

---

## 3. `nim-monitor` — monitor result (observability)

**Behavior** (HyperMove shipped `observability/wrap.ts` + Sentry MCP monitoring pattern):
- Wrap any execution → trace `{skill, traceId, startedAt, durationMs, tokensIn/Out, costEstimate, verifyPassed, healCount, errorClass, status}`.
- **Exporters** (pluggable): `console` (default, local) · `file` (JSONL) · `sentry` (opt-in, `Sentry.wrapMcpServer`-style) · `otel`.
- **Local dashboard** (opt-in): `nim-skill monitor dashboard` — recent runs, error-class breakdown, token/cost trend, verify pass-rate, heal-rate.
- **Result-quality metrics**: verify pass-rate, self-heal count, escalation count — the numbers that prove the harness is working.

**Contract**: `monitor.wrap(fn, meta) → T` (transparent) + `monitor.flush()`; zero external calls unless an exporter is configured.

---

## 4. `nim-token-saver` — saving-token workflow

**Two levers** (LiteLLM/DeepSeek + Chroma Context-Rot):
- **Inference router**: classify step difficulty → route trivial steps to a **cheap model** (DeepSeek V4 via LiteLLM, ~100× cheaper) and hard steps to frontier. Config: model tiers + a difficulty heuristic + a hard per-run cost cap (via `nim-guard`).
- **Context compressor / budget**: trim + dedupe + summarize context; allocate a **token budget per step** (Context-Rot remediation — quality degrades as context grows). Strip stale/irrelevant context before each call.
- **Reports** `tokensSaved` + `costSaved` to `nim-monitor`.

**Local-first**: the compressor works with no external key; the router's cheap-model backend (DeepSeek/LiteLLM) is opt-in (falls back to the host model if unconfigured).

**Contract**: `route(step) → modelChoice`; `compress(context, budget) → trimmedContext`.

---

## 5. `nim-search` — semantic search solution

**Behavior** (Mixedbread "Closing the Oracle Gap" + Exa, confirmed $0.007/query + 20k free/mo):
- **Goal-framing prompt intervention**: force the query into "one sentence describing what you want to find" → ~95% token cut vs dumping raw context.
- **Pluggable backend** (declared, local-first default):
  - `local` — pgvector/embeddings over a local corpus (no external key).
  - `exa` — neural web search (opt-in key); `deep-lite` + `highlights` + `summary` + `output_schema`.
  - `keyword` — fallback.
- **Token-efficient results**: highlights/summaries, not full pages.

**Contract**: `search(query, {backend, since, category, limit}) → Result[]` (schema-verified via `nim-enforcer`).

---

## 6. `nim-guard` — safety substrate

**Behavior** (HyperMove `sentinel` + `security/guard`; addresses 13%-vuln-skills + agentjacking):
- **Input validation** (Zod) + **agentjacking defense** (reject instruction-injection in tool inputs/outputs).
- **Policy**: cost cap (per-run + per-day), rate limit, tool/domain allowlist.
- **Throws on breach** before the skill executes — the gate that makes a buggy/malicious skill safe (can't exceed cost, can't leak past the guard, can't ship unverified — steps ①②④ of the runtime).

**Contract**: `validate(input, schema, ctx)` + `checkPolicy(ctx, policy)` — both throw `GuardError` on breach.

---

## Standalone vs harnessed

Every primitive works two ways:
```bash
nim-skill enforce "npm test"            # standalone: just the enforcer
nim-skill run "my-agent-task" --harness # full pipeline: guard→errorHandler→monitor→execute→enforce
```
Declared in a skill's `nim.json` harness block:
```json
{ "harness": { "guard": true, "policy": { "maxCostUsd": 0.5, "ratePerMin": 30 },
  "errorHandler": { "retries": 3, "circuitBreaker": true },
  "enforcer": { "strategies": ["schema","test"], "maxHeals": 3, "strict": true },
  "monitor": { "exporters": ["console"] },
  "search": { "backend": "local" }, "tokenSaver": { "router": true, "budget": 8000 } } }
```
