---
name: nim-cache
description: |
  Provider-agnostic context-caching layer — cuts input cost 45–80% on long
  agentic runs. Assembles a cache-optimized prompt (stable content first as a
  reusable prefix, variable input last), emits the right cache directive per
  provider, and reads cache-hit fields back to prove tokens + dollars saved.
  Warns when a low hit-rate means cache writes are subsidizing waste.
version: 0.3.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Long, repeated static context (system prompt, docs, few-shot) re-sent per call.
  - Cut input cost with provider prompt/context caching, correctly, across providers.
  - Measure cache ROI and get warned below the break-even point.
install: npx github:phamdat721101/nim-skill add nim-cache
---

# nim-cache

nim-skill wraps your `execute` and has **no provider client** — so nim-cache gives
the skill a helper to *build* the cache-optimized request and *measure* the result;
the skill still makes its own API call.

```ts
// injected as ctx.cache when harness.cache is set:
const { payload, meta } = ctx.cache.assemble(staticBlocks, dynamicBlocks); // stable-first ordering + markers
const res = await yourModelCall(payload);   // your own API call
ctx.cache.record(res.usage);                 // → trace.cache: tokens/$ saved, hit-rate, break-even
```

The 2 levers:
- **Lever 1 (all providers)** — prefix ordering + min-token floor. Safe everywhere; default `strategy:'prefix'`.
- **Lever 2 (explicit)** — `cache_control` (Anthropic/MiniMax), explicit flag (Qwen), cached-content (Gemini). Set `strategy:'explicit'`.

Config (`nim.json` → harness.cache):
`{ provider: "auto", strategy: "prefix"|"explicit", ttl: "5m"|"1h", minTokens, roi: true, breakEvenReads: 2 }`.

⚠️ **Break-even honesty**: an explicit cache *write* costs a premium; below ~2 reads/write
you lose money. `monitor --cache` flags runs where `breakEvenOk=false`. Prices are estimates.

<!-- lean:cut -->

## Providers

| provider | strategy | markers | usage field(s) |
|---|---|---|---|
| anthropic / minimax | explicit | `cache_control:{ephemeral,ttl}` | `cache_read_input_tokens` / `cache_creation_input_tokens` |
| qwen | explicit | cache flag (1024 floor) | `prompt_tokens_details.cached_tokens` |
| gemini | explicit | cached-content ref | `cachedContentTokenCount` |
| openai / glm / deepseek | implicit | none (prefix only) | `prompt_tokens_details.cached_tokens` |
| auto | detect | from base-url/model | generic (safe fallback) |
