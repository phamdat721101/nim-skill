---
name: nim-logcompact
description: |
  Compresses raw subprocess/tool output (stdout/stderr, log tails) BEFORE it
  reaches an agent's context. Three strategies: cap (line-truncate), errors-only
  (default — keep error-marker lines + context, drop the rest), incremental
  (a total-count + head/tail summary for very large output). Grounded in a
  measured 60-96% token-cost reduction on shell/log output (bswen.com, 2026-03-02).
version: 0.9.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - `nim-skill run` or any skill that shells out and would otherwise dump raw,
    uncapped stdout/stderr into an agent's context (setup logs, test output,
    build logs, `git diff`, `grep` dumps).
  - Cut the token cost of tool output without losing the error signal that
    actually matters (escalateOnEmpty guarantees a real failure never vanishes).
install: npx github:phamdat721101/nim-skill add nim-logcompact
---

# nim-logcompact

Distinct verb from `nim-context` (which budgets/warns on a run's TOTAL token size):
`nim-logcompact` shrinks one string's CONTENT. Same "distinct verb, own module"
category as `cache`/`context`/`memory`/`lessons` — a per-`runHarnessed()`-call concern.

```ts
// injected as ctx.logCompact when harness.logCompact is set:
const { text, originalChars, compactedChars, reductionPct } = ctx.logCompact.compact(rawStdout);
```

Config (`nim.json` → harness.logCompact):
`{ maxLines: 100, strategy: "cap"|"errors-only"|"incremental", escalateOnEmpty: true }`.

CLI:

```bash
nim-skill run "npm test" --logcompact          # compact stdout/stderr before the enforcer sees it
nim-skill run "npm test" --logcompact --enforce # --enforce verifies the SAME compacted text printed
nim-skill monitor --logcompact                  # aggregate reduction% across recent runs
```

## Strategies

| strategy | behavior |
|---|---|
| `cap` | Truncate to the first `maxLines` lines. No filtering. |
| `errors-only` (default) | Keep only lines matching `ERROR`/`FAIL`/`FATAL`/`Exception`/`error:` plus 2 lines of surrounding context, then cap. |
| `incremental` | Summarize very large input: total line count + a head/tail slice, never the full body. |

⚠️ **`escalateOnEmpty` (default `true`)**: if filtering yields nothing (no error markers
found), falls back to a capped-but-UNFILTERED slice rather than returning an empty
string — a real failure buried outside the error-context window still surfaces
instead of silently vanishing. Set `false` only if an empty result is an acceptable
signal on its own for your use case.

If a skill calls `ctx.logCompact.compact()` more than once in a single run (e.g.
compacting stdout AND stderr separately), the trace AGGREGATES totals across every
call — not last-call-wins — so an earlier meaningful result is never silently
overwritten by a later, possibly-empty one.

See `docs/prd/15-master-prd-v09-nim-logcompact-nim-propose.md` for the full design record.
