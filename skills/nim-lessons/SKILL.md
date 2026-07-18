---
name: nim-lessons
description: |
  Auto-captured, queryable error/lesson log. Answers "has a similarly-shaped
  action previously failed, for a reason that generalizes beyond this one
  output's content?" — structurally different from nim-memory (which caches
  an unchanged output's verify verdict). Two invocation surfaces: a runtime
  `ctx.lessons` helper for skills running through runHarnessed(), and a
  hook-native path for raw Write/Edit tool calls that never go through
  runHarnessed() at all. Deterministic glob + literal-equality matching only
  — no semantic/embedding search, no LLM call, no network. Config-gated.
version: 0.5.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Capture a lesson after a caught failure so a future action of the same shape (same tool, matching path glob, matching content signal) surfaces the prior mistake before it repeats.
  - Query whether a proposed action's shape matches any previously-logged near-miss, independent of whether nim-workspace's own identity check is even configured for this workspace.
  - Auto-append a lesson every time nim-workspace's BLOCK recommendation fires, closing the reflexive loop (the harness remembers having prevented a mistake, not just prevented it once).
install: npx github:phamdat721101/nim-skill add nim-lessons
---

# nim-lessons

Runtime `ctx` helper (like `nim-memory`/`nim-cache`) — nested under `harness`
in `nim.json` (unlike `nim-workspace`, a top-level sibling key), because
`ctx.lessons` is a per-`runHarnessed()`-call concern:

```jsonc
{ "harness": { "lessons": { "store": ".nim/lessons.jsonl", "ttlMs": 7776000000 } } }
```

```ts
import { runHarnessed } from 'nim-skill';

const skill = {
  name: 'my-skill',
  harness: { lessons: { store: '.nim/lessons.jsonl' } },
  execute: async (input, ctx) => {
    const priorMisses = ctx.lessons.check({ toolName: 'Write', pathGlob: input.path, contentSignal: null });
    if (priorMisses.length) { /* surface the prior lesson before proceeding */ }
    // ...
    ctx.lessons.capture({
      triggerShape: { toolName: 'Write', pathGlob: 'research/**/*.md', contentSignal: 'off-stack-cluster' },
      whatWentWrong: 'Wrote off-stack content into this workspace.',
      correctPattern: 'Verify content stack signal against workspace.stack before writing.',
      severity: 'critical', source: 'auto',
    });
    return { ok: true };
  },
};
```

Absent `harness.lessons` ⇒ `ctx.lessons` is not injected at all and
`trace.lessonsMatch` is never present on the returned envelope (byte-
identical rollback contract — the single most important guarantee this
primitive ships with). When configured and a `capture()`/`check()` call
matches, the run's `trace.lessonsMatch` reports `{ matchedLessonIds,
severity }` additively, same optional-field precedent as `trace.cache` /
`trace.disclosure` / `trace.profileTier`.

Hook-native path (for the far more common case of a raw `Write`/`Edit` tool
call that never goes through `runHarnessed()` at all):

```bash
nim-skill lessons capture --tool-name Write --path-glob 'research/**/*.md' \
  --content-signal off-stack-cluster --what "wrote off-stack content" \
  --fix "verify content stack signal before writing" --severity critical --source auto
nim-skill lessons check --tool-name Write --path research/cross-product/x.md --content-signal off-stack-cluster
nim-skill lessons list
```

The dual hook adapters (shared with `nim-workspace`) call these same
subcommands as a CLI subprocess from inside a `PreToolUse` hook script —
see `nim-workspace`'s `workspace hook --format claude-code|kiro-cli` layer.

<!-- lean:cut -->

## Notes

`matchesShape(candidate, logged)` is deliberately deterministic, not
semantic: exact `toolName` match (or `logged.toolName === '*'` wildcard), a
real glob test of `candidate.pathGlob` against `logged.pathGlob`'s pattern
(`**` and `*` segments, anchored), and exact `contentSignal` equality (or
either side `null` = wildcard). A fuzzy/embedding match mode is a named
v0.6+ candidate, not built here. The store (`src/lessons/store.ts`) mirrors
`src/memory/index.ts`'s file-backed JSONL pattern exactly — same
load-on-construct, in-memory map, best-effort append, TTL-on-read shape,
zero new architecture invented for this primitive.
