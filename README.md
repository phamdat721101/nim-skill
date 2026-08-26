# `nim-skill`

Local-first harness tools for reliable agent work.

- Guard unsafe input and policy violations.
- Recover from expected failures.
- Verify output before it ships.
- Preserve useful memory and compact noisy logs.
- Keep a workspace ready for the next agent.

**Status:** 19 primitives are shipped and installable, including local memory search, safe distillation, and read-only global-memory drift audits. `nim-throttle` (v0.16.0 — trajectory step ceiling, checkpoint handoff, read-slice clamping, and a token-burn dashboard) is implemented and CLI-usable today; its `skills/nim-throttle/SKILL.md` install manifest is not shipped yet, so use it directly via `nim-skill throttle`/`run --throttle`/`monitor --tokens` in this repo.

## Start here

Install every skill into detected hosts:

```bash
npx github:phamdat721101/nim-skill install
```

Create an agent-ready project workspace:

```bash
nim-skill workspace init
nim-skill workspace feature "payments"
nim-skill workspace handoff \
  --goal "implement payments" \
  --output "tests pass" \
  --next "open a PR"
```

Run a command through the harness:

```bash
nim-skill run "npm test" --enforce --monitor
nim-skill run "npm test" --logcompact
nim-skill enforce "npm test"
```

## Use nim-skill effectively

Follow this loop for each meaningful task:

```text
Read project state
      |
      v
Plan the smallest safe change ----> nim-skill propose (when approval is required)
      |
      v
Run work through the harness
      |
      +--> guard: reject unsafe input, policy, budget, or approval failures
      +--> error handler: retry, back off, fall back, or escalate
      +--> context + logcompact: keep useful signal, drop noisy output
      +--> memory: reuse verified results and relevant local priors
      |
      v
enforcer verifies output ---- fail --> bounded heal or block shipping
      |
      v
Run tests and enforce the result
      |
      v
Append workspace handoff --> next agent resumes from the final snapshot
```

### Recommended task flow

1. Read `AGENTS.md`, `CONSTITUTION.md`, the relevant feature brief, and the last handoff.
2. Run `nim-skill workspace check <path>` before a material write when workspace guarding is enabled.
3. Use `nim-skill propose "<task>"` when `guard.propose.require` is enabled.
4. Run commands with `--logcompact` when output can be large.
5. Use `nim-skill enforce "<test command>"` before declaring success.
6. Record the handoff with goal, output, blocker, attempts, and next step.
7. Run `nim-skill workrule check` before and after multi-file edits.

### Break error-retry loops with a remediation prompt

An agent stuck retrying the same failed tool call usually knows *that* it
failed, not *what to do differently*. `nim-error-handler`'s classified errors
can carry a derived `actionRequired` instruction — feed it straight into the
agent's next turn instead of repeating the same call unchanged:

```ts
const res = await recover(() => doWork(), policy);
if (!res.ok && res.error.actionRequired) {
  // 👉 hand this to your next prompt/turn instead of retrying blindly
  console.log(`Next step: ${res.error.actionRequired}`);
}
```

Pair it with `nim-workspace`'s opt-in `strictPlanMode` (one `[Active]` goal
at a time, no silent backtracking on a `[Closed]` one) to stop an agent from
quietly abandoning the current goal instead of trying the suggested fix.

Don't want to touch code at all? The same rules also work as a **pure
system prompt** — a fixed error-log format, a remediation table, and a
loop-breaking rule, no install required:
[`docs/share-nim-remediation-loop.md`](./docs/share-nim-remediation-loop.md).

### Manage a large project's working process + query its data

On a big, long-lived codebase the risk isn't bad code — it's losing track
of state: unbroken 200+ step turns that quietly balloon cost, 700-line
files read in full when 40 lines would do, and answering "did we already
hit this?" from memory instead of checking `.nim/lessons.jsonl`.

```bash
nim-skill throttle check                 # trajectory ceiling + read-slice policy
nim-skill run "npm test" --throttle       # auto-compact noisy test/build output
nim-skill monitor --tokens                # rank tasks by cache-read volume + cost
nim-skill search "payment rail crash" --files .nim/lessons.jsonl
```

`nim-throttle` forces a 3-line checkpoint handoff once a turn hits its step
ceiling (default 20), instead of letting one unbroken turn run indefinitely
and re-read an ever-growing context. Full walkthrough:
[`docs/share-nim-throttle-large-project-workflow.md`](./docs/share-nim-throttle-large-project-workflow.md).

## Configure the harness

Every layer is opt-in. Omit a block or set it to `false` for a byte-identical no-op.

```jsonc
{
  "harness": {
    "guard": {
      "injection": "strict",
      "taskBudgetUsd": 5,
      "maxDurationMs": 300000
    },
    "enforcer": {
      "strategies": ["nonempty"],
      "mode": "strict",
      "maxHeals": 1
    },
    "memory": {
      "verifyCache": true,
      "priors": true
    },
    "context": {
      "progressive": true,
      "maxInputTokens": 8000,
      "onExceed": "compact"
    },
    "logCompact": {
      "strategy": "errors-only",
      "maxLines": 100,
      "artifactDir": ".nim/log-artifacts"
    },
    "search": {
      "topK": 3
    },
    "compact": {
      "maxInvariants": 10
    }
  },
  "workspace": {
    "livenessFile": "docs/state/active_session.md",
    "mode": "warn"
  },
  "workrule": {
    "logFile": ".nim/agent-support-log.md"
  },
  "globalmem": {
    "declarations": []
  }
}
```

