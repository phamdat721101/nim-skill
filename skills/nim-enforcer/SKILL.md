---
name: nim-enforcer
description: |
  "Enforce, don't instruct" output verify-gate. Before a skill's output ships,
  run declared strategies (nonempty/json/schema/math/test/lint/command); on fail,
  block or self-heal (bounded). Unbypassable — runs inside the runtime.
version: 0.1.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Verify agent output before it ships (schema, math invariants, tests, lint, a command).
  - Self-heal bad output by feeding the failure back and re-executing (bounded).
  - Gate a build/commit on an unbypassable check.
install: npx github:phamdat721101/nim-skill add nim-enforcer
---

# nim-enforcer

```ts
import { verifyOrHeal } from 'nim-skill';
const vr = await verifyOrHeal(output, { strategies: [{ kind: 'schema', required: ['id'] }], maxHeals: 3, mode: 'strict' }, { reExecute });
if (!vr.verified) block(vr.checks);
```

Config (`nim.json` → harness.enforcer): `{ strategies, maxHeals (0-5), mode: "strict"|"warn"|"off" }`.
CLI: `nim-skill enforce "npm test"`.
