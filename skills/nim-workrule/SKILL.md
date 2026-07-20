---
name: nim-workrule
description: |
  The working rule an agent self-checks BEFORE editing code inside this
  repo (or any repo that installs nim-skill): clean/simple/SOLID, no
  repeated mistakes across modules, essential files only, partial reads
  over full-file reads, no new files unless essential, and mandatory
  local-only tracking of how nim-skill's own primitives helped THIS task
  (which primitive fired, what it caught, how much context/cache it saved).
  Six checkable rules (WR-01..WR-06), advisory by default — same
  enforce-don't-instruct discipline as nim-baseline, applied one level up
  (to the agent's own editing behavior, not the content it produces).
version: 0.1.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Before starting a multi-file code change, to check the plan against WR-01..WR-04.
  - Right after using ANY nim-skill primitive mid-task, to append a tracked-memory entry (WR-06).
  - At end-of-task self-review, to run the full checklist against the diff before calling it done.
install: npx github:phamdat721101/nim-skill add nim-workrule
---

# nim-workrule

Six rules an agent runs against **its own editing behavior**, not the
content it produces (that's `nim-baseline`'s job). This is the working
rule installed once per project, in `.nim/workrule.md` (gitignored, same as
every other `.nim/*` file) — read it at the start of a task, self-check
against it during, append the tracked-memory entry (WR-06) at the end.

| ID | Rule | Self-check question |
|---|---|---|
| **WR-01** | Clean + simple + SOLID | Does this change add a class/function per responsibility, with no god-object and no duplicated logic across files? |
| **WR-02** | No repeated mistakes | Did I grep for this exact bug pattern in OTHER modules before considering the fix done in only the one file I found it in? |
| **WR-03** | Essential files only | Am I touching only the files this change actually requires — not "while I'm in here" drive-by edits? |
| **WR-04** | Partial reads, no new files unless essential | Did I read only the relevant function/section (not the whole file) where a partial read would do, and did I check whether an existing file/module can hold this logic before creating a new one? |
| **WR-05** | High quality, high performance, simple to deploy | Does the change keep the byte-identical-off / no-new-runtime-deps discipline nim-skill already ships (config-gated, `npx`-installable, zero new required dependency)? |
| **WR-06** | Tracked memory (gitignored) | Did I append an entry to `.nim/agent-support-log.md` recording which nim-skill primitive fired, what it caught/prevented, and — if `nim-cache`/`nim-index`/`nim-context` were involved — the measured token/context saving for this specific task? |

`nim-skill workrule check` prints the six questions (no LLM call — this is
a self-check prompt, not an automated linter; WR-01..WR-05 are judgment
calls a heuristic can't safely automate, same caution `nim-baseline`
applies to `BL-DERIVABLE`/`BL-LINTABLE`). WR-06 is the one rule with a
concrete artifact: it is satisfied when `.nim/agent-support-log.md`
(created by `nim-skill workrule log`) has a new entry for the current
session.

```bash
nim-skill workrule check                        # print the 6-question checklist
nim-skill workrule log --primitive nim-cache \
  --effect "avoided reprocessing 40 lines of unchanged AGENTS.md" \
  --tokens-saved 1800                            # append a tracked-memory entry
```

Config (`nim.json` → top-level `workrule`, sibling of `harness`/`baseline`/`profile`/`workspace`):

```jsonc
{ "workrule": { "logFile": ".nim/agent-support-log.md" } }
```

## Why this exists (not duplicating nim-baseline / nim-workspace)

- `nim-baseline` checks whether a **memory file** (AGENTS.md/CLAUDE.md) is
  well-formed. `nim-workrule` checks whether **an editing session** followed
  the six rules above — a different subject, same "would skipping this
  cause a mistake" discipline.
- `nim-workspace` gates a **proposed file's identity/existence** before a
  Write/Edit lands. `nim-workrule` is the six-rule checklist an agent runs
  on **itself**, including a rule (WR-06) that specifically closes the loop
  on "did the harness actually help, and by how much" — the tracked-memory
  file this primitive owns.
- `.nim/agent-support-log.md` is intentionally NOT the same file as
  `.nim/agent-learnings.md` (bug-fix journal, pre-existing convention) — the
  log this primitive writes is scoped to "how did nim-skill itself help
  this task," not general debugging notes.

<!-- lean:cut -->

## Notes

WR-01 through WR-05 are deliberately advisory-only with no hard-block
mode — codifying them into a heuristic linter the way `nim-baseline` does
for prose risks the exact false-positive trap `BL-DERIVABLE`/`BL-LINTABLE`
already accept as a known tradeoff (mode:'warn' by default), but for *code
structure* judgments the false-positive risk is categorically higher (no
cited research threshold exists for "is this class doing too much," unlike
`nim-index`'s cited tool-count bands). WR-06 is the one rule this primitive
can make concrete because it has a real artifact (the log file) instead of
a judgment call — see `nim-skill/src/workrule/` for the append-only
JSONL-of-markdown-entries store, same file-backed pattern as
`nim-lessons`/`nim-memory`.
