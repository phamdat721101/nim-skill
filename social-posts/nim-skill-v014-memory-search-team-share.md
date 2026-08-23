# 🧠 Give Your Agent Team Useful Memory — Without a Vector DB or Shared Cloud

Agents do not need every old log in every prompt. They need the **right local evidence** when a familiar problem returns.

`nim-skill` v0.14 adds a small, local-first memory loop for project teams: search prior decisions, preserve an audit trail, and spot drift between intentional copies.

---

## ✨ 1. The memory loop

- 🔎 **`nim-search`** finds relevant sections in Markdown, lesson, and archive files with header-aware BM25 search.
- 🧹 **`nim-compact`** turns a caller-reviewed candidate into a separate, bounded distilled file. The original session or lesson log is never rewritten.
- 🧾 **`nim-logcompact`** keeps noisy command output out of context and can retain a local `artifact://…` pointer when truncation happens.
- 🧭 **`nim-globalmem`** hashes declared copies across local projects/hosts and reports drift. It never auto-merges or syncs files.

## 🚀 2. Start with a project workspace

```bash
nim-skill workspace init
```

Keep the team’s durable material close to the repo:

- 📌 `AGENTS.md` or `CLAUDE.md` — short operating rules and links, not a growing transcript.
- 🗂️ `docs/state/active_session.md` — append-only handoffs.
- 🧠 `.nim/lessons.jsonl` and `.nim/agent-support-log.md` — structured mistakes and support evidence.
- ✨ `.distilled.md` siblings — curated invariants for prompt setup.

## ⚙️ 3. Enable the local loop

```jsonc
{
  "harness": {
    "memory": { "verifyCache": true, "priors": true },
    "search": { "topK": 3 },
    "compact": { "maxInvariants": 10 },
    "logCompact": {
      "strategy": "errors-only",
      "maxLines": 100,
      "artifactDir": ".nim/log-artifacts"
    }
  },
  "globalmem": {
    "declarations": [
      { "name": "team-rules", "paths": ["/repo-a/AGENTS.md", "/repo-b/AGENTS.md"] }
    ]
  }
}
```

## 💬 4. Put this in the agent prompt

```text
Before planning or editing, search the project memory for prior decisions and failures.
Read only the highest-ranked relevant chunks. Treat search results as evidence, then verify against source and tests.
After a meaningful failure or decision, append a concise lesson/handoff. Distill growing logs into a separate curated file; never rewrite the source.
```

## 🛠️ 5. Daily team commands

```bash
# Find the prior incident or decision
nim-skill search "payment rail crash" --files .nim/lessons.jsonl docs/state/active_session.md --top-k 3

# Keep command noise lean and enforce a useful result
nim-skill run "npm test" --enforce --logcompact

# Audit intentionally duplicated team guidance
nim-skill globalmem audit --name team-rules
```

## ✅ 6. Team rules that keep memory effective

- 🎯 Search first; do not preload entire histories into every prompt.
- ✍️ Log durable causes, decisions, and fixes—not chat transcripts or secrets.
- 🧪 Treat memory as a lead, never proof: confirm with source, `git diff`, and tests.
- 🔒 Keep everything local by default; declare cross-project files explicitly.
- 🚫 Do not use `nim-globalmem` as a sync tool. Resolve drift deliberately with a human owner.

**Result:** agents start with less noise, recover prior project knowledge faster, and leave the next teammate a verified trail. 🌱
