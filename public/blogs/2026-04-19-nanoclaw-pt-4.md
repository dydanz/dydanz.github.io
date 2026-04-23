---
title: "LLM Routing: Why I Use Three Different AI Providers (And How I Stopped Overpaying)"
date: 2026-04-19
slug: nanoclaw-llm-routing
series: Building NanoClaw
part: 4
excerpt: "Not every task needs the same model. How NanoClaw picks between Claude, GPT-4o, and Gemini — and the $40 mistake that made cost tracking non-negotiable."
repo: https://github.com/dydanz/kandangkambing
---

*Part 4 of a series on building NanoClaw — the routing table, the fallback chain, and the economics of running a multi-agent system on your own dime.*

---

When I started building NanoClaw, I used Claude for everything. One provider, one model, every agent. It made perfect sense. I was already using Claude Code for the Dev agent. The API was familiar. The quality was good. Why complicate things?

Then the PM agent started annoying me.

---

## The problem that kicked this off

The PM agent has one job: take a feature request and produce structured JSON. A list of tasks, each with an ID, a title, a description, acceptance criteria, and a priority. No prose. No explanation. Just data.

Claude Sonnet is good at this — most of the time. But about 15-20% of calls, it would add something extra. A sentence of explanation before the JSON. Markdown code fences around it. A trailing "Let me know if you'd like me to adjust these tasks!" after the closing brace. Any of those breaks `json.loads()`.

I could keep adding preprocessing logic to handle every edge case. Strip the fences. Trim the prose. Extract JSON from mixed content. I did all of that, and it helped. But the root problem was that Claude treats JSON output as a *response* — something it's saying to you — while what I needed was JSON as *data* — raw structured output with nothing else.

On a whim, I tried the same prompt with GPT-4o. It returned clean JSON on the first call. And the second. And the twentieth. When you tell GPT-4o "respond with JSON only, no markdown, no explanation," it just... does that. Consistently.

That was the moment I stopped thinking about "which LLM should I use" as a single decision and started thinking about it as routing.

---

## The routing table

NanoClaw now maps each type of work to a specific provider and model. Here's the current config:

| Task Type | Provider | Model | Why This One | Typical Cost |
|-----------|----------|-------|-------------|-------------|
| `spec` | OpenAI | GPT-4o | Most reliable structured JSON output | ~$0.01/call |
| `coding` | Anthropic | Claude Sonnet 4 | Best code generation quality I've tested | ~$0.02/call |
| `review` | Anthropic | Claude Sonnet 4 | Strong reasoning about code correctness | ~$0.02/call |
| `test` | Anthropic | Claude Sonnet 4 | Understands code well enough to write meaningful tests | ~$0.02/call |
| `simple` | Anthropic | Claude Haiku 4.5 | Fast, cheap, good enough for status queries | ~$0.001/call |
| `summarise` | Google | Gemini 2.0 Flash | Extremely cheap, handles long context | ~$0.001/call |

This lives in `config/settings.json`, not in code. I can swap which model handles specs without touching the router implementation:

```json
{
  "routing": {
    "coding":    {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
    "review":    {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
    "spec":      {"provider": "openai",    "model": "gpt-4o"},
    "simple":    {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
    "test":      {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
    "summarise": {"provider": "google",    "model": "gemini-2.0-flash"}
  }
}
```

A few things worth noting about how I arrived at these choices.

