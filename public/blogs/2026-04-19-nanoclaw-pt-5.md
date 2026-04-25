---
title: "Human-in-the-Loop: Why My Bot Asks Permission Before Pushing Code"
date: 2026-04-19
slug: nanoclaw-approval-gates
series: Building NanoClaw
part: 5
excerpt: "How NanoClaw waits for a human reaction without freezing, the evolution from simple emoji gates to dual-signal approval, and the bug an AI reviewer caught in the approval logic itself."
repo: https://github.com/dydanz/kandangkambing
---

*Part 5 of a series on building NanoClaw — approval gates, async waiting, and the line between delegation and autonomy.*

---

There's a version of NanoClaw I almost shipped that pushed code automatically when QA passed.

It would have been simpler. No waiting, no futures, no reaction handlers. QA passes, commit, push, open PR. Done. The whole flow would be faster, and honestly, the code QA approves is correct most of the time.

I'm glad I didn't ship that version.

Not because the code was bad. But because I kept imagining a scenario: I'm asleep, the bot is running a multi-task feature, and something subtle goes wrong that QA doesn't catch. Maybe the implementation is technically correct but architecturally wrong — it introduces a dependency I don't want, or it puts business logic in the wrong layer. QA validates acceptance criteria, not design taste. If the bot pushes automatically, I wake up to PRs I need to undo rather than PRs I need to approve.

The approval gate exists because the value of human-in-the-loop isn't just catching mistakes. It's staying in control of something that modifies your codebase while you're not looking.

---

## The problem with waiting

This sounds simple: "post a message, wait for a reaction, continue." But Discord bots run on an async event loop, and "waiting" is harder than it sounds.

The `on_message` handler fires, does some work, and returns. The event loop moves on — processing new messages, reactions, heartbeats. If you block with `time.sleep()` or a synchronous wait, the entire event loop freezes. The bot stops responding to everything else. Other jobs can't run. Discord eventually disconnects you for not responding to heartbeats.

The right approach is `asyncio.Future` — a placeholder for a value that doesn't exist yet. You create the future, store it somewhere accessible, and `await` it. The event loop keeps running. When the reaction comes in — minutes or hours later — a different handler resolves the future with the result. The code that was `await`-ing wakes up and continues.

It took me a couple of attempts to get this right. My first version stored the futures in a dict keyed by Discord message ID, which seemed logical — you're waiting for a reaction on a specific message. But tasks can have multiple messages in a thread, and the approval message isn't always the last one. I switched to keying by task ID, which is unambiguous.

---

## The original gate: emoji reactions

Here's how the approval gate works in its simplest form — the version that shipped in the early PRs:

```python
# workflow/approval_gate.py
class ApprovalGate:
    def __init__(self, bot: discord.Client, timeout: int = 3600):
        self.bot = bot
        self.timeout = timeout
        self._pending: dict[str, asyncio.Future] = {}

    async def request(self, task: Task, dev_result: DevResult) -> bool:
        future = asyncio.get_event_loop().create_future()
        self._pending[task.id] = future

        await self._post_approval_message(task, dev_result)

        try:
            return await asyncio.wait_for(future, timeout=self.timeout)
        except asyncio.TimeoutError:
            del self._pending[task.id]
            return False
```

The workflow engine calls `request()`. A future gets created and stored in `_pending`. The approval message goes to Discord. Then the engine awaits the future with a timeout. Meanwhile, the event loop is free — other jobs keep running, the bot responds to status queries, everything stays alive.

On the other end, the reaction handler resolves the future:

```python
# bot.py
@self.event
async def on_reaction_add(reaction: discord.Reaction, user: discord.User):
    if user.bot:
        return
    if not self.auth.is_allowed(user.id):
        return

    task_id = self._get_task_id_from_message(reaction.message)
    if task_id and task_id in self.approval_gate._pending:
        approved = str(reaction.emoji) == "✅"
        future = self.approval_gate._pending.pop(task_id)
        if not future.done():
            future.set_result(approved)
```

✅ resolves to `True` → commit, push, open PR. ❌ resolves to `False` → clean up worktree, mark task as rejected. Timeout → same as rejection, but the task is marked `failed` instead of `rejected`, and the worktree gets cleaned up automatically.

