---
name: nim-auditor
description: Task-scoped repeated-failure auditor. It blocks a fourth equivalent action after three failures and requires a structured alternative-action replan.
version: 0.17.0
author: phamdat721101
license: MIT
tier: primitive
parent: nim-skill
when_to_use: Prevent an agent from repeating a known failing action during a task.
---

# nim-auditor

When a lifecycle hook blocks an action, inspect its history and replan before continuing:

```bash
nim-skill auditor status --task <task-id> --json
nim-skill auditor replan --task <task-id> --fingerprint <fingerprint> \
  --root-cause "..." --alternative "..." --alternative "..." \
  --selected "..." --next-action "..."
```

State a testable root-cause hypothesis, give two genuinely different alternatives,
select one, and name a different next action. Do not repeat the blocked command.
