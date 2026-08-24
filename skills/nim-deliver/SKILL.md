---
name: nim-deliver
description: |
  Product-owner delivery gate that requires a client outcome, explicit design
  rationale, environment contract, System Map, executable edge-case proof, and
  post-delivery proof before a feature is marked complete. Local-first and secret-free.
version: 0.15.0
author: phamdat721101
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - A feature or project must be safe to hand off to an end client, not merely compile.
  - You need to record why an implementation was chosen and prove its outcome.
  - An agent needs a deterministic pre-code map, threat model, and failure-proof workflow.
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

# Optional E2E feature protocol (map metadata must be completed before verify)
nim-skill deliver map --feature customer-payment-notifications --type feature
nim-skill deliver chaos --map docs/features/customer-payment-notifications-map.md
nim-skill deliver verify --map docs/features/customer-payment-notifications-map.md
```

`workspace.deliver` is opt-in. Each profile points to a secret-free JSON
environment contract and optional local verification commands. The contract
declares secret key-to-placeholder mappings, TLS verification policy, and
dependency side effects. A TLS target using disabled hostname verification
always fails: use a provider endpoint or documented certificate SAN policy.

`deliver check` uses the existing memory cache, compacted command output, the
strict enforcer, and the workrule log. It never calls cloud APIs, reads secret
values, or deploys software.

The E2E commands use a fenced `json nim-deliver` block inside the System Map.
`verify` requires one local executable proof and one structured log marker for
each of EDGE-01 through EDGE-05. `workspace.deliver.e2e` is disabled by default;
when enabled in strict hook-capable hosts it blocks configured feature-code writes
until the selected System Map is approved. Patch and documentation paths bypass it.
