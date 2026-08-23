---
name: nim-globalmem
description: Read-only local audit for drift among declared cross-project memory copies. It never merges, copies, or synchronizes files.
version: 0.14.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: Verify that intentionally duplicated skill or global-memory files remain byte-identical across local host/project directories.
install: npx github:phamdat721101/nim-skill add nim-globalmem
---

# nim-globalmem

```bash
nim-skill globalmem audit --path ~/.kiro/skills/gstack/CLAUDE.md --path ~/.claude/skills/gstack/CLAUDE.md
```

Or declare named paths under top-level `globalmem.declarations` in `nim.json` and run `nim-skill globalmem audit --name gstack`.
