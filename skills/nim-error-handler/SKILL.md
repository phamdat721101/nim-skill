---
name: nim-error-handler
description: |
  Error-recovery discipline: capture + classify (transient/permanent/critical)
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
if (res.ok) use(res.value); else handle(res.error); // { class, message, retryable, attempts }
```

Config (`nim.json` → harness.errorHandler): `{ retries, backoff: "exp-jitter"|"fixed"|"none", circuitBreaker: { failN, cooldownMs } }`.
