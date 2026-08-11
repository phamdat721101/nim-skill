---
name: nim-propose
description: |
  Pre-execute deny gate requiring an explicit, human-approved plan document
  before a task runs — extends nim-guard (harness.guard.propose), same policy-
  shaped precedent as v0.8's per-task budget/duration cap. Includes an owner-
  profile learning store (.nim/owner-profile.jsonl) that advisory-pre-fills a
  new proposal's sections toward patterns an owner has consistently approved
  for similarly-shaped past tasks — never bypasses the approval pause itself.
version: 0.9.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - A task is consequential enough (destructive, irreversible, production-
    facing) that it should not run until a human has reviewed and explicitly
    approved a written plan first.
  - You want the harness itself — not a convention an agent might skip — to
    enforce the pause-then-resume workflow.
install: npx github:phamdat721101/nim-skill add nim-propose
---

# nim-propose

Extends `nim-guard`'s `checkPolicy()` — checked FIRST, before cost/rate/budget
(deterministic ordering): a task with no approved plan surfaces `proposal_required`,
never an unrelated budget denial that happens to also apply.

```ts
guard.checkPolicy({ agentId, tool, taskDescription }); // throws GuardError('proposal_required')
```

Config (`nim.json` → harness.guard.propose):
`{ require: true, approvalTtlMs: 86400000, proposalsDir: ".nim/proposals" }`.

CLI — the actual pause-then-resume mechanic:

```bash
nim-skill propose "add a database migration"      # scaffolds .nim/proposals/<hash>.md
nim-skill propose --approve <hash>                 # stamps an `approved: <ISO date>` line
```

A plan artifact is content-hash-keyed to its task description (mirrors
`nim-memory-lite`'s verify-cache key pattern — no path needs threading through).
`checkProposal()` denies unless the file exists, contains an `approved:` line, and
that timestamp is within `approvalTtlMs` (default 24h).

## Owner-profile learning (advisory, never bypasses the pause)

Every approval records the task's shape (a deterministic head-noun keyword — same
discipline as `nim-lessons`' trigger-shape matching, not semantic/embedding-based),
the plan's sections at approval time, and approval latency, in
`.nim/owner-profile.jsonl` (same file-backed JSONL shape as `nim-lessons`' store,
reused verbatim). A new proposal's scaffold pre-fills any section present in EVERY
prior approval for the same task shape — e.g. an owner who always adds a "Testing"
section to migration-shaped plans will see it pre-filled on the next one. The
scaffold NEVER emits the `approved:` line itself; the pause is never skipped.

```bash
nim-skill monitor --propose   # approved/denied counts + deny-reason breakdown
```

**Known boundary**: this is a file-presence + timestamp check, not a credential/
session broker — a scenario where an approval token itself goes stale between pause
and resume (distinct from the plan going stale) is out of scope, named but not built
(see `docs/prd/15-master-prd-v09-nim-logcompact-nim-propose.md` §3).
