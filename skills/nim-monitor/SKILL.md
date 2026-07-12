---
name: nim-monitor
description: |
  Observability for agent runs: trace every execution (skill, duration, status,
  verify pass/fail, heal count, error class) to pluggable sinks (console, file
  JSONL, opt-in Sentry). Non-blocking; zero network on the default path.
version: 0.1.0
author: phamdat721101 (PhamDat / @nxNim9)
license: MIT
tier: primitive
parent: nim-skill
when_to_use: |
  - Trace agent runs (latency, status, verify/heal, error class).
  - Export traces to a local JSONL file and view a terminal dashboard.
  - Optionally forward error traces to Sentry.
install: npx github:phamdat721101/nim-skill add nim-monitor
---

# nim-monitor

```ts
import { createMonitor, wrap } from 'nim-skill';
const monitor = createMonitor(resolvedMonitorConfig);
const value = await wrap(monitor, 'my-skill', () => doWork());
```

Config (`nim.json` → harness.monitor): `{ exporters: ["console"|"file"|"sentry"], traceFile }`.
Dashboard: `nim-skill monitor --file .nim/traces.jsonl`.
