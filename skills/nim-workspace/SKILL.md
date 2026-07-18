---
name: nim-workspace
description: |
  Hook-native existence + identity + subject-matter + staleness gate for a
  proposed Write/Edit. Checks the content's tech-stack signal against the
  workspace's declared `stack`, scans for existing artifacts claiming the
  same territory, and warns when a declared liveness file is stale. Advisory
  (`mode:'warn'`) by default; only an explicit `mode:'strict'` opt-in ever
  hard-blocks, and even then only the BLOCK recommendation. Deterministic
  glob/grep/regex/mtime checks only — no LLM call, no network. Config-gated.
version: 0.5.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Catch content whose tech-stack signal doesn't match the workspace's declared stack before it's written (e.g. Java/Spring analysis landing in a TypeScript/web3 research folder).
  - Check whether a proposed file/skill overlaps something that already exists before creating a near-duplicate.
  - Get warned when a workspace's own liveness/status file has gone stale past its declared refresh cadence.
install: npx github:phamdat721101/nim-skill add nim-workspace
---

# nim-workspace

```bash
nim-skill workspace check <path>    # one-shot check against a proposed file (for scripting/CI)
nim-skill workspace audit [dir]     # scan a directory for existing existence-overlap pairs
nim-skill workspace hook --format claude-code --stdin   # PreToolUse -> Claude Code deny/ask/allow JSON
nim-skill workspace hook --format kiro-cli --stdin       # PreToolUse -> Kiro CLI exit-code + stdout/stderr
```

`workspace hook` reads a PreToolUse-shaped JSON payload
(`{ tool_name, tool_input: { file_path, content } }`) from stdin, runs it
through the same `createWorkspaceGuard().check()` both `check`/`audit` use,
and emits the exact shape each host's hook runner expects — paste the
generated command straight into `.claude/settings.json`'s `PreToolUse` array
or `.kiro/agents/*.json`'s `preToolUse` block.

Config (`nim.json` → top-level `workspace`, a sibling of `harness`/`baseline`/`profile`, not nested under any of them):

```jsonc
{ "workspace": {
    "stack": ["typescript", "web3"],
    "offStackSignalTerms": { "java": ["@Transactional", "AbstractRoutingDataSource", "gradle", "JDK 21"] },
    "clusterWindow": 8, "clusterThreshold": 3,
    "existenceOverlapThresholds": { "extend": 50, "compose": 80, "iterate": 20 },
    "livenessFile": "_brain/product-state.md", "livenessCadence": "Mon,Wed,Fri",
    "mode": "warn" } }
```

```ts
import { createWorkspaceGuard } from 'nim-skill';
const guard = createWorkspaceGuard(resolveWorkspaceConfig(loadWorkspaceJson()));
const result = guard.check({ filePath, content, declaredPurpose });
// result.recommendation: 'PROCEED' | 'EXTEND' | 'COMPOSE' | 'ITERATE' | 'BLOCK'
```

Runs entirely OUTSIDE `runHarnessed()` — it gates a raw tool call before a
skill even runs, not a 6th pipeline step.

<!-- lean:cut -->

## Notes

Identity check reuses `checkTaskSpecific`'s exact 8-line-window +
`>=`N-clustered-terms algorithm from `nim-baseline` (imported, not
duplicated) against a workspace-configured off-stack term list. Absent
`stack` declaration never produces a BLOCK identity mismatch — nothing to
check identity against, the one place this primitive deliberately softens
rather than hardens on missing signal (mirrors `nim-profile`'s own
documented departure from the usual absent-config-loosens contract, just in
the opposite direction, and for a symmetric reason). Staleness never blocks,
only warns (`staleWarning`), independent of the identity/existence
recommendation. Dual hook-adapter wiring (`workspace hook --format
claude-code|kiro-cli`) ships as a follow-on primitive layer on top of this
same `createWorkspaceGuard()` core.
