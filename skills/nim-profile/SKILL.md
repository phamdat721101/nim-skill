---
name: nim-profile
description: |
  Model-tier detection + per-tier harness config resolution. Given a declared
  or heuristically-inferred model tier, tightens (never loosens) the existing
  HarnessConfig so the same skill produces the same reliability floor across
  a model swap. No model client, no routing, no fine-tuning. Config-gated.
version: 0.4.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Keep the same reliability floor when swapping from a frontier model to an open-weight one.
  - Tighten enforcer/guard/circuit-breaker strictness for a model with unproven instruction-following.
  - Never silently loosen a user's own stricter nim.json declaration.
install: npx github:phamdat721101/nim-skill add nim-profile
---

# nim-profile

```bash
nim-skill profile detect --model-hint "$MODEL_NAME"   # prints the tier that WOULD be selected, no side effect
nim-skill profile show --tier open-weight-untested     # prints the resolved config delta for that tier
```

```ts
import { applyProfile } from 'nim-skill';
const { harness, tier } = applyProfile(skill.harness, { modelHint: process.env.MODEL_NAME });
const result = await runHarnessed({ ...skill, harness }, input, ctx);
```

Config (`nim.json` → top-level `profile`, a sibling of `harness`):
`{ tier: "open-weight-verified", modelHint: "glm-5.2", verifiedModelPatterns: ["my-org/.*"] }`.

<!-- lean:cut -->

## Notes

Three built-in tiers: `frontier` (no-op), `open-weight-verified` (`maxHeals`
+1), `open-weight-untested` (`enforcer.mode`→strict, `guard.injection`→strict,
`circuitBreaker.failN`−1 — the safe default when no hint matches anything).
Never-loosen invariant is absolute: every tier delta only ever tightens
relative to what the caller's own `nim.json` already declares. Composes
*around* `runHarnessed()` — does not add a 6th pipeline step.
