---
title: "What I Learned Building an Autonomous Code Agent"
date: 2026-04-19
slug: nanoclaw-lessons-learned
series: Building NanoClaw
part: 7
excerpt: "An honest retrospective on NanoClaw — what worked, what didn't, what I'd build differently, and what building a multi-agent system from scratch taught me about AI, engineering, and the gap between demos and daily use."
repo: https://github.com/dydanz/kandangkambing
---

*Part 7 of a series on building NanoClaw — the retrospective.*

---

I want to start this last post with a number: 21 commits on main. That's how big the [kandangkambing](https://github.com/dydanz/kandangkambing) repo is right now. Plus another 19 on the open PR #10 branch. Roughly 40 commits total to build a system that takes a chat message and produces a pull request.

That's not a lot. Most production systems have thousands of commits. But each of those 40 represents a real design decision — tested against an actual feature request, debugged against a real failure, refined against a real cost bill. This post is about what those decisions taught me.

---

## The project by the numbers

Before the reflections, here's what NanoClaw actually is today, measured concretely:

| Metric | Value |
|--------|-------|
| Language | Python |
| Commits (main) | 21 |
| Commits (PR #10, open) | 19 |
| Total PRs | 10 (9 merged, 1 open) |
| Tests | 194 passing |
| Agents | 4 (PM, Dev, QA, CodeReviewer) |
| LLM providers | 3 (Anthropic, OpenAI, Google) |
| Task types routed | 6 |
| Persistence layers | 2 (SQLite for conversations, JSON for tasks) |
| Safety layers | 5 (auth, rate limiter, budget guard, emergency stop, approval gate) |
| Daily budget default | $5.00 |
| Co-authored commits with AI | ~15 (Claude Sonnet 4.6) |
| Repo name meaning | "Goat pen" in Indonesian |

It's a side project. It runs on a Mac Mini. It's not production software in any meaningful sense. But it works, it's tested, and I use it.

---

## What actually worked

**The PM agent is the most important component.** This was the biggest surprise. I built NanoClaw thinking the Dev agent — the one that actually writes code — would be the star. It's not. The PM agent is.

The quality of the Dev agent's output is almost entirely determined by the quality of the task spec it receives. Vague acceptance criteria produce code that vaguely matches. Explicit, testable criteria produce code you can validate. The PM agent isn't overhead — it's the thing that makes everything downstream reliable.

I tested this empirically early on. Same feature request, two approaches: one where I handed the raw request directly to Claude Code, and one where the PM agent produced a structured spec first. The direct approach worked about 30% of the time. The PM-mediated approach worked about 75% of the time. Same model doing the coding, dramatically different results, because the instructions were better.

If I could only keep one agent, I'd keep the PM.

**Git worktrees are the right isolation primitive.** Every task gets its own worktree — an isolated directory, its own branch, no interference with anything else. When a task fails, you delete the directory and the branch. When it succeeds, you commit from there and clean up. The main repo is never touched.

This pattern is so clean that I'd use it for any system where an AI needs to "try something and maybe throw it away." It's not a NanoClaw-specific insight — it's a general engineering pattern that I happened to discover through this project.

**The approval gate isn't friction — it's engagement.** I expected the gate to feel like a speed bump. Instead, it became the part of the workflow I value most. Because the bot does the implementation, I'm not invested in the code the way I'd be if I wrote it myself. That distance actually makes me a better reviewer. I read the diff more carefully than I read my own code.

The evolution to dual-signal approval (Discord reaction or GitHub merge, whichever comes first) in PR #10 made this even better. Now I approve from wherever I happen to be — phone, laptop, GitHub — without context-switching.

**Cost tracking changed my relationship with LLM APIs.** Before NanoClaw, I thought of API costs as "roughly $X per month." Now I think of them as "this task costs $0.22 and this other task costs $0.71 because it retried twice." The granularity matters. It turned model selection from a one-time decision into an ongoing optimization problem, and it made me realize that routing — sending different tasks to different models — is a bigger cost lever than model choice alone.

---

## What didn't work

**The QA agent is too shallow.** The QA agent evaluates acceptance criteria without reading the actual code. It sees the task spec and the list of changed files, reasons about whether the criteria are "plausibly satisfied," and returns a verdict. This misses real bugs — incorrect logic, subtle edge cases, implementations that satisfy the letter of the criteria but not the spirit.

The CodeReviewerAgent in PR #10 partially addresses this: it reads the actual PR diff and can catch things the QA agent misses. But the QA agent itself is still surface-level. The fix I'd pursue: give it access to file contents, run the actual test suite as part of validation, and maybe add static analysis. The criteria-based approach would stay, but it'd be backed by real code inspection.

**Retries are expensive and uninformed.** When a task fails and retries, it starts from scratch: new worktree, new Claude Code run, same instructions. It doesn't know what went wrong the first time. It doesn't incorporate QA feedback. It just tries again and hopes for a different outcome.

This is the single biggest waste of money in the system. A retry that costs $0.15 but produces the exact same bug is $0.15 burned. A retry that costs $0.15 and includes "last time, criterion X failed because Y — address this specifically" has a much higher chance of succeeding. The architecture supports this change (QA's output is structured, the Dev agent accepts context), but I haven't implemented it yet.

**Context files rot.** The quality of Claude Code's output depends heavily on `memory/context/project_overview.md` — the file that tells it what framework you're using, what the file structure looks like, what conventions to follow. That file was accurate when I wrote it. It's less accurate now, because the project has evolved and the file hasn't kept up.

Manual context maintenance is a losing game. The fix is automated context generation — something that scans the codebase and produces an up-to-date overview. It could run as a scheduled job or as a pre-step before every Dev agent run. I haven't built it, but it's the difference between a system that works for the first month and one that works indefinitely.

**JSON as a task store was the wrong call.** I defended this choice in Part 2 and I still think it was reasonable for getting started quickly. But every time I need to inspect task state during debugging, I wish it were in SQLite. Every time I worry about crash-during-write corruption, I wish it were in SQLite. The migration is straightforward — same schema, better engine — and I should just do it.

---

## The honest usefulness chart

After a few months of real use, here's where NanoClaw adds value and where it doesn't:

```
            High value                        Low value
               ◄──────────────────────────────────►

  ┌────────────────────┐
  │ Boilerplate        │  Models, routes, migrations, test stubs.
  │ & scaffolding      │  Clear patterns, predictable output.
  └────────────────────┘
  ┌────────────────────┐
  │ Small, well-       │  "Add GET /health returning status + uptime."
  │ specified tasks    │  Explicit criteria, single-file scope.
  └────────────────────┘
  ┌────────────────────┐
  │ Test generation    │  "Write tests for the auth module."
  │                    │  Existing code as spec, high hit rate.
  └────────────────────┘
  ┌────────────────────────┐
  │ Multi-file features    │  Works but needs careful task breakdown.
  │ with dependencies      │  PM agent quality is the bottleneck.
  └────────────────────────┘
                    ┌────────────────────────┐
                    │ Refactoring existing   │  Needs deep context.
                    │ code                   │  High retry rate.
                    └────────────────────────┘
                              ┌────────────────────────┐
                              │ Debugging runtime      │  No feedback loop
                              │ issues                 │  with running code.
                              └────────────────────────┘
                                       ┌────────────────────────┐
                                       │ Tasks with implicit    │  "You know what
                                       │ requirements           │  I mean" doesn't
                                       └────────────────────────┘  work as a spec.
```

The pattern is clear: NanoClaw is a force multiplier for work that's clear and well-specified. It's not a substitute for thinking. If you can't write good acceptance criteria, the agent can't produce reliable output. And if the task requires understanding the system's runtime behavior — how things interact, what happens under load, where the actual bug is — the agent doesn't have access to that information and can't help.

This isn't a limitation of NanoClaw specifically. It's a limitation of text-in, code-out AI systems in general. They're very good at the mechanical part of software engineering and not yet good at the judgment part.

---

## What I'd build differently

Five changes, ordered by impact:

| Change | Why | Effort |
|--------|-----|--------|
| Feedback-aware retries | Pass QA failure context to the next attempt. Single biggest quality improvement available. | Medium — restructure the retry loop in the workflow engine. |
| QA reads actual code | File listings are not code review. Give QA the diff, run the test suite, add static analysis. | Medium — expand QA agent's tool access, add test runner integration. |
| SQLite for task state | Crash recovery, concurrent access, queryable state. JSON was fine to start; SQLite is better for everything after. | Small — same schema, different engine. |
| Automated context refresh | Generate `project_overview.md` from the codebase instead of maintaining it manually. Run before every Dev agent invocation. | Medium — need a summarization step that's fast and cheap. |
| Direct SDK instead of CLI | Replace the Claude Code subprocess with direct Anthropic SDK calls. Full cost visibility, structured I/O, no blind spot in the budget guard. | Large — significant Dev agent rewrite. |

If I had a weekend, I'd do #3 (SQLite migration) and #1 (feedback retries). If I had a week, I'd add #2 (QA reads code). #4 and #5 are longer-term.

---

## What this taught me about multi-agent systems

I built NanoClaw because I wanted to understand multi-agent systems by actually building one, not just reading about them. Here's what I came away with.

**Where you draw the agent boundaries matters more than which model you use.** The hardest design question wasn't "Claude or GPT-4o?" — it was "what does the PM agent own vs. the Dev agent?" When I put planning and implementation in one agent, it tried to do everything and did nothing well. Separating them forced each agent to have a clear contract: the PM produces specs, the Dev produces code, the QA produces verdicts. Clean boundaries made the system debuggable.

**Memory is the unsolved problem.** Each agent has limited, session-scoped memory. They don't learn from past tasks. They don't accumulate project knowledge over time. They don't recognize that they've implemented a similar feature before and should follow the same pattern. The context files are a manual workaround for a fundamental limitation. Long-term memory for agents — real, useful, doesn't-hallucinate memory — is still an open problem in the field.

**The plumbing-to-intelligence ratio is 80/20.** LLM calls are about 20% of the codebase. The rest is command parsing, memory management, git operations, error handling, retry logic, cost tracking, Discord formatting, safety guards, and the hundred small decisions that make the difference between a demo and something you'd use daily. If you're thinking about building a multi-agent system, budget your time for the plumbing, not the prompts.

**Cost is a design constraint, not an afterthought.** Every architectural decision in NanoClaw — which model handles which task, how many retries to allow, when to use a cheap model vs. an expensive one — is shaped by cost. I've spent time researching model pricing tiers, OpenRouter routing strategies, and per-token economics across providers. Treating LLM usage as "free until it isn't" leads to systems that work in demos and surprise you in production. Even at side-project scale, the $40 dinner incident taught me that.

**The human in the loop is not a crutch.** I've seen people design AI systems as if the approval gate is a temporary measure on the way to full autonomy. I don't agree. For code that goes into a real codebase, having a human checkpoint isn't a limitation — it's a feature. The approval gate keeps me engaged with what the system produces. Without it, I'd send commands and never look at the output. That's not delegation — that's abdication.

---

## What's next

There are directions I'd take this if I kept pushing:

**Smarter QA.** Actually executing tests, reading file contents, running static analysis. The CodeReviewerAgent in PR #10 is a step toward this — it reads the diff — but the QA agent itself still needs to level up.

**Task templates.** Predefined patterns for common work — new endpoint, new model, new test suite — with pre-written acceptance criteria. Right now, the PM agent generates criteria from scratch every time. Templates would make the common case faster and more consistent.

**Multi-repo support.** Right now NanoClaw assumes one target repository. Supporting multiple projects — with separate worktree bases, separate context files, separate task stores — would make it genuinely useful as a daily tool rather than a single-project assistant.

**This blog.** I set up a Jekyll-powered GitHub Pages site for publishing this series. The irony of building a system that writes code and then writing about it manually isn't lost on me. Maybe NanoClaw should write the next series.

---

## The name, one more time

The repo is called *kandangkambing* — "goat pen" in Indonesian. I said in Part 1 that I name my side projects after things that sound chaotic but are, upon closer inspection, reasonably well-organized.

After building this, I think the metaphor is more apt than I intended. A goat pen has a fence (the safety layer), a gate that you open and close deliberately (the approval gate), multiple goats doing their own thing inside (the agents), and a farmer who checks on them periodically but doesn't stand there all day (me, on Discord).

The goats sometimes make a mess. But they stay inside the fence, and the gate only opens when you decide it should.

---

## Thanks for reading

This series covered a lot: architecture, agent design, the full flow from message to PR, LLM routing, async approval gates, cost tracking, and this retrospective. Seven posts, one system, a lot of lessons.

If you build something with these ideas — a Discord bot, a multi-agent pipeline, a cost tracker for LLM calls, even just git worktrees for AI-generated code — I'd genuinely like to hear about it.

The code is open at [github.com/dydanz/kandangkambing](https://github.com/dydanz/kandangkambing). 10 PRs, 194 tests, and one goat pen.

---

*Part 7 of 7 — [← Part 6: Staying Sane](/blog/nanoclaw-cost-and-safety) · [Back to Part 1: Why I Built This →](/blog/why-i-built-nanoclaw)*