```
     ┌─────────────┐
     │  QA passes   │
     └──────┬───────┘
            │
            ▼
  ┌─────────────────────┐
  │  ApprovalGate        │
  │  .request()          │
  │                      │
  │  1. Create Future    │
  │  2. Store in _pending│
  │  3. Post to Discord  │
  │  4. await Future     │
  └──────────┬───────────┘
             │
     ┌───────┴────────┐
     │  Event loop     │
     │  keeps running  │
     │  (other jobs,   │
     │   messages,     │
     │   heartbeats)   │
     └───────┬─────────┘
             │
     ┌───────┴────────────────────────────────┐
     │              User reacts               │
     ├────────────┬──────────────┬────────────┤
     │    ✅       │     ❌       │  (timeout)  │
     │            │              │             │
     │ future →   │ future →     │ TimeoutError│
     │   True     │   False      │  → False    │
     │            │              │             │
     │ commit +   │ cleanup      │ cleanup     │
     │ push + PR  │ worktree     │ worktree    │
     │            │ status:      │ status:     │
     │            │ rejected     │ failed      │
     └────────────┴──────────────┴─────────────┘
```

This worked. For weeks, it was the entire approval mechanism. Simple, reliable, good enough.

Then I started wanting more.

---

## The evolution: dual-signal approval (PR #10)

The trigger was a common scenario: I'd send a feature command from my phone, then sit down at my laptop. By the time the approval message appeared in Discord, I was already on GitHub looking at something else. The PR was right there. I could see the diff. I could merge it directly. But I had to switch back to Discord to click ✅. It felt stupid.

PR #10 — the `CodeReviewerAgent` branch — changed this. The approval gate now accepts *two* signals: a Discord reaction or a GitHub merge. Whichever happens first wins.

The implementation adds a GitHub polling task that runs alongside the future:

```python
# workflow/approval_gate.py (PR #10 version)
async def request(self, task, dev_result, pr_info=None, has_critical=False):
    future = asyncio.get_event_loop().create_future()
    self._pending[task.id] = future

    if pr_info:
        self._pr_to_task[pr_info.number] = task.id

    if has_critical:
        # Critical findings: skip Discord gate, wait for GitHub merge only
        await self._post_blocked_message(task, dev_result, pr_info)
        merged = await self._wait_for_github_merge(pr_info)
        return merged
    else:
        # Normal: Discord ✅/❌ OR GitHub merge, first wins
        await self._post_approval_message(task, dev_result, pr_info)
        github_task = asyncio.create_task(
            self._poll_github_merge(pr_info, future)
        )
        try:
            result = await asyncio.wait_for(future, timeout=self.timeout)
            github_task.cancel()
            return result
        except asyncio.TimeoutError:
            github_task.cancel()
            return False
```

The `_poll_github_merge` method checks the PR state every 30 seconds using `gh pr view`. If the PR gets merged on GitHub, it resolves the same future the Discord reaction would have resolved:

```python
async def _poll_github_merge(self, pr_info, future):
    while not future.done():
        await asyncio.sleep(30)
        try:
            state = await self.git.get_pr_state(pr_info.number)
            if state == "MERGED":
                if not future.done():
                    future.set_result(True)
                return
            elif state == "CLOSED":
                if not future.done():
                    future.set_result(False)
                return
        except Exception:
            continue  # transient error, keep polling
```

This means I can approve from wherever I happen to be. If I'm on my phone, ✅ in Discord. If I'm on GitHub looking at the diff, merge the PR. If someone else with repo access merges it, that works too. The future doesn't care which signal resolved it.

---

## The critical-findings path

PR #10 also added the `CodeReviewerAgent`, and that introduced a new wrinkle: what happens when the code review finds something serious?

The CodeReviewerAgent produces findings with severity levels — `info`, `warning`, `critical`. If any finding is `critical`, the normal Discord approval gate is skipped entirely. Instead, the bot posts a different message:

```
🔴 Task TASK-003 — Blocked by critical code review findings

Code review found 1 critical issue:
  🔴 JWT secret is hardcoded in source file (security risk)

This PR requires manual review on GitHub.
Approve by merging the PR directly, or use:
  @NanoClaw review override 42

PR: https://github.com/dydanz/kandangkambing/pull/42
```

