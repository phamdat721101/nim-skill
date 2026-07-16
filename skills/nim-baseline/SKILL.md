---
name: nim-baseline
description: |
  Memory-file scaffold + lint + audit. Checks an AGENTS.md/CLAUDE.md-family
  file against the "would removing this line cause a mistake" test plus a
  mandatory progressive-disclosure structure rule. Advisory by default (warn),
  never auto-edits. Deterministic (~0 model tokens). Config-gated.
version: 0.4.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Check whether a project's memory file is well-formed before it bloats past ~150 lines.
  - Scaffold a new memory file that starts compliant by construction.
  - Audit progressive-disclosure structure (root index + on-demand detail files).
install: npx github:phamdat721101/nim-skill add nim-baseline
---

# nim-baseline

```bash
nim-skill baseline lint [path]           # default: ./AGENTS.md, falls back to ./CLAUDE.md
nim-skill baseline lint --strict         # BL-LEN becomes blocking (exit 1)
nim-skill baseline scaffold [path]       # generates a compliant starter file
nim-skill baseline audit --structure     # progressive-disclosure structure check only
```

Config (`nim.json` → top-level `baseline`, a sibling of `harness`, not nested under it):
`{ maxLines: 100, blockLines: 150, maxInstructions: 100, mode: "warn"|"strict"|"off", detailDir: "agent_docs" }`.

Composes with the existing enforcer `command` strategy to make a bloated memory
file CI-blocking with zero new runtime surface:

```jsonc
{ "harness": { "enforcer": { "strategies": [
  { "kind": "command", "command": "nim-skill baseline lint --strict" }
] } } }
```

<!-- lean:cut -->

## Notes

Six rules: `BL-LEN` (line count, the only hard-block-capable rule),
`BL-BUDGET` (estimated instruction count), `BL-DERIVABLE` (generic advice a
model would follow anyway), `BL-LINTABLE` (style rules a linter should own),
`BL-TASKSPECIFIC` (domain-clustered blocks that belong in a detail file),
`BL-PROGRESSIVE`/`BL-EMPTYFOLDER` (progressive-disclosure structure). All
advisory except `BL-LEN`, which the codebase's own `AGENTS.md` passes with
0 findings (dogfood proof).