### Layer order

```text
input
  -> guard.validate + guard.checkPolicy
  -> errorHandler.run(skill.execute)
  -> enforcer.verifyOrHeal
  -> monitor.capture
  -> { output, verified, heals, checks, trace }

optional helpers available to execute():
  ctx.context | ctx.memory | ctx.cache | ctx.lessons | ctx.logCompact | ctx.search | ctx.compact
```

## 🧠 Memory and search for agent teams

Use the memory loop to retrieve the right local evidence instead of adding every past log to every prompt.

- 🔎 Search prior decisions, incidents, lessons, and handoffs:

  ```bash
  nim-skill search "payment rail crash" --files .nim/lessons.jsonl docs/state/active_session.md --top-k 3
  ```

- 🧹 Distill a caller-reviewed JSON candidate into a separate sibling file. The append-only source is never edited:

  ```bash
  nim-skill compact apply --source .nim/agent-support-log.md \
    --output .nim/agent-support-log.distilled.md --candidate candidate.json
  ```

- 🧾 Run noisy commands with `--enforce --logcompact`; when `artifactDir` is configured, truncated raw output has a local `artifact://…` pointer.

- 🧭 Audit deliberately duplicated project guidance without automatically copying it:

  ```bash
  nim-skill globalmem audit --name team-rules
  ```

Prompt guideline: **search first, read only the top relevant chunks, verify against source and tests, then record a concise durable lesson or handoff.** Keep secrets and chat transcripts out of memory files; treat search results as leads, not proof.

## Daily commands

| Need | Command |
| --- | --- |
| Verify a command cannot ship on failure | `nim-skill enforce "npm test"` |
| Run with compact output | `nim-skill run "npm test" --logcompact` |
| See local reliability data | `nim-skill monitor` |
| See log-compaction savings | `nim-skill monitor --logcompact` |
| Start a safe workspace | `nim-skill workspace init` |
| Make a feature brief | `nim-skill workspace feature "name"` |
| Save a durable handoff | `nim-skill workspace handoff --goal ... --output ... --next ...` |
| Check a proposed write | `nim-skill workspace check path/to/file` |
| Require an approved plan | `nim-skill propose "task"` then `nim-skill propose --approve <hash>` |
| Create a delivery-ready feature proposal | `nim-skill deliver propose "task"` |
| Run the pre-delivery gate | `nim-skill deliver check --profile qa --brief docs/features/<feature>.md --phase pre` |
| Record deployment evidence | `nim-skill deliver record --profile qa --evidence qa-evidence.json` |
| Run the post-delivery gate | `nim-skill deliver check --profile qa --brief docs/features/<feature>.md --phase post` |
| Self-check an editing session | `nim-skill workrule check` |
| Check the trajectory/read-clamp policy | `nim-skill throttle check` |
| See token/cache burn ranked by task | `nim-skill monitor --tokens` |

## Workspace tutorial

`workspace init` creates only missing files. It never replaces a constitution,
feature brief, state file, or existing `nim.json`.

```text
project root
├── CONSTITUTION.md              immutable project rules + definition of done
├── docs/
│   ├── features/<feature>.md    one vertical slice: boundaries, data, path, criteria
│   └── state/active_session.md  append-only handoffs; final session is current
└── nim.json                     enabled harness layers
```

For a brownfield repository, `init` detects standard manifests and marks uncertain
facts as `REVIEW REQUIRED`. For a greenfield repository, it creates a reviewable
starter constitution. In both cases, a human confirms the constitution before
feature work begins.

## Deliver a feature to an end client

`nim-deliver` makes “done” mean more than a passing build. It requires a client
outcome, an explanation of why the selected approach was chosen, explicit
environment assumptions, verification, and (after release) independently sourced
evidence that the delivered feature is healthy.

Start with a delivery brief and human approval:

```bash
nim-skill deliver propose "Customer payment notifications"
# Fill in docs/features/customer-payment-notifications.md.
nim-skill propose --approve <proposal-id>
```

Enable a profile in `nim.json`. Contracts are JSON and contain only names and
policy—not secret values. TLS hostname verification may use a provider endpoint
or a documented certificate-SAN policy; disabling it always fails the gate.

```jsonc
{
  "workspace": {
    "deliver": {
      "mode": "strict",
      "briefDir": "docs/features",
      "requireWorkrule": true,
      "profiles": {
        "qa": {
          "contract": ".nim/deliver/qa-contract.json",
          "configFiles": ["config/application-qa.yml"],
          "commands": ["npm test"],
          "evidenceFile": ".nim/deliver/qa-evidence.json"
        }
      }
    }
  }
}
```