**Claude dominates coding tasks.** I tried GPT-4o for implementation and it was decent but not as good at following project conventions or producing idiomatic code. Claude Code is Claude by definition (it's the CLI tool), so the Dev agent is always Anthropic. But even for the non-Claude-Code agent tasks — review, test generation — Sonnet consistently outperformed. Tool use is simply more reliable with Claude's models than alternatives, which matters a lot when agents need to call tools mid-reasoning.

**GPT-4o wins at structured output.** I ran a quick test early on: the same PM prompt, 50 calls each to Claude Sonnet and GPT-4o. Claude returned parseable JSON without preprocessing on about 82% of calls. GPT-4o was at 97%. For a pipeline that breaks on parse errors, that 15-point gap is the difference between "works reliably" and "needs a retry loop."

**Gemini Flash is absurdly cheap.** I added it for summarization tasks — condensing long Claude Code output into a shorter status message for Discord. The cost per call is roughly 20x less than Sonnet. For tasks where you're just reformatting information, throwing a frontier model at it is like taking a taxi across the street.

---

## How the router works

The `LLMRouter` is intentionally thin. It looks up the config, dispatches to the right provider, logs the cost, and handles failures:

```python
# tools/llm_router.py
class LLMRouter:
    async def route(self, messages: list, task_type: str) -> str:
        config = self.routing[task_type]
        provider = self._get_provider(config["provider"])

        try:
            response = await provider.complete(
                messages=messages,
                model=config["model"]
            )
            await self.cost_tracker.log(
                task_type=task_type,
                provider=config["provider"],
                model=config["model"],
                tokens_in=response.usage.input_tokens,
                tokens_out=response.usage.output_tokens
            )
            return response.content

        except ProviderError:
            return await self._fallback(messages, task_type)
```

All three providers implement the same interface — a single `complete()` method that takes messages and a model name, and returns an `LLMResponse` with content and token usage:

```python
# tools/providers/base.py
class LLMProvider(ABC):
    @abstractmethod
    async def complete(self, messages: list, model: str) -> LLMResponse:
        pass
```

Each concrete implementation handles the quirks of its own API. Anthropic wants the system prompt separated from the message list. OpenAI puts it inline. Google's API has its own content format entirely. The abstraction means the router never needs to care — it just calls `provider.complete()` and gets a uniform response back.

```
                       ┌─────────────────────┐
                       │     LLMRouter       │
                       │                     │
                       │  route(messages,    │
                       │        task_type)   │
                       └──────┬──────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │ Anthropic   │  │  OpenAI     │  │   Google    │
    │ Provider    │  │  Provider   │  │  Provider   │
    │             │  │             │  │             │
    │ Claude      │  │ GPT-4o      │  │ Gemini      │
    │ Sonnet/     │  │ GPT-4o-     │  │ 2.0 Flash   │
    │ Haiku       │  │ mini        │  │             │
    └──────┬──────┘  └─────┬───────┘  └──────┬──────┘
           │               │                 │
           └───────────────┼─────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ LLMResponse │
                    │ .content    │
                    │ .usage      │
                    └─────────────┘
```

Adding a fourth provider — say, DeepSeek for cheap reasoning tasks, which I've been eyeing — is a new file, a new entry in `settings.json`, and nothing else. No changes to the router, no changes to the agents.

---

## The fallback chain

Providers go down. Rate limits get hit. API keys expire at inopportune moments. When the primary provider fails, NanoClaw falls back through a chain:

```json
{
  "fallback_chain": [
    ["anthropic", "claude-sonnet-4-20250514"],
    ["openai",    "gpt-4o"],
    ["google",    "gemini-2.0-pro"],
    ["anthropic", "claude-haiku-4-5-20251001"]
  ]
}
```

The logic is straightforward — try each entry in order until one succeeds:

```python
async def _fallback(self, messages: list, task_type: str) -> str:
    for provider_name, model in self.fallback_chain:
        try:
            provider = self._get_provider(provider_name)
            response = await provider.complete(messages=messages, model=model)
            return response.content
        except ProviderError:
            continue
    raise AllProvidersFailedError("All LLM providers failed")
```

I've seen the fallback trigger twice in real use. Once when OpenAI had an API outage — the PM agent's spec call failed, fell back to Claude Sonnet, and the task completed with slightly less reliable JSON (but it parsed). Once when I burned through my Anthropic rate limit during a long testing session — five tasks back-to-back, each with retries, Claude hit the per-minute token limit, and the QA calls fell back to GPT-4o temporarily.

Both times, the fallback saved the job. The user experience (me, on Discord) was identical — I didn't even notice until I checked the logs later.

---

## The $40 lesson: why cost tracking is non-negotiable

This is the story I teased in Part 1.

Early in development, before the budget guard existed, I was testing a multi-task feature request. Something like "add user authentication with registration, login, JWT tokens, and a profile endpoint." The PM agent broke it into 6 tasks. The Dev agent started implementing them.

Task 1 went fine. Task 2 failed verification — Claude Code produced a file that imported a module that didn't exist. Retry. Failed again. Different error. Retry. Now we're on attempt 3 for task 2 alone.

Then task 3 failed QA. Retry. Task 4 failed verification. Retry. And because the retry logic at that point was "start completely from scratch," each retry was a fresh Claude Code run — full context loading, full code generation, full token usage.

I wasn't watching. I'd sent the command and gone to make dinner. When I came back an hour later, the Discord thread had a long chain of status messages, and I had a queasy feeling. I checked my Anthropic dashboard.

$40 in API calls. In one evening. On a side project.

The issue wasn't that any single call was expensive. The PM spec cost about $0.01. Each QA evaluation was maybe $0.02. But Claude Code — the subprocess that actually writes code — makes its own API calls, and those were the expensive ones. Multiple retries, each loading the full project context, each generating hundreds of lines of code, each using thousands of tokens. It added up fast.

Three things changed after that night:

**Daily budget guard.** The cost tracker now sums up estimated costs for every API call. At 80% of the daily limit, the bot warns you in Discord. At 100%, it refuses new jobs and tells you why. The default is $5/day, which is conservative but keeps surprises from happening.

```python
# tools/cost_tracker.py
async def check_budget(self) -> BudgetStatus:
    today_spend = await self._get_today_spend()
    daily_limit = self.config["budget"]["daily_limit"]

    if today_spend >= daily_limit:
        return BudgetStatus(allowed=False,
            message=f"Daily budget exhausted (${today_spend:.2f}/${daily_limit:.2f})")
    if today_spend >= daily_limit * 0.8:
        return BudgetStatus(allowed=True, warning=True,
            message=f"⚠️ Approaching budget limit (${today_spend:.2f}/${daily_limit:.2f})")
    return BudgetStatus(allowed=True)
```

**Retry caps.** `max_retries` went from 5 (what was I thinking?) to 2. Three total attempts per task. If it can't get it right in three tries, there's probably a deeper issue that more attempts won't fix.

**Auto-downgrade near budget.** When spending approaches the limit, the router can optionally downgrade to cheaper models. I haven't fully implemented this yet — right now it just stops accepting jobs — but the architecture supports it. The routing config could switch `coding` from Sonnet to Haiku when you're at 90% of budget, trading quality for runway.

---

## What routing actually saves

I ran the numbers on a typical week of use. Seven feature requests, about 15 tasks total, including retries:

| If everything ran on... | Estimated weekly cost |
|------------------------|---------------------|
| Claude Sonnet (every call) | ~$3.50 – $5.00 |
| Routed setup (current config) | ~$1.50 – $2.50 |
| Claude Opus (every call) | ~$15.00 – $25.00 |

The routed setup cuts costs roughly 40-60% compared to running everything on Sonnet, and it actually produces *better* specs because GPT-4o is genuinely more reliable at that specific task. Routing isn't just a cost optimization — it's a quality optimization that happens to also save money.

The real savings, though, are in the calls you *don't* make. The budget guard preventing a runaway retry loop. The Haiku model handling a simple status query instead of spinning up Sonnet. The Gemini Flash call condensing a 2000-token Claude Code output into a 200-token Discord summary. These micro-decisions compound.

For context, the upstream NanoClaw project and the broader OpenClaw ecosystem have documented similar patterns. The community consensus for multi-agent systems — which I've been following through my OpenClaw research — is that smart routing can cut costs 50-80% with no quality loss on the tasks that matter. My numbers land squarely in that range.

---

## The routing table keeps growing

When I added the `CodeReviewerAgent` in PR #10, it needed its own entry in the routing table. Code review is a reasoning-heavy task — the agent reads a PR diff and produces structured findings with severity levels. It's closest to the `review` task type, so it routes to Claude Sonnet.

But it's also potentially expensive: PR diffs can be large, and the agent needs to reason about the entire diff at once. I briefly considered routing it to Gemini Pro (good long-context handling, cheaper than Sonnet) but decided the quality trade-off wasn't worth it for something that gates whether a PR gets approved.

The evolution looks like this:

```
v0.1:  Claude Sonnet for everything
         └── ~$0.05 per feature, but JSON parsing breaks 18% of the time

v0.2:  GPT-4o for specs, Claude Sonnet for coding/QA
         └── JSON parsing breaks drop to ~3%, cost roughly the same

v0.3:  Add Gemini Flash for summarization, Haiku for simple queries
         └── Cost drops 40-50%, quality unchanged for core tasks

v0.4:  Add code review (PR #10), budget guard, retry caps
  (now)  └── $5/day budget, 194 tests, 4 task types across 3 providers
```

Each step was driven by a specific problem — not a desire for architectural elegance. I didn't add Gemini because "three providers is better than two." I added it because Discord messages have a character limit and I needed a cheap way to summarize long Claude Code output without burning Sonnet tokens on reformatting.

---

## The visibility gap I still haven't fixed

There's an honest limitation I want to mention: NanoClaw's cost tracker only tracks agent-level API calls — the ones the router makes directly. It does *not* track what Claude Code spends internally.

Claude Code runs as a subprocess. When the Dev agent calls `claude -p "implement this task"`, Claude Code makes its own API calls to Anthropic — loading the codebase, reasoning about the changes, writing files, checking its work. Those calls can be substantial, especially for larger tasks, and they're completely invisible to NanoClaw's cost tracker.

This means the $1.50-$2.50 weekly estimate above is only the agent calls. The actual total, including Claude Code's internal usage, is higher — probably 2-3x. You can see this in your Anthropic dashboard, but there's no way for NanoClaw to correlate "this Claude Code run was for TASK-003" with the API costs it generated.

Fixing this would require either intercepting Claude Code's API calls (probably by proxying through a local endpoint) or switching from the CLI subprocess to using the Anthropic SDK directly for implementation. Both are non-trivial. For now, I check my Anthropic dashboard once a week and make sure the total isn't surprising. It's not elegant, but it works.

---

## What I'd change

**Task-type-aware fallbacks.** The current fallback chain is global — when any call fails, it tries Claude Sonnet first, regardless of the task type. This means a `spec` task that was originally routed to GPT-4o (for reliable JSON) falls back to Claude Sonnet (less reliable JSON). A smarter chain would know that `spec` should fall back to GPT-4o-mini, then maybe Gemini, then Haiku — models that are good at structured output, not just generally capable.

**Runtime routing changes.** Right now, swapping a model means editing `settings.json` and restarting the bot. I'd love a Discord command like `@NanoClaw route spec → gpt-4o-mini` that takes effect immediately. Not critical, but it would make experimentation faster.

**OpenRouter integration.** Instead of managing three provider SDKs, I could route everything through OpenRouter and get access to dozens of models with one API key. I've done research on this (for a different project at work), and OpenRouter's Auto mode can handle routing automatically based on prompt complexity. For a side project, that might be simpler than maintaining my own routing table. But I also like knowing exactly which model handles which task, so I'm on the fence.

---

In the next post: the approval gate. How NanoClaw posts to Discord, waits for a human reaction, resolves the result — and what changed when I added the dual-signal gate that also watches for GitHub merges.

---

*Part 4 of 7 — [← Part 3: The Full Flow](/blog/nanoclaw-full-flow) · Part 5: Coming Soon*