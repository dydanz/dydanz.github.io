---
title: "Staying Sane: The Unglamorous Infrastructure That Keeps the Lights On"
date: 2026-04-19
slug: nanoclaw-cost-and-safety
series: Building NanoClaw
part: 6
excerpt: "Cost tracking, rate limits, budget guards, emergency stops, and all the boring infrastructure that prevents an autonomous AI system from quietly ruining your evening."
repo: https://github.com/dydanz/kandangkambing
---

*Part 6 of a series on building NanoClaw — the safety rails, the operational tools, and the incidents that made each one necessary.*

---

Every feature in NanoClaw's safety layer exists because something went wrong at least once.

I didn't design these systems proactively. I didn't sit down and think "a responsible AI system needs cost tracking, rate limiting, and budget enforcement." What actually happened is: I got a surprise on my API dashboard, or a retry loop ran longer than it should have, or I forgot the bot was running and came back to a mess. Each incident left a scar, and each scar became a safeguard.

This post is about those safeguards — the boring, unglamorous infrastructure that makes the difference between "fun side project" and "thing that quietly costs you $40 while you're making dinner."

---

## The incident that started everything

I told a shorter version of this story in Part 4, but the full version matters for understanding why the safety layer looks the way it does.

I was testing a multi-task feature — user authentication with registration, login, JWT tokens, and a profile endpoint. The PM agent broke it into 6 tasks. The Dev agent started working through them. I went to make dinner.

Here's what happened while I was gone:

Task 1 completed fine. Task 2 failed verification — a missing import. The engine retried. Failed again — different error. Retried a third time. Still failing. At that point, `max_retries` was set to 5 (what was I thinking?), so it kept going. Tasks 3 and 4 had similar problems. Task 5 hit an acceptance criterion that was ambiguously worded — it would never pass no matter how many times it ran.

Each retry meant a fresh Claude Code run: loading the full project context, generating code, running verification. Each run consumed real tokens. Three providers, six tasks, up to five retries each.

When I came back, the Discord thread was a wall of status messages. I checked my Anthropic dashboard: $40 in API calls. In one evening. On a side project.

The money wasn't the real problem — $40 won't bankrupt me. The real problem was that I hadn't known. The system had been quietly burning money for an hour and nothing had told me. No warning, no limit, no signal that anything was unusual.

Three things changed immediately after that night. Together, they form the safety layer.

---

## Layer 1: the budget guard

The budget guard is the hard stop. Before any operation that costs money — any LLM call, any Claude Code execution — it checks whether today's spending has hit the limit.

```python
# safety/budget_guard.py
class BudgetGuard:
    async def check(self, operation: str) -> None:
        daily_total = await self.cost_tracker.daily_total()

        if daily_total >= self.daily_limit:
            raise BudgetExceededError(
                f"Daily limit of ${self.daily_limit:.2f} reached "
                f"(spent: ${daily_total:.2f}). "
                f"Operations paused until tomorrow."
            )

        if not self._warned and daily_total >= self.daily_limit * 0.80:
            self._warned = True
            await self._notify_discord(
                f"⚠️ Approaching daily limit: "
                f"${daily_total:.2f} / ${self.daily_limit:.2f}"
            )
```

When `BudgetExceededError` fires, it propagates up through the workflow engine. The current job is paused. The bot posts to Discord explaining what happened and why. No more work happens until tomorrow (or until you change the limit in `settings.json` and restart).

The defaults:

| Setting | Value | Why |
|---------|-------|-----|
| Daily limit | $5.00 | Conservative for personal use. Enough for 3-4 features with retries. |
| Warning threshold | 80% ($4.00) | Gives you time to react before the hard stop. |
| Reset time | 9:00 AM local | Fresh budget each morning. Overnight jobs don't carry over. |

$5.00 might sound low if you're used to enterprise API budgets, but for a one-person side project where a typical feature costs $0.10-$0.30 in agent calls, it's plenty. The limit isn't there for normal days — it's there for the day something goes wrong.

