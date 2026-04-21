---
title: "I Built a Discord Bot That Writes Code and Opens PRs For Me"
date: 2026-04-19
slug: why-i-built-nanoclaw
series: Building NanoClaw
part: 1
excerpt: "How a side-project itch turned into a multi-agent AI system that goes from a chat message to a GitHub pull request — without me touching an IDE."
repo: https://github.com/dydanz/kandangkambing
---

*Part 1 of a series on building NanoClaw — a multi-agent AI system that goes from Discord message to GitHub PR, autonomously.*

---

I have a problem with side projects.

Not the usual "I start things and never finish them" problem — although I have that one too. My problem is more specific: I'll have an idea that I know exactly how to implement, and then I'll spend the next hour doing everything *except* the interesting part.

Writing the model. Wiring the endpoint. Setting up the repository scaffolding. Writing tests that are basically the same tests I wrote last month for a different project. Opening a PR with a description that says "adds user login endpoint" as if that needed explaining.

None of it is hard. All of it is tedious. And by the time I push the branch, whatever spark I had when I first thought of the feature has quietly died.

I kept thinking: I already described what I wanted in a comment. Why am I still the one doing the typing?

---

## The experiment that started it

I'd been playing around with Claude Code — Anthropic's CLI tool that can read your codebase, understand the structure, and write code directly into it. The results were genuinely impressive. I'd give it a task like "add a `/health` endpoint that returns the service version," and it would find the right router file, follow the existing patterns, and produce something I'd actually merge.

But the workflow was still entirely manual. I'd write an instruction, run the CLI, review the output, maybe tweak something, commit, push, open a PR. Every step required me sitting at my keyboard. If I was on my phone, or out getting coffee, or just didn't feel like staring at a terminal — nothing happened.

So one evening I asked myself a stupid question: *what if I could just describe a feature in a chat message and come back to a pull request?*

I had a Mac Mini sitting on my desk that was basically an expensive paperweight at the time. Discord was already open on my phone. And I'd been reading about how people were wiring up AI agents to do multi-step work. The pieces were all there.

That was the seed of what became NanoClaw.

---

## What I thought I was building vs. what I actually built

The first version I sketched in my head was laughably simple: a Discord bot, maybe 200 lines of Python, that forwards messages to Claude Code and posts back the result. A weekend project.

Then I started thinking about what would actually need to be true for me to trust this thing running unattended.

If I send a message from my phone and this bot starts writing code in my repo while I'm not looking, a few things need to be in place. First, it shouldn't just start hacking away — it needs some kind of plan. "Add login" is not an instruction a developer would act on without asking clarifying questions; why should an AI? Second, it absolutely cannot write directly to `main`. I've seen what happens when I push without thinking; I don't need a bot doing the same. Third, I'd want something to check the output before I have to look at it — not a perfect code review, but at least a sanity check against what was asked for. And finally, I still want a human checkpoint before anything gets merged. I'm willing to delegate the work, not the judgment.

Each of those requirements turned into a component. The "make a plan first" part became a PM agent. The "don't touch main" constraint became git worktrees — isolated directories with their own branches. The "check your own work" part became a QA agent. And the "ask me before merging" part became a Discord reaction gate: the bot posts a summary, I react with ✅ or ❌ from my phone, and it proceeds accordingly.

