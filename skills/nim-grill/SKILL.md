---
name: nim-grill
description: |
  Iterative interrogation loop that transforms an agent into an active engineering
  supervisor. Probes every branch of a design tree (x402 stablecoin payment
  gateways, XLS-65 Single Asset Vault schemas, or custom domains), resolves
  decisions one by one, and compiles the dialogue into an immutable PRD with strict
  acceptance criteria — enforcer-verified before ship. Built on four nim-skill
  primitives: enforce (schema gate, self-heal), memory (prior-session seeding +
  verify-cache), logCompact (context file compression), and workrule (WR-06 log).
  Zero LLM calls inside the primitive — prompt-only, local-first.
version: 0.10.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
install: npx github:phamdat721101/nim-skill add nim-grill
when_to_use: |
  - Audit an x402 stablecoin payment gateway end-to-end (HTTP 402 headers, ERC-3009/Permit2, facilitator trust model).
  - Review an XLS-65 Single Asset Vault schema (MPT share issuance, VaultCreate/Set/Deposit atomicity, lending decoupling).
  - Systematically resolve every architectural decision in a design tree before building.
  - Compile a team-shared, immutable PRD from a structured interrogation session.
  - Keywords: grill, interrogate, design review, x402, xls65, ERC-3009, Permit2, MPT, vault, PRD compile.
domains:
  - x402: HTTP 402 payment protocol + ERC-3009/Permit2 authorization (12 questions)
  - xls65: XLS-65 Single Asset Vault + MPT + lending adapter (10 questions)
  - custom: Generic security + architecture fallback (3 questions + extensible)
cli:
  grill_start: nim-skill grill start --domain x402|xls65|custom [--context <file>]
  grill_next: nim-skill grill next [-n 5]
  grill_answer: nim-skill grill answer --id <id> --answer <text>
  grill_status: nim-skill grill status
  grill_compile: nim-skill grill compile [--workrule-log] [--force]
harness_integration:
  ctx_grill: injected when harness.grill is configured in nim.json
  enforcer: schema strategy verifies sessionId + resolvedDecisions + acceptanceCriteria
  memory: verifyCache short-circuits unchanged PRD re-verification; priors seed prior-domain Q&A
  logCompact: applied to --context file before question seeding
  workrule: --workrule-log appends WR-06 entry to .nim/agent-support-log.md
storage:
  sessions: .nim/grill/<session-id>.jsonl
  prd: .nim/grill/<session-id>-prd.md
---

# nim-grill — Grill-Me Skill

An iterative interrogation primitive for nim-skill. Start a session, answer
questions one branch at a time, then compile an enforcer-verified PRD.

## Quick Start

```bash
# Install
npx github:phamdat721101/nim-skill add nim-grill

# Start an x402 session (12 questions across 3 branches)
nim-skill grill start --domain x402

# Get first batch of questions (with architectural recommendations)
nim-skill grill next

# Answer a question
nim-skill grill answer --id x402-001 --answer "Using ERC-3009 nonces, verified on-chain before facilitator relay"

# Check progress
nim-skill grill status

# Compile PRD when ≥10 questions are resolved (+ WR-06 log)
nim-skill grill compile --workrule-log
```

## Session flow

```
① grill start   Creates .nim/grill/<id>.jsonl, loads question bank
② grill next    Emits ≤5 unresolved questions with recommendations
③ grill answer  Appends answer event, marks question resolved
   ↑ repeat until status.complete = true
④ grill compile Runs compilePRD() inside runHarnessed():
                  → enforcer verifies schema (sessionId, resolvedDecisions, acceptanceCriteria)
                  → memory caches verify result (no re-verification on unchanged PRD)
                  → writes .nim/grill/<id>-prd.md
                  → optionally appends WR-06 entry
```

## nim.json harness.grill config

```json
{
  "harness": {
    "grill": {
      "store": ".nim/grill",
      "domain": "x402",
      "questionsPerBatch": 5,
      "minResolved": 10
    }
  }
}
```

Set `grill: false` to disable `ctx.grill` injection (byte-identical-off).

## ctx.grill API (inside runHarnessed())

```ts
import { runHarnessed } from 'nim-skill';

const result = await runHarnessed(skill, input, ctx);
// ctx.grill is injected when harness.grill is configured

async function execute(input, ctx) {
  // Check progress
  const { resolved, total, complete } = ctx.grill.status();

  // Get next unresolved questions
  const questions = ctx.grill.next();

  // Compile when ready (enforcer-verified before return)
  if (complete) {
    const prd = ctx.grill.compile();
    return { prd };
  }
}
```

## Extending question banks

Place a JSON file at `.nim/grill/questions/<domain>.json`:

```json
[
  {
    "id": "custom-001",
    "branch": "my_branch",
    "text": "What is your error recovery strategy?",
    "recommendation": "Use exponential backoff with jitter..."
  }
]
```

Custom questions merge with the built-in bank (built-in first).

## Design invariants

- **Prompt-only**: zero LLM calls inside the primitive. The host agent runs the generated question prompts.
- **Local-first**: no network calls; all state in `.nim/grill/`.
- **Byte-identical-off**: when `grill: false` or absent, the primitive contributes zero overhead.
- **Enforce-before-ship**: the compiled PRD is schema-verified by nim-enforcer before the markdown file is written.
- **JSONL append-only**: session files are never mutated after creation; event replay reconstructs state.
