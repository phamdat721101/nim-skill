---
name: nim-guard
description: |
  Safety substrate that runs BEFORE a skill executes: Zod input validation +
  agentjacking (prompt-injection) rejection + cumulative cost cap + rate limit +
  tool allowlist + (v0.8) per-task budget cap + per-task duration cap. Throws
  GuardError on breach so a buggy/malicious skill body never runs.
version: 0.8.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Validate + sanitize untrusted agent/tool input at the boundary.
  - Enforce a per-agent cost cap, rate limit, or tool allowlist.
  - Reject prompt-injection / agentjacking attempts.
  - Cap what a SINGLE task run may spend ($ or token-credits) or how long it may run.
install: npx github:phamdat721101/nim-skill add nim-guard
---

# nim-guard

```ts
import { createGuard } from 'nim-skill';
const guard = createGuard(resolvedGuardConfig);
const clean = guard.validate(input, zodSchema);   // throws GuardError('invalid_input' | 'prompt_injection')
guard.checkPolicy({ agentId, tool, costUsd, taskCostUsd }); // throws GuardError('tool_not_allowed' | 'rate_limited' | 'cost_cap_exceeded' | 'task_budget_exceeded')
```

Config (`nim.json` → harness.guard): `{ maxCostUsd, ratePerMin, allowTools, injection: "strict"|"off", taskBudgetUsd, taskBudgetTokens, maxDurationMs }`.

## v0.8 — per-task budget + duration cap

Two new fields, both defaulted whenever a `guard` block is present at all:

- **`taskBudgetUsd`** (default `5`) or **`taskBudgetTokens`** — mutually exclusive
  (config validation rejects setting both). A per-task budget, reset every
  `runHarnessed()` call — orthogonal to the existing cumulative `maxCostUsd`. Checked
  pre-flight (an input-size cost estimate blocks before `execute()` runs) AND live, via
  an opt-in `ctx.budget.spend({ usd | tokens })` helper a skill calls during `execute()`.
- **`maxDurationMs`** (default `300_000` — 5 minutes). A wall-clock cap enforced via
  **cooperative cancellation**: `ctx.signal` (a real `AbortSignal`) and
  `ctx.budget.timedOut()` (a convenience boolean) are both available for a skill to
  check — a skill that never checks either keeps running past the cap, but
  `runHarnessed()` itself reports `status: 'error'`, `errorClass: 'timeout'` at the cap.

```ts
execute: async (input, ctx) => {
  ctx.budget?.spend({ usd: 0.02 });        // report real spend as it happens
  const res = await fetch(url, { signal: ctx.signal }); // cooperative timeout interop
  if (ctx.budget?.timedOut()) return partial;            // or poll the convenience getter
  return res.json();
}
```

**Known gap**: `nim-skill run` (the CLI's `spawnSync`-based command execution) does not
honor `maxDurationMs` — `spawnSync` is fully blocking and cannot observe `ctx.signal`.
This only affects the CLI path; the library-level `runHarnessed()` duration cap works
for any async `execute()` that checks `ctx.signal`/`ctx.budget.timedOut()`.

See `docs/prd/14-master-prd-v08-nim-guard-budget.md` for the full design record.