One nuance from PR #10: the `review override` command is deliberately exempt from the budget guard. If a PR is blocked by critical code review findings and you need to force-approve it, the override works even when the budget is exhausted. The reasoning is simple: the override doesn't make any LLM calls. It just resolves an `asyncio.Future`. Blocking a zero-cost administrative action because of a spending limit would be frustrating in exactly the scenario where you're most likely to need it.

---

## Layer 2: the cost tracker

The budget guard is only useful if the numbers feeding it are accurate. Every LLM call goes through the cost tracker, which logs tokens and calculates costs:

```python
# memory/cost_tracker.py
async def log(self, session_id, task_id, agent, provider,
              model, tokens_in, tokens_out):
    cost = self._calculate_cost(provider, model, tokens_in, tokens_out)
    await self.db.execute(
        """INSERT INTO cost_log
           (timestamp, session_id, task_id, agent, provider,
            model, tokens_in, tokens_out, cost_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (datetime.now(), session_id, task_id, agent,
         provider, model, tokens_in, tokens_out, cost)
    )
```

The pricing data lives in `config/pricing.json` — a lookup table of input/output costs per million tokens for each provider and model:

```json
{
  "anthropic": {
    "claude-sonnet-4-20250514":  {"in": 3.00,  "out": 15.00},
    "claude-haiku-4-5-20251001": {"in": 0.80,  "out": 4.00}
  },
  "openai": {
    "gpt-4o":      {"in": 5.00, "out": 15.00},
    "gpt-4o-mini": {"in": 0.15, "out": 0.60}
  },
  "google": {
    "gemini-2.0-flash": {"in": 0.10, "out": 0.40}
  }
}
```

This table needs manual updating when providers change pricing. That's a limitation — ideally you'd fetch it from an API. But providers don't all offer a pricing API, and the difference between stale and current pricing is usually small enough not to matter for budget enforcement. If Sonnet's price drops 10%, my budget guard being slightly pessimistic is fine. If Sonnet's price doubles, I'll notice in the daily report before the budget guard needs to catch it.

The cost data goes into a SQLite table (`cost_log`), which means I can query it however I want. Total by day, breakdown by model, cost per task, cost per agent. The daily report uses this, and I occasionally run ad-hoc queries when I'm curious about trends.

---

## Layer 3: the rate limiter

The budget guard catches "spending too much money." The rate limiter catches "doing too many things too fast" — which is usually a symptom of a bug, not intentional work.

```python
# safety/rate_limiter.py
class RateLimiter:
    async def check(self, operation: str) -> None:
        now = time.time()
        window = self.limits[operation]["window_seconds"]
        max_calls = self.limits[operation]["max_calls"]

        self.calls[operation] = [
            t for t in self.calls[operation]
            if now - t < window
        ]

        if len(self.calls[operation]) >= max_calls:
            if not self._in_cooldown(operation):
                self._start_cooldown(operation)
                await self._notify_discord(
                    f"⚠️ Rate limit hit for {operation}. "
                    f"Cooling down for {self.cooldown_minutes} minutes."
                )
            raise RateLimitError(f"Rate limit: {operation}")

        self.calls[operation].append(now)
```

It's a sliding window — it counts calls within the last N seconds and blocks if the count exceeds the limit. The limits are tuned for "this is about the most a human would reasonably do in an hour":

| Operation | Limit | Window | Why This Number |
|-----------|-------|--------|----------------|
| LLM calls | 30 / hour | 3600s | A 6-task feature with retries is ~18 calls. 30 gives headroom. |
| Claude Code executions | 10 / hour | 3600s | Each run is expensive and takes 1-2 min. 10 means something is looping. |
| Git pushes | 5 / hour | 3600s | Normal flow is 1 push per approved task. 5 in an hour is unusual. |

The cooldown period is important. Without it, a bug that causes rapid retries would hit the rate limit, throw an error, retry immediately, hit the limit again, throw again — in a tight loop that generates errors but never actually stops. The 10-minute cooldown breaks that loop. When a rate limit fires, the operation type is blocked for 10 minutes before it can be tried again.