Example `.nim/deliver/qa-contract.json`:

```json
{
  "secrets": [{ "key": "APP_REDIS_PASSWORD", "binding": "app.redis.password" }],
  "tls": [{ "host": "redis.cache.amazonaws.com", "ssl": true, "verification": "provider-endpoint" }],
  "collateral": []
}
```

Before handoff, add a WR-06/WR-07 support-log entry after the delivery primitive
has meaningfully helped the task, then run the pre-delivery gate:

```bash
nim-skill workrule log --primitive nim-deliver \
  --effect "verified the QA delivery contract" --resolution-type mitigation
nim-skill deliver check --profile qa \
  --brief docs/features/customer-payment-notifications.md --phase pre
```

After deployment, save independent evidence rather than a self-reported success
claim. The evidence JSON must include `source`, `buildId`, `target`, `timestamp`,
`health`, and `clientAcceptance`.

```bash
nim-skill deliver record --profile qa --evidence qa-evidence.json
nim-skill deliver check --profile qa \
  --brief docs/features/customer-payment-notifications.md --phase post
```

Unchanged passing inputs use the existing local memory cache. Command output is
compacted and secret-redacted before it is included in a failure report. The gate
never reads cloud secret values, calls DNS, deploys software, or contacts external
services by default.

### E2E feature discipline

For non-trivial features, extend the same `nim-deliver` surface with a System Map,
five seam-anchored failure cases, and executable local proof before marking work done:

```bash
nim-skill deliver map --feature customer-payment-notifications --type feature
# Fill the fenced `json nim-deliver` block, then set status to Approved.
nim-skill deliver chaos --map docs/features/customer-payment-notifications-map.md
nim-skill deliver verify --map docs/features/customer-payment-notifications-map.md
```

`workspace.deliver.e2e` is disabled by default. When enabled with a `featureId`
and strict workspace hooks, writes under configured code paths are denied until the
matching System Map is approved. This hard gate is available only on hosts that
install the existing workspace hook adapter; other hosts can still run the CLI
workflow and verification commands.

## Installable primitives

| Primitive | Use it for |
| --- | --- |
| `nim-guard` | Input validation, injection defense, policy, budget, and approval gates. |
| `nim-error-handler` | Error classification, retry, backoff, circuit breaker, fallback, escalation. |
| `nim-monitor` | Local traces, dashboards, token and cache ROI. |
| `nim-enforcer` | Nonempty, JSON, schema, math, test, lint, command, and evidence gates. |
| `nim-context` | Input-budget warnings, blocks, compaction, and progressive disclosure. |
| `nim-cache` | Provider-aware prompt-cache assembly and cache ROI. |
| `nim-baseline` | Agent-memory-file lint, scaffold, and structure audit. |
| `nim-index` | Tool and skill disclosure-token measurement. |
| `nim-profile` | Model-tier detection and reliability tightening. |
| `nim-workspace` | Workspace bootstrap plus identity, existence, and liveness checks. |
| `nim-lessons` | Local lessons from similarly shaped failed actions. |
| `nim-workrule` | Seven-rule editing and pre-delivery self-check with a local support log. |
| `nim-logcompact` | Error-preserving shell and tool-output compaction. |
| `nim-propose` | Explicit pause, human approval, and owner-profile plan scaffolding. |
| `nim-grill` | Structured design interrogation and enforcer-verified PRD compilation. |
| `nim-deliver` | Product-owner delivery contract, rationale, environment readiness, and post-delivery proof. |
| `nim-search` | Header-aware local BM25 recall over memory, lesson, and archive files. |
| `nim-compact` | Strict candidate validation and separate distilled-memory artifacts; source logs remain immutable. |
| `nim-globalmem` | Read-only hash audit for drift across declared local memory copies. |

`ctx.memory` is a harness helper, not a separate installable skill. Enable it for
the local verify-result cache and episodic priors shown in the configuration example.

`nim-search` supersedes the unbuilt PRD-13 target corpus with the memory/lesson/archive corpus in PRD 20.

## Use from TypeScript

```ts
import { runHarnessed } from 'nim-skill';

const result = await runHarnessed(skill, input, ctx);
// { output, verified, heals, checks, trace }
```

Author `execute()`. The harness owns the surrounding reliability layers.

## Install targets

`nim-skill install` detects Claude, Kiro, Cursor, and Codex skill directories.

```bash
nim-skill install --host claude
nim-skill install --host kiro
nim-skill install --host cursor
nim-skill install --host codex
nim-skill add nim-enforcer --dir /path/to/skills
```

## Agent reading order

1. [AGENTS.md](./AGENTS.md) for project rules and architecture.
2. [SKILL.md](./SKILL.md) for the portable skill contract.
3. `docs/prd/` for design records and accepted decisions.
4. `skills/<primitive>/SKILL.md` only when that primitive matches the task.
5. The relevant `nim.json` block before enabling or changing behavior.

## Project links

- [Source repository](https://github.com/phamdat721101/nim-skill)
- [PRD package](./docs/prd/)
- [Schema files](./schema/)
- [Workspace tracker](./TRACKER.md)
- License: MIT
