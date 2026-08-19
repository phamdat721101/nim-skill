# 🛡️ Beyond Memory: How to Prompt AI Agents for Ground-Truth & Real Git Diffs with `nim-skill`

Most AI coding agents fail not because they lack intelligence, but because they get caught in **the Memory-Only Echo Trap** — assuming an action succeeded simply because they declared it in their conversation history, without verifying the actual state on disk.

When you prompt an agent:
> *"Did you fix the bug?"*
> Agent: *"Yes! I've updated the function and all tests are passing."* *(...even though it never touched the file or checked `git diff`)*

Here is how to harness and prompt your AI coding agent (Claude Code, Cursor, Kiro, Codex) using `nim-skill`'s 4-stage discipline: **Learn ➔ Execute ➔ Verify ➔ Improve**.

---

## ⚠️ The Problem: Why Memory-Only Agent Prompts Fail

When agents rely solely on memory context without ground-truth verification:
- 🙈 **Hallucinated Completion:** The agent generates code in chat and declares the task complete, but never actually wrote the file or inspected `git diff`.
- 💸 **Echo-Chamber Verification:** When asked to verify, the agent reads its own prior messages and says "confirmed", creating a closed hallucination loop.
- 🌊 **Log-Flooded Reasoning:** Running raw test commands dumps 3,000 lines of noise into the context window, causing the agent to lose its initial instruction prompt.
- 🔁 **Repeating Past Blunders:** Without structured past-lesson injection, the agent repeats the exact same failing tool calls across different sessions.

---

## 🏛️ The 4 Prompt Disciplines of `nim-skill`

### 🧠 1. Learn (Pre-Execution Lessons & Cost Gate)
- 🛑 **Pre-Flight Lesson Injection:** Before taking action, the agent checks `.nim/lessons.jsonl` for similar past failures and adjusts its plan before spending tokens.
- 🚦 **Costed-Action Gate:** Prompts the agent to pause or warn before calling high-cost deployment or payment tools if recent `wasted_spend` occurred.
- 👤 **Owner Habit Learning:** The agent prompts proposals that match your preferred architectural patterns recorded in `.nim/owner-profile.jsonl`.

### 🚀 2. Execute (Plan-First & Noise-Free Output)
- 📝 **Plan-First Approval (`nim-propose`):** The agent is prompted to submit a structured plan file (`.nim/proposals/<id>.md`) for human sign-off before touching critical code.
- 📉 **Compacted Terminal Feedback (`nim-logcompact`):** When the agent runs builds or tests, the harness strips 90%+ log noise, returning only the failure lines so the agent's reasoning prompt stays sharp.
- ⏱️ **Per-Task Budgets:** Hard prompt budget limits prevent the agent from burning through hundreds of tool calls in an infinite loop.

### 🔬 3. Verify (Ground-Truth & Real Git Diffs vs Memory)
- 🚫 **"Enforce, Don't Instruct":** The agent is strictly instructed never to trust its own claims. Output verification is enforced by real disk & test checks.
- 🔍 **Real Git Diff Inspection:** The agent must inspect `git diff` to prove that changes exist on disk and only modify intended files.
- 🔎 **Independent Evidence Strategy:** Prompt requires non-empty proof from external sources (e.g. `git diff` output, test runner exit codes) and forbids trusting echoed client SDK responses.
- 🛡️ **Workspace Identity Check (`nim-workspace`):** Hook prompts block off-stack code generation before an incorrect file is created.

### ⚡ 4. Improve (Self-Healing & Resolution Tracking)
- 🩺 **Ambiguous Error Diagnosis:** When an unexpected error occurs, the agent runs a targeted diagnostic check before attempting blind retries.
- 🔄 **Bounded Self-Healing:** The harness feeds compact, precise error diffs back to the agent for targeted fixes without cluttering context.
- 🏷️ **Resolution-Labelled Logging (`nim-workrule`):** The agent records every completed task in `.nim/agent-support-log.md` with explicit resolution tags: `[FIX]`, `[WORKAROUND]`, or `[MITIGATION]`.

---

## 📋 Ready-to-Use Agent System Prompt (Copy-Paste)

Add this prompt block directly to your `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or custom system instructions:

```markdown
<!-- NIM-SKILL GROUND-TRUTH PROMPT DISCIPLINE -->
You operate under the nim-skill ground-truth harness. Follow these 4 mandatory rules:

1. LEARN BEFORE EXECUTION:
   - Check local lessons and project guidelines before modifying critical modules.
   - Never repeat a known failure pattern.

2. EXECUTE WITH DISCIPLINE:
   - For high-impact or multi-file changes, scaffold a proposal plan first.
   - Keep tool commands scoped and compact.

3. VERIFY WITH REAL GIT DIFFS (NEVER MEMORY ONLY):
   - Never claim a task is complete based on conversation memory.
   - ALWAYS run `git diff` to verify the exact changes written to disk.
   - Run relevant tests and verify exit code 0.
   - Re-read modified files partially to ensure no syntax or formatting regressions.

4. IMPROVE & RECORD:
   - When fixing an issue, classify the resolution explicitly:
     • [FIX]: Permanent solution addressing root cause.
     • [WORKAROUND]: Temporary bypass for upstream/environment blocker.
     • [MITIGATION]: Defensive guardrail preventing damage.
   - Log the action in .nim/agent-support-log.md if workrule tracking is enabled.
```

---

## 💬 Example: Agent Conversation Flow in Action

### ❌ Without Harness (Memory-Only Failure)
- 👤 **User:** "Refactor the authentication token validator."
- 🤖 **Agent:** "I have refactored `auth.ts` and made it secure!" *(didn't write to disk, or hallucinated changes)*
- 👤 **User:** "It's still failing in production."
- 🤖 **Agent:** "Looking at my previous answer, I see I already updated it." *(trapped in memory loop)*

### ✅ With `nim-skill` Ground-Truth Prompting
- 👤 **User:** "Refactor the authentication token validator."
- 🤖 **Agent (Learn & Propose):** "Checked past lessons. Proposing plan `.nim/proposals/auth-refactor.md` for approval."
- 👤 **User:** "Approved."
- 🤖 **Agent (Execute & LogCompact):** "Running refactor. Ran test suite via `nim-skill run 'npm test' --logcompact` (2 errors isolated from 500 lines of logs)."
- 🤖 **Agent (Verify with Git Diff):** "Inspecting `git diff src/auth.ts`: confirmed 12 lines added, 5 removed. Running vitest: all 14 tests pass."
- 🤖 **Agent (Improve & Tag):** "Task complete. Logged `[FIX]` in `.nim/agent-support-log.md` with verified `git diff` proof."

---

## 💡 Summary Checklist for Prompting Reliable Agents

- 🎯 **Never Accept Verbal Confirmations:** Force the agent to output the `git diff` snippet or test output as proof.
- 📉 **Compact the Feedback Loop:** Never feed raw terminal dumps to the agent; pass filtered error context.
- 🛡️ **Require Plan Approval for Big Tasks:** Make the agent propose before touching multiple files.
- 🏷️ **Tag Every Resolution:** Use `[FIX]`, `[WORKAROUND]`, and `[MITIGATION]` so future agent turns know the confidence level of past changes.
