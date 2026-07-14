# Changelog

All notable changes to `nim-skill`. Format loosely follows Keep-a-Changelog;
every layer is additive + config-gated (absent/`false` ⇒ byte-identical bare run).

## [0.3.0] — 2026-07-14 · `nim-cache` (provider-agnostic context caching)

### Added
- **`nim-cache`** — 5th token-efficiency layer (`harness.cache`). Cache-aware prompt
  assembly (stable content first as a reusable prefix, variable input last) + per-provider
  cache directives + a cache-ROI meter that proves tokens/dollars saved.
  - `ctx.cache.assemble(static, dynamic)` — prefix-first ordering, min-token floor gate,
    explicit markers where supported (Lever 2); `strategy:'prefix'` (default) is safe everywhere.
  - `ctx.cache.record(usage)` — folds the provider's cache-hit fields into `trace.cache`.
  - Provider adapters (one file, ~3 real code paths): Anthropic (+ MiniMax), Qwen, Gemini,
    implicit (OpenAI/GLM/DeepSeek); `provider:'auto'` detects from base-url/model; unknown
    fields degrade to 0-saved (`known:false`) instead of crashing.
  - **Break-even honesty**: `breakEvenOk=false` warns when reads/write < ~2; prices are
    estimates, user-overridable via `cache.prices`.
- `nim-skill monitor --cache` — hit-rate, tokens/dollars saved, break-even warnings.
- `schema/harness-config.json` + `examples/nim.cache.json` cover the full config surface.

## [0.2.1] — 2026-07-14 · isolation + memory + compact feedback

### Added
- **U2 execution isolation** (`harness.execution.isolate`) — run `execute` + heal retries
  against a cloned ctx so intermediate/retry state never leaks to the caller.
- **U4 `nim-memory-lite`** (`harness.memory`) — content-hash verify-result cache (skip
  re-verifying an unchanged output) + episodic priors; local JSONL, TTL'd, zero-network.
- **U5a compact heal-feedback** (`enforcer.healFeedback:'minimal'`) — structured
  `{rejected:[{strategy,reason}]}` instead of a prose dump.
- **U5b terminal-only serialization** (`toTerminal`) — TOON/TRON for one-shot terminal
  payloads only, enforced by `assertTerminal()` (JSON stays default mid-loop).

## [0.2.0] — 2026-07-13 · the "see" verb + token-ROI

### Added
- **U1 `nim-context`** (`harness.context`) — per-run token budget (`onExceed:
  warn|compact|block`), progressive disclosure, and `install --lean`.
- **U3 token-ROI accounting** (`monitor.tokenAccounting`) — measures tokens saved by
  guard denial / permanent-error classification / blocked-bad-output, emits
  `netTokens` (net-negative = savings). `nim-skill monitor --savings`.
- Shared approximate token estimator (`src/tokens.ts`).

## [0.1.0] — 2026-07-12 · reliability trio

### Added
- `runHarnessed()` core + `nim-guard`, `nim-error-handler`, `nim-monitor`, `nim-enforcer`.
- Config-gated `nim.json`; disabled layer ⇒ byte-identical bare run (rollback contract).