No ✅ button. No easy approval. You have to either merge the PR on GitHub (after actually looking at it) or explicitly override with a command. The override command (`review override <pr_number>`) is deliberately verbose — it's the equivalent of typing "yes I really mean it" instead of just clicking a button.

This two-tier system — easy approval for clean reviews, forced GitHub review for critical findings — was the main design goal of PR #10. The pipeline now looks like this:

```
QA passes
  → commit + push → PR created
  → CodeReviewerAgent fetches diff, posts findings to GitHub
  → Findings have critical issues?
      │
      ├── NO:  Normal approval gate
      │        (Discord ✅/❌ OR GitHub merge, first wins)
      │
      └── YES: Blocked approval
               (GitHub merge only OR `review override`)
```

---

## The bug an AI found in the approval logic

This is my favorite part of the PR #10 story.

After building the dual-signal gate and the critical-findings path, I ran GPT-5.4-Mini via Codex as a code reviewer on the PR itself. It left two review comments, and one of them caught a real bug.

The critical-findings path skips the normal `request()` method and goes directly to `_wait_for_github_merge()`. But it never registers the task in `_pending` or `_pr_to_task`. That means the `review override` command — which looks up the task by PR number in `_pr_to_task` — can never find the task it's supposed to override. The command would always return "No pending approval gate found."

In other words: the very escape hatch designed to unblock critical reviews was broken for the exact scenario where you'd need it.

I wouldn't have caught this in testing because my tests mocked the approval gate at a higher level. The integration between the critical path and the override command was untested. An AI reviewer, reading the diff with fresh eyes, spotted the control flow gap.

The fix was two lines: register `_pr_to_task[pr_info.number] = task.id` before entering the critical path, and populate `_pending[task.id] = future` so the override has something to resolve. But finding the bug was the hard part — it was a subtle interaction between two features that each worked correctly in isolation.

There's something poetic about an AI finding a bug in the approval logic of a system built to keep humans in the loop of AI-generated code. I'm not sure what the lesson is, exactly, except maybe: code review matters regardless of who wrote the code, and "who" can include another AI.

---

## Edge cases that actually bit me

Building the approval gate surfaced a surprising number of edge cases. These aren't theoretical — each one caused a real problem at least once.

| Edge Case | What Happened | Fix |
|-----------|--------------|-----|
| Multiple reactions on same message | User reacts ✅, then removes it, then adds ❌. Future was already resolved by the first ✅. | Check `future.done()` before calling `set_result()`. Subsequent reactions on resolved futures are silently ignored. |
| Reaction from unauthorized user | Someone else in the Discord server reacts ✅. | Auth check runs first in `on_reaction_add`. Non-allowlisted reactions are ignored. |
| Bot restarts mid-approval | Bot process crashes or restarts while a future is pending. The future is in memory, so it's gone. | Known limitation. Task needs to be re-run. For production use, you'd need a persistent queue. |
| 14-hour timeout | Original timeout was 24 hours. I forgot to check Discord on a weekend. Bot created 6 worktrees, disk started filling up. | Cut timeout to 60 minutes. Auto-cleanup on timeout. |
| GitHub polling hits rate limit | `gh pr view` gets throttled when called every 30 seconds across multiple tasks. | Added try/except around poll calls. Transient errors are ignored; polling continues. |
| Task status inconsistency | `commit_and_push` marks task as `done` immediately, but if the PR later gets closed without merge, the task is still `done`. | GPT-5.4-Mini caught this one too. Not yet fixed — deferring `done` status until merge confirmation is on the backlog. |

The 14-hour timeout incident deserves a bit more color. I'd sent a command on Saturday afternoon and then got busy with other things. The bot had created worktrees for 6 tasks, each sitting on disk waiting for approval. By Sunday morning, my Mac Mini had accumulated several gigabytes of worktree directories — full copies of the repo, each on its own branch. The disk wasn't actually full, but it was heading that direction. The 60-minute timeout with auto-cleanup prevents this from ever happening again.

---

## Why reactions beat slash commands

I considered using Discord slash commands for approval. `/approve TASK-001` is unambiguous — there's no question about which message you're reacting to, no risk of emoji misinterpretation, no edge case with multiple reactions.

