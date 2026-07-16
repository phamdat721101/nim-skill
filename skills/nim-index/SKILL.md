---
name: nim-index
description: |
  Tool/skill disclosure-tax meter. Measures the standing token cost of a
  project's MCP/skill tool surface + reports a cited accuracy-risk band;
  flags cache-fragile (volatile) tool descriptions. Generates a trimmed
  catalog only behind explicit --write. Deterministic (~0 model tokens).
version: 0.4.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Measure the token cost your installed MCP servers/skills re-pay every planning turn.
  - Check whether your tool count is in the accuracy-risk zone (past ~25-100 tools).
  - Flag tool descriptions that would bust a provider's prompt-cache prefix.
install: npx github:phamdat721101/nim-skill add nim-index
---

# nim-index

```bash
nim-skill index measure [--mcp-config path] [--skills-dir path]
nim-skill index measure --turns 8              # override estimatedTurnsPerTask
nim-skill index trim --write --keep <names>    # opt-in: emit a trimmed catalog, never silent
```

Config (`nim.json` → top-level `index`, a sibling of `harness`):
`{ estimatedTurnsPerTask: 5, riskThresholds: { watch: 21, elevated: 26, high: 101 }, mcpConfigPath: ".mcp.json", skillsDir: "skills" }`.

Risk-band table (a cited lookup, not a fitted curve): `≤10` / `11-20` low-risk,
`21-25` watch, `26-100` elevated-risk, `>100` high-risk (tianpan.co, 2026-05-13).

<!-- lean:cut -->

## Notes

`measure()` reads either an MCP config (`tools/list`-shaped) or a
`skills/*/SKILL.md` tree, reusing `estimateTokensOf` from the shared token
estimator — no new estimator. `trim()` never writes a file itself; the CLI's
`--write` flag is the only opt-in path, per the "never a silent rewrite"
principle. Composes with `nim-monitor` via `TraceRecord.disclosure`
(additive, optional — populated only when nim-index runs inside a
harnessed call).