I hit the rate limiter once in real use: a job queue bug caused a failed task to re-enqueue itself after each failure. The task would fail, get put back in the queue, get picked up again, fail again. The Claude Code rate limit (10/hour) caught it on the third cycle. Without the limiter, it would have looped indefinitely — or until the budget guard caught it, which might have been much later.

---

## The daily report

Every morning at 9:00 AM, a scheduler resets the budget guard's warning flag and posts a cost report for the previous day to the Discord log channel:

```
📊 Daily Cost Report — 2026-04-17

Total: $1.34

By model:
  claude-sonnet-4-20250514   $0.89  (4 calls)
  gpt-4o                     $0.31  (3 calls)
  gemini-2.0-flash           $0.14  (8 calls)

By task:
  TASK-001 (health check)    $0.22
  TASK-002 (add tests)       $0.41
  TASK-003 (refactor auth)   $0.71

Budget remaining: $5.00 / $5.00 (new day)
```

This is the feature I use most, and not because I'm watching costs obsessively. The breakdown by model tells me whether my routing is working. If I see Sonnet being used for something that should be Haiku, the report surfaces it. If one task is disproportionately expensive, it usually means it retried multiple times — which is a signal to check whether the acceptance criteria are too ambiguous.

The breakdown by task is also useful for a less obvious reason: it tells me which *kinds* of features are cheap to automate and which aren't. Health endpoints, CRUD routes, test additions — these consistently cost under $0.30. Anything involving refactoring existing code or touching multiple files costs more, because Claude Code needs more context and more turns.

Over a few weeks, I started developing an intuition: if the PM agent produces more than 4 tasks for a single feature, I should review the task breakdown before letting the Dev agent run. Large task counts correlate with retries, which correlate with cost.

---

## The emergency stop

All of the above are automated. But sometimes you need a manual kill switch.

```
You:  @NanoClaw STOP
Bot:  ⛔ All agents paused. No operations will execute.
      Type @NanoClaw RESUME to continue.
```

