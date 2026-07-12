# 02 — Architecture + packaging

> How `nim-skill` is built, laid out, and shipped. Mirrors `goal-skill`'s proven packaging (npm + Anthropic Skill + MCP + CLI, host-delegated, MIT).

---

## Project layout (mirrors `goal-skill`)

```
nim-skill/
├── README.md                     # done (PRD status)
├── SKILL.md                      # top-level Anthropic Skill manifest (YAML frontmatter + sub_skills)
├── AGENTS.md                     # single-page architecture orientation for AI agents
├── package.json                  # bin: nim-skill ; npx-installable from github (prepare builds dist/)
├── .anthropic-skills.yaml        # anthropic-skills-registry publish manifest
├── clawhub.toml                  # ClawHub publish manifest
├── LICENSE                       # MIT
├── tsconfig.json · vitest.config.ts
├── src/
│   ├── harness/                  # runHarnessed() core (port HyperMove lib/harness/{runtime,types})
│   ├── error-handler/            # nim-error-handler (port observability/capture + classify/retry)
│   ├── enforcer/                 # nim-enforcer (port HyperMove output-enforcer)
│   ├── monitor/                  # nim-monitor (port observability/wrap + exporters)
│   ├── token-saver/              # inference-router + context-compressor  (P2)
│   ├── search/                   # semantic search backends: local/exa/keyword  (P2)
│   ├── guard/                    # cost cap + rate + allowlist + agentjacking + Zod
│   ├── cli.ts                    # nim-skill add|run|enforce|monitor|mcp
│   └── mcp.ts                    # MCP stdio server (exposes primitives as MCP tools)
├── skills/                       # one installable SKILL.md per primitive (drop into ~/.claude/skills/)
│   ├── nim-error-handler/SKILL.md
│   ├── nim-enforcer/SKILL.md
│   ├── nim-monitor/SKILL.md
│   ├── nim-token-saver/SKILL.md
│   ├── nim-search/SKILL.md
│   └── nim-guard/SKILL.md
├── schema/                       # JSON schemas: harness config, error, trace, verify-result
├── examples/                     # runnable examples (harness a task; enforce a test; route a call)
├── tests/                        # unit + e2e dogfood
└── docs/prd/                     # THIS PRD PACKAGE
```

## Runtime (recap from `01`)

`runHarnessed(skill, input, ctx)`: guard.validate → guard.checkPolicy → monitor.wrap( errorHandler.run( skill.execute ) ) → enforcer.verifyOrHeal → return. Each step is config-gated and a no-op when disabled (byte-identical rollback). **Seed = port HyperMove's shipped `src/lib/harness/{runtime,types,output-enforcer}.ts` + `observability/{capture,wrap,types}.ts`** — proven code, not from scratch.

## Packaging (4 surfaces, one codebase)

1. **npm / npx** — `npx github:phamdat721101/nim-skill …`; global install; project dep. `prepare` builds `dist/` on clone (no npm-publish gate needed, per goal-skill).
2. **Anthropic Skill** — one `SKILL.md` per primitive under `skills/`; `git clone … ~/.claude/skills/nim-skill` or `npx nim-skill add <primitive>` copies the SKILL.md into the host's skills dir. Installs into any of the 20+ SKILL.md-reading hosts.
3. **MCP** — `nim-skill mcp` (stdio) exposes the primitives as MCP tools for Cursor / Kiro / Hermes / OpenClaw / any MCP client.
4. **CLI** — `nim-skill add|run|enforce|monitor|route|search|mcp`.

## Config + local-first

- **Host-delegated by default**: uses the host's own LLM → **no API keys required** for the default path (guard/enforcer/monitor/error-handler all run locally; token-saver's compressor + search's local backend need no key).
- **Opt-in externals** (declared in `.env` / config): DeepSeek/LiteLLM (router cheap model), Exa (neural search), Sentry/OTel (monitor export). Absent → graceful fallback to host model / local search / console export.
- **Offline-capable**: the reliability trio (guard/error-handler/enforcer/monitor) works with zero network.

## Config file (`nim.json`) — declarative harness

```json
{
  "harness": {
    "guard":   { "maxCostUsd": 0.5, "ratePerMin": 30, "allowTools": ["*"] },
    "errorHandler": { "retries": 3, "backoff": "exp-jitter", "circuitBreaker": { "failN": 5 } },
    "enforcer": { "strategies": ["schema","test"], "maxHeals": 3, "strict": true },
    "monitor":  { "exporters": ["console"] },
    "tokenSaver": { "router": { "cheap": "deepseek-v4", "frontier": "host" }, "budget": 8000 },
    "search":   { "backend": "local" }
  }
}
```

## Feature flags / rollback

Each primitive is independently enable/disable (env or `nim.json`). Disabled → no-op passthrough. The whole harness off → runs the bare command unchanged. Matches HyperMove's `platform-flag.ts` discipline (default-safe, byte-identical rollback).

## Interop

- **goal-skill**: goal-skill's Worker/Judge/Loop sprint steps call `runHarnessed()` so each turn is guarded + monitored + output-verified.
- **HyperMove `/tools`**: HyperMove's server-side harness can `import { runHarnessed } from 'nim-skill'` as its runtime (open-core → hosted).
- **n-payment** (opt-in): only if a harnessed skill is monetized (settlement step, not in v0.x core).
- **brain-skill** (opt-in): durable memory/trace store for `nim-monitor`.
