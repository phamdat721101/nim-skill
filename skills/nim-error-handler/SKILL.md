---
name: nim-error-handler
description: |
  Error-recovery discipline: capture + classify (transient/permanent/critical/ambiguous)
  then recover — retry with backoff, circuit-breaker, graceful fallback, or clean
  escalate. Never silently swallows; returns a classified Result.
version: 0.1.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Wrap flaky work (network, rate-limited APIs) with retry + backoff + circuit breaker.
  - Route permanent vs transient vs critical failures differently.
  - Escalate auth/data-loss failures cleanly instead of retrying blindly.
install: npx github:phamdat721101/nim-skill add nim-error-handler
---

# nim-error-handler

```ts
import { recover, createBreaker } from 'nim-skill';
const res = await recover(() => doWork(), policy, { key: 'work', breaker: createBreaker(policy), onEscalate });
if (res.ok) use(res.value); else handle(res.error);
// { class, message, retryable, attempts, errorType?, actionRequired? }
```

`errorType`/`actionRequired` (v0.13) are derived, advisory fields populated when the
error message matches an entry in the built-in remediation table (e.g. an ENOENT-shaped
message → `errorType: 'file-not-found'`, `actionRequired: 'Stop guessing the path...'`).
They are never a substitute for `class` in branching/retry logic — `class` still drives
retry/backoff/escalate policy; `errorType`/`actionRequired` only tell the calling agent
what to do next. Both are `undefined` when no rule matches (byte-identical to pre-v0.13
behavior).

Config (`nim.json` → harness.errorHandler): `{ retries, backoff: "exp-jitter"|"fixed"|"none", circuitBreaker: { failN, cooldownMs }, remediationRules: [{ pattern, errorType, actionRequired }] }`.
`remediationRules` entries are checked BEFORE the built-in default table, so a project can
override or extend the defaults without forking `error-handler/remediation.ts`.
