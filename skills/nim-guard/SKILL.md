---
name: nim-guard
description: |
  Safety substrate that runs BEFORE a skill executes: Zod input validation +
  agentjacking (prompt-injection) rejection + cost cap + rate limit + tool
  allowlist. Throws GuardError on breach so a buggy/malicious skill body never runs.
version: 0.1.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Validate + sanitize untrusted agent/tool input at the boundary.
  - Enforce a per-agent cost cap, rate limit, or tool allowlist.
  - Reject prompt-injection / agentjacking attempts.
install: npx github:phamdat721101/nim-skill add nim-guard
---

# nim-guard

```ts
import { createGuard } from 'nim-skill';
const guard = createGuard(resolvedGuardConfig);
const clean = guard.validate(input, zodSchema);   // throws GuardError('invalid_input' | 'prompt_injection')
guard.checkPolicy({ agentId, tool, costUsd });     // throws GuardError('tool_not_allowed' | 'rate_limited' | 'cost_cap_exceeded')
```

Config (`nim.json` → harness.guard): `{ maxCostUsd, ratePerMin, allowTools, injection: "strict"|"off" }`.
