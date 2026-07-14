# nim-skill workspace tracker — `/Users/phamdat/pqd`

> **nim-skill is the tracking hub for the `pqd` workspace.** This file indexes every project under `/Users/phamdat/pqd` — its purpose, repo, git state, and whether it's on the first-dollar path.
> **Tracking mode**: manual index now. **`nim-monitor` (run-trace) is BUILT** as of P1 (traces harnessed *runs* — duration/status/verify/heal/error-class → console/file/Sentry). A **`nim-skill track ../` git-repo scanner** (auto-index sibling repos' git activity) is the remaining add — see roadmap below.
> Last refreshed: 2026-07-12 (post-P1 ship).

## Projects

| Project | Repo | Purpose | Status | Last commit | On first-$ path? |
|---|---|---|---|---|---|
| **nim-skill** | [`nim-skill`](https://github.com/phamdat721101/nim-skill) | Agent-harness toolkit (guard · error-handler · monitor · enforcer · context · memory · cache). The OSS harness HyperMove `/tools` productizes; the hub. | 🟢 **active — v0.3 shipped** (reliability trio + v0.2 token-efficiency [context/memory/isolation/token-ROI] + v0.3 `nim-cache`; **121 tests**, ~93% cov; installable) | 2026-07-14 | Indirect — infra/credibility; monetized via HyperMove hosting / nim-cloud (see PRD §8) |
| **goal-skill** | [`goal-skill`](https://github.com/phamdat721101/goal-skill) | Goal orchestrator — `/goal` (single sprint) + `/achieve` (3-4wk mission, Worker/Judge/Loop). | 🟡 dormant | 2026-05-25 | Indirect — composes with nim-skill (missions run *inside* the harness) |
| **nim-blog** | [`leo-book`](https://github.com/phamdat721101/leo-book) | Blog/agent — agentic-market scanning + content submission pipeline. ⚠️ 1 uncommitted file. | 🟡 dormant | 2026-05-20 | No — content/distribution surface |
| **phamdat721101** | [`phamdat721101`](https://github.com/phamdat721101/phamdat721101) | GitHub profile / proof-of-work README. | 🟡 dormant | 2026-03-15 | No — credibility surface |

## How the pieces relate

```
nim-skill (harness hub)
  ├── goal-skill  → missions run INSIDE nim-skill's runHarnessed() (guarded, monitored, output-verified)
  ├── nim-blog    → distribution surface; can be a harnessed content agent
  └── phamdat721101 → proof-of-work; links out to nim-skill + goal-skill
        │
        └── (outside pqd) HyperMove /tools adopts nim-skill as its harness runtime;
            n-payment settles harnessed-skill payments; bd-team writes the PRDs.
```

## Attention / next actions (tie to the first-dollar week — `bd-team/_brain/next-week-focus.md`)
- **nim-skill**: **P1 shipped** (reliability trio, 85 tests). Per the first-dollar freeze rule, **P2 (`nim-token-saver` + `nim-search`) and P3 (MCP + registry publish) wait** until a dollar moves — the priority is getting P1 *used* + adopted by HyperMove `/tools`, not building more.
- **nim-blog**: commit or discard the 1 uncommitted file (housekeeping).
- **goal-skill / phamdat721101 / nim-blog**: dormant — no action unless they serve the first-dollar path; do NOT reactivate for their own sake.

## How to add a project to the tracker
1. Drop the repo under `/Users/phamdat/pqd/`.
2. Add a row above (name · repo · purpose · status · last commit · first-$ relevance).
3. (Future) `nim-monitor` auto-discovers repos in `pqd/` and appends git-activity + run traces.

## Auto-tracking roadmap (`nim-skill track ../`)
`nim-monitor` already traces **harnessed runs** (P1, shipped). The remaining add is a **git-repo scanner**: a `nim-skill track ../` command that scans sibling repos in `pqd/`, pulls `git log` deltas, surfaces uncommitted/dirty state, and appends to this table — turning this manual index into a live dashboard. Small, self-contained; slot it after the first-dollar goal moves (freeze), or as a quick housekeeping add since the monitor plumbing already exists. Until then, refresh this table manually at the weekly cash-gate.
