---
name: nim-deliver
description: |
  Product-owner delivery gate that requires a client outcome, explicit design
  rationale, environment contract, verification evidence, and post-delivery
  proof before a feature is marked complete. Local-first and secret-free.
version: 0.11.0
author: phamdat721101
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - A feature or project must be safe to hand off to an end client, not merely compile.
  - You need to record why an implementation was chosen and prove its outcome.
install: npx github:phamdat721101/nim-skill add nim-deliver
---

# nim-deliver

```bash
nim-skill deliver propose "customer payment notifications"
# Fill in docs/features/customer-payment-notifications.md, then obtain approval:
nim-skill propose --approve <proposal-id>
nim-skill deliver check --profile qa --brief docs/features/customer-payment-notifications.md --phase pre
nim-skill deliver record --profile qa --evidence qa-evidence.json
nim-skill deliver check --profile qa --brief docs/features/customer-payment-notifications.md --phase post
```

`workspace.deliver` is opt-in. Each profile points to a secret-free JSON
environment contract and optional local verification commands. The contract
declares secret key-to-placeholder mappings, TLS verification policy, and
dependency side effects. A TLS target using disabled hostname verification
always fails: use a provider endpoint or documented certificate SAN policy.

`deliver check` uses the existing memory cache, compacted command output, the
strict enforcer, and the workrule log. It never calls cloud APIs, reads secret
values, or deploys software.
