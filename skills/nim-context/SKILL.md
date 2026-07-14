---
name: nim-context
description: |
  The "see" verb — stops the harness being a context tax. Per-run token budget
  (block/warn/compact when a run exceeds maxInputTokens), progressive disclosure,
  and lean SKILL.md install. Deterministic (~0 model tokens). Config-gated.
version: 0.2.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Cap the tokens a single run may consume (Context-Rot mitigation).
  - Warn/block/compact when a run's estimated context exceeds a budget.
  - Install lean skill manifests on hosts without lazy loading (--lean).
install: npx github:phamdat721101/nim-skill add nim-context
---

# nim-context

```ts
import { createContextHelper, ContextBudgetError } from 'nim-skill';
// injected as ctx.context when harness.context is set:
const { action, overBudget } = ctx.context.budget(estimatedTokens); // 'ok' | 'warn' | 'compact'
```

Config (`nim.json` → harness.context):
`{ progressive: true, maxInputTokens: 8000, onExceed: "warn"|"compact"|"block", lean: false }`.

- `onExceed:'block'` throws `ContextBudgetError` before the skill runs (fail fast, cheap).
- Token figures are approximate estimates (~4 chars/token), never billed truth.

<!-- lean:cut -->

## Notes

Pairs with `harness.monitor.tokenAccounting` (U3) to record net-token savings per run.