The weekend project became a system with three agents, a shared memory layer, a multi-LLM routing table, and a budget tracker. The repo is called [kandangkambing](https://github.com/dydanz/kandangkambing) — "goat pen" in Indonesian — because every project I build eventually becomes some kind of organized chaos.

---

## How it actually works

Here's the full flow, from message to merged PR:

```
You (on your phone)
    │
    ▼
Discord message: "@NanoClaw PM define a user login feature"
    │
    ▼
PM Agent (GPT-4o/Opus)
    Creates structured tasks with acceptance criteria
    Saves to shared memory (tasks.json + SQLite)
    │
    ▼
Dev Agent (Sonnet/Opus)
    Reads task spec from memory
    Creates a git worktree (isolated branch)
    Implements the code
    │
    ▼
QA Agent (Claude Sonnet/Haiku)
    Reads acceptance criteria from memory
    Validates the implementation against them
    │
    ▼
Approval Gate (Discord)
    Posts a summary to your channel
    Waits for ✅ or ❌ reaction
    │
    ▼
Git push → GitHub PR opened
```

The agents don't talk to each other directly. They communicate through a shared memory layer — an SQLite database for conversation history, a JSON file for task states, and a set of markdown files for project context like architecture decisions and coding conventions. The PM writes a spec, it lands in memory, the Dev agent picks it up from there. No complex inter-agent messaging. Just files and a database.

The orchestrator — a Python process running on my Mac Mini — is what ties everything together. It parses Discord commands, figures out which agent should handle the request, and manages the handoff between stages. When you say `@NanoClaw Dev implement TASK-042 through TASK-047`, it queues each task, runs them through the Dev agent sequentially, feeds the results to QA, and posts the approval message when everything passes.

If QA fails, it retries. If I reject the approval, it stops. If the daily budget limit gets hit, it pauses and tells me.

---

## Why three agents instead of one

I tried the simpler version first. Just handing raw instructions directly to Claude Code and seeing what came back. It worked maybe 30% of the time.

The problem wasn't that the code was bad — it was usually technically correct. The problem was that it missed the point. "Add user authentication" could mean a dozen different things, and without structured acceptance criteria, there was no way to validate whether the output was what I actually wanted.

Adding the PM agent changed everything. Now when I say "add user login," the PM agent comes back with something like:

> **Feature:** User Authentication
> **Tasks:**
> - TASK-042: Create User model with email/password fields
> - TASK-043: Implement POST /auth/register endpoint
> - TASK-044: Implement POST /auth/login with JWT tokens
> - TASK-045: Create GET /auth/me endpoint
>
> **Acceptance Criteria:**
> - Users can register with email and password
> - Passwords are hashed, never stored in plain text
> - Login returns a JWT token
> - /me endpoint returns user profile when authenticated
> - Invalid tokens return 401

Now the Dev agent has a clear scope. And more importantly, the QA agent has concrete criteria to validate against. The three-agent structure isn't about complexity for its own sake — it's about giving each stage something specific to work with.

---

## Why Discord, of all things

I get this question a lot. Discord feels like an odd choice for a development tool. But I wasn't building a development tool — I was building a remote control for my Mac Mini.

Discord is where I already hang out for personal projects. It's on my phone. It has threads (one per task, for context), reactions (for approvals), embeds (for rich status updates), and mentions (for notifications when a job finishes). That's a surprisingly complete async workflow UI — and I didn't have to build any of it.

The bot responds in a thread, posts an approval message when it's ready, and I react from wherever I am. It feels like pinging a teammate, not like using a CI system.

I considered building a web UI. I considered a CLI wrapper. I even briefly considered Slack. But Discord gave me everything I needed with zero custom frontend work. For a side project built by one person, that matters.

---

## Things that surprised me

**Git worktrees are perfect for this.** Before this project, I'd barely used them. The idea is simple: instead of switching branches in your repo, you create a separate directory that's linked to the same git history but checked out on a different branch. Each task gets its own worktree, its own branch, and its own isolated workspace. If the agent produces garbage, you just delete the worktree. The main repo is never touched. If you're building anything where an AI needs to "try something and maybe throw it away," worktrees are worth learning.

**Cost tracking is non-negotiable.** Three LLM calls per task — PM, Dev, QA — each costing real money, each potentially triggering retries. The third time I checked my API dashboard and felt a small jolt of surprise, I added a daily budget guard. Now the bot warns me at 80% of the budget and hard-stops at 100%. It posts a message to Discord: "Daily budget reached. Pausing all work." I sleep better.

**Three LLM providers sounds like overkill, but it's practical.** I started with Claude for everything. Then I noticed GPT-4o was more reliable for producing structured JSON specs, so the PM agent switched to that. Then I added a cheaper model for summarization tasks that didn't need frontier-level intelligence. Now there's a routing table: each task type maps to a model, with a fallback chain if any provider is down. It's not elegant, but it's robust.

**The plumbing is 80% of the work.** The LLM calls — the "AI" part — are maybe 20% of the codebase. The rest is command parsing, memory management, git operations, error handling, retry logic, budget tracking, Discord formatting, and the hundred small decisions that make the difference between a demo and something you'd actually use. If you're thinking about building something like this, know that the interesting part is also the easy part.

---

## The repo, the code, the name

The whole thing lives at [github.com/dydanz/kandangkambing](https://github.com/dydanz/kandangkambing). It's Python, built on top of NanoClaw's architecture — a lightweight agent framework I adapted for this specific workflow. The repo has 21 commits as of this writing, a `.claude` directory with agent configurations, specs under `docs/specs`, and the NanoClaw core under `nanoclaw/`.

About that name: *kandangkambing* means "goat pen" in Indonesian. I name my side projects after things that sound chaotic but are, upon closer inspection, reasonably well-organized. A goat pen looks like a mess from the outside. But the goats know where things are.

---

## What's coming in this series

This is the first post in a seven-part series. Each one goes deeper into a specific part of the system:

1. **Why I Built This** — you're here
2. **The Architecture** — how the agents, memory layer, and orchestrator fit together, and the design decisions I'd make differently today
3. **From Discord to GitHub PR** — the full flow, step by step, with actual code
4. **LLM Routing** — using GPT-4o for specs, Claude for code, and cheaper models for everything else
5. **Human-in-the-Loop** — approval gates, async Discord reactions, and why I still don't trust full autonomy
6. **Staying Sane** — cost tracking, rate limits, budget guards, and the time I accidentally burned $40 in retries
7. **What I Learned** — the honest retrospective on building an autonomous code agent as a side project

---

## Before you continue

If you're thinking about building something like this, the honest take: it's more work than it looks, and more satisfying than you'd expect.

The hard part is not getting an LLM to write code. That part mostly works now. The hard part is everything around it — the state management, the error recovery, the safety rails, the part where you realize your bot just created seventeen branches because your retry logic had an off-by-one error.

But when it works — when you describe a feature on your phone, go make coffee, and come back to a PR that's actually correct — something does shift. Not in a "the future is here" way. More in a "huh, I didn't have to context-switch for that" way. Which, honestly, is better.

Next up: how the architecture came together, what the agents actually are, and the design decisions that looked smart at the time but turned out to be mistakes.

---

*Part 1 of 7 — [Next: The Architecture →](/blog/nanoclaw-architecture)*
