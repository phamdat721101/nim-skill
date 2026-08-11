# 🛡️ Stop Your AI Agent From Burning Tokens on Logs — Meet `nim-skill`

If your coding agent chokes on `npm test` output or blows its budget reading `git diff`, this is for you. `nim-skill` is a **free, local-first harness** that wraps any agent task and makes it reliable *and* cheap — no API keys, no cloud, no framework rewrite.

Two features solve the exact pain most agent setups hit on day one: **noisy logs** and **runaway tasks**. Here's how to use them.

---

## 🚀 1. Quick Setup (2 minutes)

No install step needed — just run it:

```bash
npx github:phamdat721101/nim-skill install
```

- 🔍 Auto-detects your agent host (`Claude Code`, `Kiro`, `Cursor`)
- 📦 Drops all 14 primitives into the right skills folder
- 🔑 Zero API keys required — runs on your host's own LLM by default

Prefer a specific host or a one-off run?

```bash
nim-skill install --host kiro        # target one host
npx github:phamdat721101/nim-skill --help   # try before installing
```

That's it. You're harnessed.

---

## 🧾 2. Kill the Log Noise — `nim-logcompact`

**The problem:** running `npm test`, `git diff`, or any build command inside an agent dumps *thousands* of raw lines into its context. Measured data shows shell/log output eats **90%+ of tool-output tokens** — most of it noise the agent never needed.

**The fix — one flag:**

```bash
nim-skill run "npm test" --logcompact
```

What it does:
- ✂️ Keeps only the lines that matter (`ERROR`, `FAIL`, `FATAL`, `Exception`) + a little context around them
- 📉 Cuts token cost by **60–98%** on real logs, verified live
- 🛟 Never hides a real failure — if nothing matches, it falls back to a safe capped slice instead of going silent
- ✅ Plays nice with `--enforce` — your verify-gate checks the *same* compacted text you actually see

Want to see the savings?

```bash
nim-skill run "npm test" --logcompact --monitor
nim-skill monitor --logcompact
```

```
nim monitor (logcompact) — 1 run(s) with output compaction
  original chars:  2593
  compacted chars: 47
  avg reduction:   98%
```

**Use it whenever your agent shells out to something noisy** — tests, builds, `grep`, log tails.

---

## 🧠 3. Pause Before It Breaks Something — `nim-propose`

**The problem:** an agent that runs a risky task with zero human checkpoint is how you get a wiped database at 2am. Most setups have no gate for "did a human actually approve this plan?"

**The fix — a plan-first approval gate:**

1️⃣ Turn it on in `nim.json`:
```json
{ "harness": { "guard": { "propose": { "require": true } } } }
```

2️⃣ Propose the task:
```bash
nim-skill propose "add a database migration"
```
📝 Scaffolds a plan doc at `.nim/proposals/<hash>.md` — review it, edit it, add sections.

3️⃣ Approve it once you're happy:
```bash
nim-skill propose --approve <hash>
```

4️⃣ Now `nim-skill run` can execute:
```bash
nim-skill run "your command here"
```
🚫 Without an approved plan, every `nim-skill run` call is **blocked automatically** — `proposal_required`, no exceptions.

⚠️ **Know the current scope:** `nim-skill run`'s CLI wiring checks against one fixed task name (`cli.run`), not the specific command text — so today, one approval unlocks *every* `nim-skill run` call, not a specific command. The propose gate is fully per-task, though, when you call `runHarnessed()` from your own code with a real `skill.name` — that's the precise, per-task version of this same gate.

**Bonus — it learns you.** 🎓 Every approved plan is remembered (`.nim/owner-profile.jsonl`). If you always add a "Testing" section to migration-shaped tasks, the *next* similar proposal pre-fills it for you. Advisory only — it never skips the approval step itself.

Check the trail anytime:
```bash
nim-skill monitor --propose
```

---

## 💡 4. The 3 Habits That Make This Actually Work

- 🐢 **Turn on layers one at a time.** Start with `guard` + `enforcer`. Add `logcompact` once logs get noisy. Add `propose` once a task gets risky. Don't flip every switch on day one.
- 🔙 **Every layer is off by default and byte-identical when disabled.** If something feels wrong, delete its block from `nim.json` — you're instantly back to normal behavior. No migration, no risk.
- 📊 **Check the dashboard before you tune anything.** `nim-skill monitor --logcompact` and `nim-skill monitor --propose` read the same local trace file — the answer to "is this actually saving tokens?" is already sitting there.

---

## ⚡ TL;DR — Copy/Paste Starter Kit

```bash
# install
npx github:phamdat721101/nim-skill install

# run anything noisy, compacted
nim-skill run "npm test" --logcompact --monitor

# gate risky nim-skill run calls behind human approval (one approval unlocks all `nim-skill run` calls today;
# use runHarnessed() directly in your own code for per-task approval)
nim-skill propose "describe your task"
nim-skill propose --approve <hash>
nim-skill run "the risky command"

# see your savings
nim-skill monitor --logcompact
nim-skill monitor --propose
```

🔗 **Repo**: `github.com/phamdat721101/nim-skill` · **License**: MIT · **Cost**: $0, runs fully offline

If your agent setup burns tokens on logs or skips human review on risky tasks, this fixes both in under 5 minutes. 🎯
