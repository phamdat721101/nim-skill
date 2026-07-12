# 03 — Gstack 15-frame + pre-mortem

## Gstack (Garry Tan)

| # | Frame | Score | Note |
|---|---|---|---|
| F1 | Cash flow > narrative | 2/3 | OSS core = **indirect** revenue (HyperMove `/tools` hosting, future `nim-cloud` managed harness, router/search markup, grants). Not a direct cash line — honest. |
| F2 | Convergence | 2/3 | Harness-engineering wave + agent-reliability wave converging; moderate, not a rare multi-trend spike |
| F3 | Asymmetric only-X | **3/3** | The only **portable + local-first + MIT** toolkit bundling all 6 reliability levers as drop-in skills across 20+ hosts (rivals each own one slice) |
| F4 | Leader in growing space | 2/3 | Pre-adoption; harness-engineering is a fast-growing, still-fragmented space to lead in |
| F5 | Anti-establishment authenticity | **3/3** | Local-first, no-lock-in, works offline, no SaaS required — against the hosted-black-box grain |
| F6 | Reflexive loop | 2/3 | `nim-monitor` metrics (verify pass-rate, heal count, tokens saved) feed harness tuning; strengthens with dogfood usage |
| F7 | Burden-of-proof inverted | **3/3** | Ship a dogfood run showing a blocked-bad-output + an error-class recovery + measured token cut — proof > pitch |
| F8 | Tail optionality | **3/3** | Same harness templates to any host + any vertical; `nim-cloud`, HyperMove adoption, per-primitive skills all open tails |
| F9 | Structural forcing | **3/3** | 41-86% multi-agent failure without recovery + 13%-vuln-skills + agentjacking + Context Rot = a harness is table-stakes for production agents |
| F10 | Convenience moat | 2/3 | `npx nim-skill add …` + host-delegated no-keys is convenient; moat is DX quality (must beat stitching Guardrails+Sentry+WorkOS yourself) |
| F11 | Composability | **3/3** | Composes with goal-skill (missions run inside harness), HyperMove `/tools` (adopts as runtime), n-payment (settlement), brain-skill (memory) |
| F12 | Contrarian-defensible | **3/3** | Bets on "the harness, not the model, is the bottleneck" (Medium/Augment/arXiv thesis) — a defensible, durable layer as models commoditize |
| F13 | Low-float | n/a | No token |
| F14 | Rebalancing | 2/3 | New OSS project alongside goal-skill + HyperMove; shared harness code reduces net portfolio cost |
| F15 | Anti-establishment OSS | **3/3** | MIT, open skill.md format, no lock-in, self-hostable |

**Aggregate ≈ 41/45 on 14 relevant frames (F13 n/a).** Strong: F3/F9/F11/F12/F15. Honest weak spot: **F1 (indirect cash)** — nim-skill is infra/distribution/credibility, monetized downstream via HyperMove + nim-cloud, not a direct revenue product like the XRPL-skill $5/mo tier. Path to 43-44/45: F1→3/3 once nim-cloud or router-markup revenue is live; F4→3/3 with ≥3 external adopters.

## Pre-mortem (Tigers / Paper Tigers / Elephants)

**🐯 Tigers (real)**
- **T1 — Scope sprawl (6 primitives, solo, HIGH).** Mitigation: **phase it** — P1 = reliability trio (harness + error-handler + enforcer + monitor + guard); P2 = token-saver + search; P3 = publish. Don't build all 6 before shipping value.
- **T2 — "Why not LangChain / Guardrails-AI / Sentry / WorkOS?" (MED).** Each owns a slice; nim-skill's diff is bundle + local-first + skill-format + host-portability. **Risk**: if it's a thin wrapper it dies. Mitigation: the `runHarnessed()` DX + one-command install + genuinely-better-together must be real; ship a proof (F7).
- **T3 — Enforcer false-positives block good output (MED).** Mitigation: tunable strictness (`strict|warn|off`) + explained-diff + `maxHeals` budget.
- **T4 — Pham solo, project #4 on the pile (MED).** Mitigation: **port HyperMove's already-shipped harness + observability** as the seed (proven code, ~50% of P1); reuse goal-skill's packaging scaffolding verbatim.
- **T5 — Token-saver/search depend on external APIs (DeepSeek/Exa) — cost/latency/availability (LOW-MED).** Mitigation: local-first defaults; externals opt-in with graceful fallback; these are P2 (after the reliability core proves out).

**🦸 Paper Tigers (overblown)**
- "Models will get reliable enough to not need a harness" — the thesis (and 2026 data) says the opposite: capability rose *and* failure rates stay high without recovery discipline.
- "Just prompt the agent to verify its own output" — that's *instruct*, not *enforce*; the whole point is the agent can't skip it.
- "Nobody installs another CLI" — it's SKILL.md/MCP drop-in into hosts they already use, not a new runtime.

**🐘 Elephants (unspoken)**
- Is nim-skill just HyperMove's harness extracted? — **Yes, deliberately**: OSS upstream core vs hosted product. The honest question is whether the OSS/hosted split is worth maintaining two things; answer: shared code, different jobs (library vs marketplace).
- Solo maintenance of a runtime + 6 skills across host churn (SKILL.md/MCP spec drift) — real ongoing cost; phasing + reuse mitigates but doesn't erase it.
- Monetization is indirect — must be honest that this is a credibility/distribution/infra bet, not a Q3 cash line.

**Weighted pre-mortem ≈ 3.6/15 — below the 6/15 ship-it threshold**, conditional on **phasing P1 first** and **porting the HyperMove harness seed** (both de-risk T1 + T4, the two highest).
