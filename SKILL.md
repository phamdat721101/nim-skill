---
name: nim-skill
description: |
  Local-first, host-portable agent-harness toolkit. Wrap any agent task in
  runHarnessed() to make it reliable: guarded (agentjacking + cost/rate/allowlist),
  error-recovered (classify → retry/backoff/circuit-breaker/fallback/escalate),
  monitored (traces), and output-verified-before-ship (unbypassable). Composes 4
  installable primitives. Zero network on the default path. MIT.
version: 0.1.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: meta
homepage: https://github.com/phamdat721101/nim-skill
install: npx github:phamdat721101/nim-skill install
when_to_use: |
  - Make an agent task reliable: verify output before ship, recover errors, guard inputs.
  - Add drop-in reliability without rewriting your agent into a framework.
  - Keywords: harness, verify output, block bad output, retry, circuit breaker, cost cap, agentjacking.
schema:
  harness_config: ./schema/harness-config.json
  trace: ./schema/trace.json
  verify_result: ./schema/verify-result.json
  classified_error: ./schema/classified-error.json
test_invocations: ./tests/e2e/dogfood.test.ts
companion_publish:
  - clawhub
  - anthropic-skills-registry
  - npm
side_effects:
  - "Reads nim.json (harness config) from the project root when present"
  - "Writes trace JSONL to .nim/traces.jsonl when the file exporter is enabled"
  - "Runs verify commands (test/lint/command strategies) via the shell"
  - "Optional: forwards error traces to Sentry when SENTRY_DSN is set (no-op otherwise)"
identity:
  capability: "agent-harness-runtime"
sub_skills:
  - skills/nim-guard
  - skills/nim-error-handler
  - skills/nim-monitor
  - skills/nim-enforcer
---

# nim-skill

The one function every harnessed run passes through:

```ts
import { runHarnessed } from 'nim-skill';
const { output, verified, heals, checks, trace } = await runHarnessed(skill, input, ctx);
```

Pipeline (each layer config-gated in `nim.json`; disabled ⇒ byte-identical bare run):

```
① guard.validate(input)      Zod + agentjacking → throws GuardError
② guard.checkPolicy(ctx)     cost cap / rate / allowlist → throws GuardError
③ errorHandler.run(          classify → retry/backoff/breaker/fallback/escalate
     skill.execute)
④ enforcer.verifyOrHeal      block-before-ship + bounded self-heal (unbypassable)
⑤ monitor.capture(trace) → return { output, verified, heals, checks, trace }
```

## When to use

Use it whenever an agent produces output that must be correct, calls flaky tools, or
handles untrusted input. Install it as a discovery skill (below), then either call the
CLI from your agent's shell or import `runHarnessed()` in code. For a hard guarantee,
wire `nim-skill enforce "<cmd>"` into a pre-commit hook or CI — the agent cannot skip it.

## CLI

```bash
nim-skill run "npm test" --enforce --monitor   # run a command inside the harness
nim-skill enforce "npm test"                    # unbypassable verify-gate (exit 1 on fail)
nim-skill monitor                               # local trace dashboard
nim-skill add all                               # install every primitive skill
```

## Hosts

Installable into any SKILL.md-reading agent host. `install` auto-detects your hosts
(`~/.claude`, `~/.kiro`, `~/.cursor`) and copies all skills into each:

```bash
# zero-config — detects installed hosts and installs everything
npx github:phamdat721101/nim-skill install

# target one host explicitly
nim-skill install --host claude        # or --host kiro | --host cursor

# specific primitives / custom directory
nim-skill add nim-enforcer --dir /path/to/skills

# manual drop-in (equivalent)
git clone https://github.com/phamdat721101/nim-skill ~/.claude/skills/nim-skill
```

After install, the host discovers each primitive and can invoke the CLI, or you import the
library directly. Codex (no SKILL.md system): use the CLI in scripts/CI or import the library.

## Input requirements

A `SkillDef` you pass to `runHarnessed(skill, input, ctx)`:
- `name` (string), `version` (string)
- `harness` (object) — any subset of `{ guard, errorHandler, enforcer, monitor }` (see schema)
- `execute(input, ctx)` — your logic; the harness supplies everything around it

`ctx` = `{ agentId: string }` (+ `_feedback` is injected on self-heal retries).

## Cross-links

- Source: <https://github.com/phamdat721101/nim-skill>
- PRD package: `docs/prd/`
- Anthropic Agent Skills: <https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills>
- MCP spec (P3): <https://modelcontextprotocol.io>
