# AGENTS.md — nim-skill orientation

`nim-skill` is an **agent-harness toolkit**. Every task an agent runs can pass through
`runHarnessed()`, which makes it reliable: guarded, error-recovered, monitored, and
output-verified-before-ship — **local-first** (zero network on the default path), MIT.

## The one function

```ts
import { runHarnessed } from 'nim-skill';

const result = await runHarnessed(skill, input, ctx);
// → { output, verified, heals, checks, trace }
```

Pipeline (each layer config-gated; disabled ⇒ byte-identical to a bare run):

```
① guard.validate(input)      Zod + agentjacking → throws GuardError
② guard.checkPolicy(ctx)     cost cap / rate / allowlist → throws GuardError
③ monitor.wrap(              trace {tokens,cost,latency,verify,heal,errorClass}
     errorHandler.run(         classify → retry/backoff/breaker/fallback/escalate
       skill.execute))
④ enforcer.verifyOrHeal      block-before-ship + bounded self-heal
⑤ return { output, verified, heals, checks, trace }
```

## Layout

- `src/harness/` — `runHarnessed()` core + shared types.
- `src/guard/` — validate + injection (agentjacking) + policy (cost/rate/allowlist).
- `src/error-handler/` — classify + recover (retry/backoff/fallback/escalate) + circuit-breaker.
- `src/monitor/` — wrap + capture + pluggable sinks (console/file/sentry) + dashboard + token-ROI (`roi.ts`).
- `src/enforcer/` — output-enforcer verify-gate (nonempty/schema/math/json/test/lint/command) + compact heal-feedback.
- `src/context/` — U1 "see" verb: per-run token budget helper (`ctx.context`).
- `src/memory/` — U4 "remember" verb: content-hash verify-cache + priors (`ctx.memory`).
- `src/cache/` — v0.3 nim-cache: assembler + provider adapters + ROI meter (`ctx.cache`).
- `src/serialize/` — U5b terminal-only token-optimized serialization (guardrailed).
- `src/tokens.ts` — single shared approximate token estimator.
- `src/config.ts` — Zod-validated `nim.json` loader (`resolveConfig`).
- `src/cli.ts` — `nim-skill run|enforce|monitor|add`.
- `skills/nim-*/SKILL.md` — installable skill manifests.

## Principles

1. Author writes only `execute()`; the harness supplies the rest.
2. Enforce, don't instruct — verification runs inside the runtime, unbypassable.
3. Local-first — externals (Sentry) are opt-in with graceful no-op fallback.
4. Config-gated no-op passthrough — every layer off ⇒ bare run (rollback contract).
5. SOLID, small files, no duplication (shared code is imported, never copied).
