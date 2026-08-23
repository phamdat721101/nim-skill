---
name: nim-search
description: Deterministic local BM25 recall over header-aware memory, lesson, and archive chunks. Zero network and no embedding model.
version: 0.14.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: Search a local memory-like corpus for prior decisions, incidents, lessons, or invariants before repeating work.
install: npx github:phamdat721101/nim-skill add nim-search
---

# nim-search

```bash
nim-skill search "why did deployment fail" --files .nim/agent-support-log.md .nim/lessons.jsonl --top-k 3
```

Configure `harness.search` to inject `ctx.search`; it is absent when disabled.
