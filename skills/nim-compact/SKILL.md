---
name: nim-compact
description: Validates and writes a separate curated memory artifact from a caller-provided distillation candidate; never rewrites the append-only source.
version: 0.14.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: Distill growing session, lesson, or support logs into bounded curated invariants while preserving the original audit trail.
install: npx github:phamdat721101/nim-skill add nim-compact
---

# nim-compact

```bash
nim-skill compact apply --source .nim/agent-support-log.md --output .nim/agent-support-log.distilled.md --candidate candidate.json
```

The candidate is strict local JSON. The source path is identity-only and is never modified.
