# 🛡️ Nim-Skill v0.8: Run AI Agent Tasks on a Budget, With a Clock

Every agent task should have two numbers attached before it runs: **how much it can spend**, and **how long it can take**. Most agent harnesses skip both. Nim-Skill's `nim-guard` v0.8 adds both — for free, config-only, zero new dependencies.

Here's how it works and why it matters.

---

## 💸 The problem it solves

- An agent task with no cost ceiling can burn $50 on a retry storm before anyone notices.
- An agent task with no time ceiling can hang for 20 minutes on one stuck tool call.
- Existing safety nets (rate limits, cumulative cost caps) catch *slow* abuse across many runs — not *one* runaway run right now.

Nim-Skill closes both gaps in one place: `nim-guard`.

---

## 🎯 What you get, in plain terms

**1. A per-task spending cap ($5 default)**
- Set it in dollars: `taskBudgetUsd: 5`
- Or set it in token-credits instead: `taskBudgetTokens: 1000000`
- Pick one — not both (the config rejects setting both at once).
- Checked **before** the task runs (a quick size estimate) AND **during** the run, if your code opts in to reporting real spend.

**2. A per-task duration cap (5 minutes default)**
- Set it once: `maxDurationMs: 300000`
- The clock starts the moment the task starts, resets every run.
- If the task runs past the cap, the harness marks it as `timeout` and moves on — no manual kill required.

**3. Both are additive, not replacements**
- Your existing cumulative cost cap (`maxCostUsd`, cumulative across an agent's whole session) keeps working exactly as before.
- The new per-task budget is a separate, independent check — either one can block a run on its own.

---

## 🧩 How to turn it on

```jsonc
{
  "harness": {
    "guard": {
      "taskBudgetUsd": 5,
      "maxDurationMs": 300000
    }
  }
}
```

That's the whole config. Both fields already default to this ($5 / 5 min) the moment you have a `guard` block at all — even an empty one.

---

## 🔌 How to use it in your task code

```ts
execute: async (input, ctx) => {
  // report real spend as it happens (opt-in, one line per call)
  ctx.budget?.spend({ usd: 0.02 });

  // pass the cooperative signal into anything that supports it
  const res = await fetch(url, { signal: ctx.signal });

  // or poll it yourself in a tight loop
  if (ctx.budget?.timedOut()) return partialResult;

  return res.json();
}
```

- `ctx.budget.spend(...)` — tell the harness what you actually spent, in USD or tokens.
- `ctx.signal` — a real `AbortSignal`. Works with `fetch` and anything else that already understands it.
- `ctx.budget.timedOut()` — a plain boolean if you'd rather poll than plug into a signal.

---

## ⚠️ The one thing to know before it stops you

The duration cap is **cooperative, not forceful**. Nim-Skill tells your code "time's up" — it does not reach in and kill it.

- If your task checks `ctx.signal` or `ctx.budget.timedOut()`, it stops cleanly at the cap.
- If it never checks either, it keeps running — but Nim-Skill still reports the run as timed out in the trace, so you always know it happened.
- The one built-in exception: `nim-skill run` (the CLI command that shells out to a command) can't observe the signal, because shelling out is fully blocking. This is documented, not silent.

---

## 📊 See what it's costing you

```bash
nim-skill monitor --budget
```

One command shows:
- 💵 total spent vs. total cap, across every run
- ⏱️ how many runs hit the timeout
- 📋 a per-run breakdown, in both dollars and token-credits

No separate dashboard, no extra setup — it reads the same local trace file every other `nim-skill monitor` view already uses.

---

## ✅ Why this matters

- **Cost stays predictable per task**, not just per session.
- **A stuck task can't silently eat your whole time budget.**
- **Nothing changes if you don't touch `guard`** — every layer in Nim-Skill is off by default and byte-identical when disabled. This is purely additive.
- **One upgrade note**: if you already have a `guard` block in your config, it now gets these two defaults automatically. Set your own values if $5/5-min isn't right for your workload — or drop the block entirely to opt out.

---

**Get it**: `npx github:phamdat721101/nim-skill install`
**Docs**: `skills/nim-guard/SKILL.md` in the repo
