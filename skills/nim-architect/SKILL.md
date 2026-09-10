---
name: nim-architect
description: Local-first TypeScript system architecture review and design: grounding, Design Twice sketches, AST depth scoring, red-flag audits, durable decisions, and delivery compilation.
version: 0.18.0
---

# nim-architect

Use `nim-skill architect` to ground a TypeScript workspace, create two design alternatives, score module interface depth, audit deterministic design red flags, persist settled `D<N>` decisions, and compile the result into `nim-deliver` artifacts.

```bash
nim-skill architect ground src --query "architecture boundary"
nim-skill architect sketch "payment settlement workflow"
nim-skill architect score src/service.ts
nim-skill architect audit src/service.ts
nim-skill architect compile --feature payment-architecture
```

The CLI is provider-neutral: it never stores credentials or contacts model providers. Library callers may pass an `ArchitectCritique` callback to `sketchArchitecture()` for optional critique. TypeScript and TSX are supported mechanically; other file types are reported but not analyzed.