But I chose reactions anyway, for three reasons.

**Speed.** One tap vs. typing a command. When you're on mobile and you just want to approve a task that looks fine, the difference between tapping ✅ and opening the command palette, typing `/approve`, waiting for autocomplete, and selecting the task ID is meaningful. Friction in an approval flow directly reduces the incentive to actually review things.

**Visual affordance.** The approval message with the instruction "React ✅ to approve" makes the message look interactive. It invites you to act on it. A plain message that says "type /approve TASK-001 to continue" is a wall of text that's easy to scroll past.

**Mobile experience.** Discord slash commands on mobile are clunky. The autocomplete is slow, the keyboard covers the message, and if you're in a thread it's even worse. Reactions work identically on phone and desktop. For a system I primarily interact with from my phone, this mattered.

The tradeoff is that reactions are slightly less reliable to parse. But with the `future.done()` guard and the auth check, the edge cases are handled. I'd make the same choice again.

---

## The safety layer around the gate

The approval gate doesn't exist in isolation. It's one layer in a stack of safety controls, each catching a different category of problems:

```
  ┌──────────────────────────────────────────────┐
  │           Safety Stack (in order)             │
  ├──────────────────────────────────────────────┤
  │  1. Auth check        → is this user allowed? │
  │  2. Rate limiter      → too many calls/hour?  │
  │  3. Budget guard      → daily spend limit?    │
  │  4. Branch protection → never push to main    │
  │  5. Verification      → syntax + tests pass?  │
  │  6. QA agent          → criteria met?         │
  │  7. Code review (new) → critical findings?    │
  │  8. Approval gate     → human says ✅?         │
  └──────────────────────────────────────────────┘
```

The approval gate is the *last* checkpoint, not the only one. By the time a task reaches the gate, it's already passed auth, stayed within budget, been implemented in an isolated worktree (never on `main`), passed syntax checks and tests, been validated against acceptance criteria by the QA agent, and (in the latest version) been reviewed for critical issues by the CodeReviewerAgent.

The gate isn't catching bugs at that point. It's catching *intent* problems — implementations that are technically correct but not what you wanted. A health endpoint that works but uses the wrong framework pattern. A login flow that passes all criteria but puts the JWT secret in the source code instead of an environment variable. Things that require human judgment, not automated checking.

Other operations have their own gates too, documented in the implementation guide:

| Operation | Gate Type | Reason |
|-----------|-----------|--------|
| Pushing code | Auto (always to `nanoclaw/*` branch, never `main`) | Speed, with branch protection as safety net |
| Merging PRs | Reaction confirmation or GitHub merge | Human review before changes hit main |
| Deleting files | Reaction confirmation | Prevents accidental data loss |
| Modifying `.env` or config | Reaction confirmation | Could break the system |
| Running shell commands | Reaction confirmation | Arbitrary execution is risky |

And there's always the emergency stop: `@NanoClaw STOP` pauses everything immediately. I've used it exactly once — when I realized the PM agent had misinterpreted a command and was generating tasks for the wrong feature.

---

## The philosophical bit (brief, I promise)

There's a popular framing in the AI tooling world that treats human-in-the-loop as a temporary inconvenience. The goal, in this framing, is to gradually remove human checkpoints as the system proves reliable, until eventually you have fully autonomous AI agents that handle everything end-to-end.

I don't share that framing. Not because I don't trust the code — NanoClaw's output is pretty good at this point. But because the approval step isn't just a quality gate. It's a forcing function that makes me *look at what was built*. Without it, I'd send commands and forget about them. The PR would exist but I'd never actually understand what was in it. The approval gate keeps me engaged with my own codebase, even when I'm not the one writing the code.

NanoClaw isn't pushing code on my behalf. It's proposing changes and asking me to confirm. That distinction — between an AI that acts for you and an AI that acts *with your permission* — is the one I keep coming back to.

Maybe that'll change as the system matures. For now, the gate stays.

---

In the next post: the other side of control. Cost tracking, rate limiters, budget guards, and the operational reality of running a multi-agent system on your own API keys.

---

*Part 5 of 7 — [← Part 4: LLM Routing](/blog/nanoclaw-llm-routing) · Part 6: Coming Soon*