`STOP` immediately sets a global flag that every safety check reads. No new jobs get accepted. No in-progress jobs continue past their next checkpoint. Running Claude Code subprocesses finish their current operation (you can't kill a subprocess mid-write safely), but no new ones start.

I've used it exactly once. The PM agent misinterpreted a command and started generating tasks for the wrong feature. I saw the first task notification pop up in Discord, realized it was wrong, and typed `STOP`. The system paused before the Dev agent started implementing anything. I typed `RESUME` after fixing the task spec and reissuing the command.

It's the simplest piece of code in the safety layer — a boolean flag and a check at the top of every operation. But knowing it exists changes how comfortable you feel letting the system run while you're doing other things.

---

## The full safety stack

Here's how all the layers fit together, from outermost to innermost:

```
Request comes in from Discord
│
├─ Auth check ───────────── Is this user on the allowlist?
│   └─ No → silently ignored (no response)
│
├─ Emergency stop ───────── Is the STOP flag set?
│   └─ Yes → "System is paused. Type RESUME to continue."
│
├─ Rate limiter ─────────── Too many calls this hour?
│   └─ Yes → "Rate limit hit. Cooling down for 10 minutes."
│
├─ Budget guard ─────────── Daily spending limit reached?
│   └─ Yes → "Budget exhausted. Pausing until tomorrow."
│   └─ Near → "⚠️ Approaching daily limit ($4.12 / $5.00)"
│
├─ Job queue ────────────── Max 2 concurrent jobs
│   └─ Full → queued, processed when a slot opens
│
│  ┌─────── Inside the job ───────┐
│  │                              │
│  │  PM Agent (spec)             │
│  │  Dev Agent (implement)       │
│  │    └─ Verification           │
│  │       (syntax + tests)       │
│  │  QA Agent (validate)         │
│  │  Code Review (PR #10)        │
│  │  Approval Gate (human ✅)    │
│  │  commit + push + PR          │
│  │                              │
│  └──────────────────────────────┘
│
└─ Cost logged to cost_tracker after every LLM call
```

Every layer catches a different failure mode. Auth prevents unauthorized access. The emergency stop handles "oh no, wrong feature." Rate limits catch infinite loops. Budget guard catches expensive retries. The job queue prevents resource exhaustion. Verification catches bad code. QA catches missed requirements. Code review catches security issues. The approval gate catches everything else.

No single layer is sufficient. The budget guard doesn't help with an unauthorized user. The rate limiter doesn't help if each call is just very expensive. Auth doesn't help if you send the wrong command yourself. They work as a stack because each one covers a gap the others don't.

---

## What these guards actually caught

A running log of real incidents where the safety layer did something useful:

| When | What Happened | Which Guard | Result |
|------|--------------|-------------|--------|
| Week 2 | Multi-task retry loop burned through tokens | Budget guard | Stopped at $3.12. Would have been ~$15-20 without the limit. |
| Week 3 | Failed task re-enqueued itself in a loop | Rate limiter (Claude Code) | Caught on 3rd cycle. Bot posted cooldown notice. |
| Week 4 | Tested a new feature too aggressively — 8 features in one session | Budget guard warning | Warning fired at $4.10. I stopped and spread remaining work to the next day. |
| Week 5 | Someone in a shared Discord server tried to use the bot | Auth guard | Silently ignored. No response, no information leakage. |
| Week 6 | PM agent misinterpreted command, started wrong feature | Emergency stop | Stopped before Dev agent ran. Fixed and resumed. |
| Week 7 | PR #10 testing — reviewed override behavior with budget exhausted | Override exemption | `review override` worked correctly even with budget at $0. |

None of these were catastrophic. That's the point. The safety layer turns potential catastrophes into minor inconveniences.

---

## The gap I still haven't closed

I've mentioned this in every post where it's relevant, and it's still true: NanoClaw's cost tracker only sees the API calls made through the LLM router. It does not see the calls Claude Code makes internally.

When the Dev agent runs `claude -p "implement this task"`, Claude Code makes its own API calls to Anthropic — loading the codebase into context, reasoning about the changes, writing files, checking its work. These calls are often the most expensive part of the entire pipeline, and they're completely invisible to the budget guard.

The practical impact: my "$1.34 daily total" in the report might actually represent $3-4 of total API spending when you include Claude Code. The budget guard at $5/day is set based on what it can *see*, not the true total. I compensate by checking my Anthropic dashboard weekly and comparing the two numbers. The ratio is usually around 2.5-3x — for every dollar the tracker sees, Claude Code spent about $1.50-$2.00 more.

Fixing this properly would mean either:

1. **Proxying Claude Code's API calls** through a local endpoint that logs them — technically feasible but adds latency and complexity.
2. **Replacing the CLI with direct SDK calls** — which means rewriting the Dev agent to not use Claude Code as a subprocess. This is the right long-term answer but it's a significant refactor.
3. **Reading Claude Code's own cost output** — the CLI reports token usage when it finishes, and the Dev agent could parse that output and feed it to the cost tracker retroactively. This is the pragmatic middle ground and probably what I'll implement next.

For now, the gap is documented and accounted for by setting the budget limit lower than the true amount I'm comfortable spending. Not elegant, but it works.

---

## The meta-lesson

Building these safety systems taught me something I hadn't expected: the safety infrastructure is more useful as an *operational dashboard* than as a guard rail.

Yes, the budget guard has stopped runaway costs twice. Yes, the rate limiter caught a loop once. Those are important. But the thing I look at every day is the cost report. It tells me which features are expensive, which models are being used where, which tasks retry a lot. It's the operational visibility layer for a system that mostly runs in the background.

If I were building this again, I'd invest in observability earlier. Not just "did we exceed a limit" — but "here's what the system did today, broken down in a way that helps you make decisions." The safety guards are necessary. The visibility is what makes the system improvable.

---

In the final post: the retrospective. What I'd build differently, what surprised me, and what I think systems like this are actually good for.

---

*Part 6 of 7 — [← Part 5: Approval Gates](/blog/nanoclaw-approval-gates) · Part 7: Coming Soon*