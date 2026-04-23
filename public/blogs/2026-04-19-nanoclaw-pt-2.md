---
title: "The Architecture: How Three Agents, a JSON File, and Git Worktrees Became a System"
date: 2026-04-19
slug: nanoclaw-architecture
series: Building NanoClaw
part: 2
excerpt: "How NanoClaw's PM → Dev → QA pipeline came together — the design decisions that worked, the ones I'd redo, and why a flat JSON file was both the best and worst choice I made."
repo: https://github.com/dydanz/kandangkambing
---

*Part 2 of a series on building NanoClaw — the design decisions behind the multi-agent pipeline, and the ones I'd revisit.*

---

In [Part 1](/blog/why-i-built-nanoclaw), I talked about why I built NanoClaw — the itch, the experiment, and the moment a weekend project grew legs. This post is about how the system is actually put together. Not the aspirational version, but the real one: what's in the repo, how the pieces connect, and where I made trade-offs I'm still thinking about.

If you want to follow along, the code is at [github.com/dydanz/kandangkambing](https://github.com/dydanz/kandangkambing). The repo is Python, built on top of NanoClaw's lightweight agent framework, with specs under `docs/specs/`, agent configurations in `.claude/`, and the core engine under `nanoclaw/`.

---

## I started with the wrong question

My first instinct was: *how do I make Claude Code do more?*

That's the wrong framing. Claude Code is already good at writing code when you give it clear instructions. The problem was never the coding — it was everything before and after the coding. Turning a vague idea into a clear spec. Checking whether the output actually matched what I meant. Deciding if the result was safe to merge.

The better question turned out to be: *what needs to happen before Claude Code runs, and what needs to happen after?*

Once I framed it that way, the architecture basically drew itself.

---

## Three agents, three jobs, one pattern

NanoClaw has three agents. Each one does exactly one thing.

The **PM Agent** takes a feature request — usually something loose like "add user authentication" — and turns it into structured tasks with explicit acceptance criteria. It doesn't write code. It doesn't evaluate code. It produces a spec and stops.

The **Dev Agent** takes a single task from that spec and implements it. It creates an isolated git worktree, runs Claude Code with the task as its instruction, and returns the result. It doesn't decide if the result is good enough. It just produces output.

The **QA Agent** evaluates the Dev Agent's output against the acceptance criteria from the PM Agent. Each criterion either passed or failed, with a reason. It doesn't rewrite anything. It just validates.

What's interesting is that all three agents share the same structural pattern:

```python
# agents/base.py
class BaseAgent:
    def __init__(self, name, system_prompt, tools):
        self.name = name
        self.system_prompt = system_prompt
        self.tools = tools
        self.memory = SharedMemory()

    async def handle(self, user_message, context):
        # 1. Load relevant memory
        history = await self.memory.get_relevant(user_message)
        # 2. Build prompt with context
        prompt = self.build_prompt(user_message, history, context)
        # 3. Call LLM (routed by task type)
        response = await self.call_llm(prompt)
        # 4. Execute any tool calls
        result = await self.execute_tools(response)
        # 5. Save to memory
        await self.memory.save(user_message, result)
        return result
```

Each agent loads its own system prompt from a markdown file, builds a message history from shared memory, and routes through the LLM router. The only things that differ between agents are the prompt, the task type (which determines which model gets called), and which tools they have access to.

I spent an embarrassing amount of time over-engineering this before realizing: the agents aren't the complicated part. The coordination between them is.

---

## Why separate planning from implementation?

I didn't start with three agents. I started with one.

The first version just handed the raw feature request directly to Claude Code. "Add user authentication with JWT tokens." One agent, one shot.

It worked maybe a third of the time.

The failure mode was predictable in retrospect: the model would start writing code before thinking through the edge cases. It would produce something that compiled and ran but didn't actually cover what I meant. "Add user authentication" could mean a dozen different things, and without explicit constraints, the model would pick whichever interpretation required the least work — which was rarely the one I had in mind.

The moment I added the PM Agent as a separate step, the success rate jumped. Not because the PM Agent is especially clever, but because it forces a planning phase before any code gets written. The PM has to produce explicit acceptance criteria — things like "passwords are hashed, never stored in plain text" and "invalid tokens return 401" — and those criteria become the contract for everything downstream.

The Dev Agent reads them as its instruction set. The QA Agent uses them as its validation checklist. When something fails, it fails against a specific criterion, not a vague feeling. And when I need to debug, I can look at the PM's output and immediately see whether the problem was a bad spec or a bad implementation.

This also meant I could iterate on each stage independently. Bad specs? Tweak the PM's system prompt. Correct spec but wrong code? That's a Dev Agent problem. Code looks fine but QA keeps failing? The QA prompt needs work. The stages fail independently, which makes the whole thing debuggable.

---

## The workflow engine: where the coordination lives

The agents themselves are stateless. They take an input, produce an output, and forget everything. The state — what task we're on, how many retries we've used, whether QA passed — lives in the workflow engine.

```python
# workflow/engine.py — simplified core loop
async def _run_task(self, task: Task, session_id: str) -> TaskResult:
    for attempt in range(1, task.max_retries + 1):
        # Dev implements in a fresh worktree
        dev_result = await self.dev_agent.implement(task)

        if not dev_result.verification_passed:
            continue  # syntax check or test failed, retry

        # QA validates against acceptance criteria
        qa_result = await self.qa_agent.handle(task, dev_result)

        if qa_result.passed:
            # Post to Discord, wait for human ✅ or ❌
            approved = await self.approval_gate.request(task, dev_result)
            if approved:
                await self.dev_agent.commit_and_push(task, dev_result)
                return TaskResult(success=True, pr_url=task.pr_url)

    return TaskResult(success=False, reason="max retries exceeded")
```

Two design decisions worth calling out here.

First, retries happen at the task level. If Dev or QA fails, the whole task starts over in a fresh worktree. This is more expensive than partial retries — you're throwing away the previous attempt and starting from scratch — but it's much simpler to reason about. There's no state to corrupt, no half-finished code to work around. The worktree gets deleted, a new one gets created, and we try again clean.

Second, `commit_and_push` only runs after human approval. The code can be done. QA can pass. Everything can look perfect. And it still sits in a worktree on my Mac Mini until I open Discord and react with ✅. That was a non-negotiable for me. I'm willing to delegate the work, not the judgment.

---

## Git worktrees: the decision I'm most happy about

Every task runs in its own git worktree. This was the single best architectural decision in the project.

If you haven't used worktrees before, the idea is simple: instead of switching branches in your repo (which changes your working directory), you create a completely separate directory that's linked to the same git history but checked out on its own branch. You can have ten worktrees, each on a different branch, all running at the same time without interfering with each other.

```python
# tools/git_tool.py
async def create_worktree(self, task_id: str) -> str:
    branch = f"nanoclaw/{task_id}-{slug}"
    worktree_path = os.path.join(self.worktree_base, task_id)
    await self._run(["git", "worktree", "add", "-b", branch, worktree_path])
    return worktree_path
```

Every branch NanoClaw creates is prefixed with `nanoclaw/` — so when you look at your branches, you can immediately tell which ones were created by the bot versus by a human. It's a small thing, but it matters when you're looking at a branch list and trying to figure out what happened while you were away.

When a task starts, the engine creates a new worktree. Claude Code runs inside that directory — `cwd` is set to the worktree path, so it can only see and modify files in that isolated checkout. When the task is done, the engine reads the changed files with `git diff --name-only`, and if everything gets approved, it commits and pushes from the worktree. Then the worktree gets deleted.

If a task fails? Delete the worktree. The main repo is untouched. No half-written files, no uncommitted changes, no stale branches. Just a deleted directory.

This also means multiple tasks can theoretically run in parallel — each in its own worktree, on its own branch, writing to its own directory. In practice I cap concurrency at 2 (the Mac Mini isn't a build farm), but the architecture supports it.

---

## Memory: conversations and tasks

NanoClaw has two persistence layers, and they serve different purposes.

**SharedMemory** is an SQLite database that stores conversation history — every message sent between agents, between me and the bot, and system events. When an agent builds its context for the next call, it loads the last N messages for that session. This is what gives agents "memory" within a task.

```sql
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    role TEXT NOT NULL,        -- 'user', 'pm', 'dev', 'qa', 'system'
    agent TEXT,
    content TEXT NOT NULL,
    task_id TEXT,
    metadata TEXT              -- JSON blob for extra info
);
```

**TaskStore** is a flat JSON file that stores task state — title, description, status, acceptance criteria, retry count, PR URL. It looks like this:

```json
{
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Add /health endpoint",
      "description": "Create a GET /health endpoint that returns 200 OK...",
      "status": "open",
      "priority": "high",
      "created_by": "pm",
      "assigned_to": "dev",
      "acceptance_criteria": [
        "Returns HTTP 200 with JSON body",
        "Includes uptime in response",
        "Has unit test coverage"
      ],
      "created_at": "2026-03-26T10:00:00Z",
      "updated_at": "2026-03-26T10:00:00Z"
    }
  ]
}
```

I chose JSON for tasks deliberately. Task state changes infrequently — it gets written when the PM creates a spec and updated when a task moves through the pipeline. There's only ever one writer at a time. And I wanted to be able to open the file in any text editor and see exactly what was happening without needing a database client. When something goes wrong at 11pm and I'm debugging from my phone, being able to just read a JSON file is worth more than any performance optimization.

There's also a third layer: **context files**. These are markdown documents that live in `nanoclaw/memory/context/` and contain project-level information — architecture decisions, coding conventions, project overview. They're loaded into every agent's system prompt, so all three agents share the same understanding of the project.

```
nanoclaw/
  memory/
    conversations.db          # SQLite: all chat history
    tasks.json                # Current task states
    context/
      project_overview.md     # What the project is about
      architecture.md         # Technical decisions
      conventions.md          # Coding standards
      agent_notes.md          # Cross-agent observations
```

The agents don't talk to each other directly. They communicate through these shared stores. PM writes a spec to `tasks.json`. Dev reads the spec from `tasks.json`, implements it, and updates the status. QA reads the spec plus the code diff, validates, and writes the result. No complex inter-agent messaging. No event bus. Just files and a database.

I know this sounds almost too simple. It is simple. That's the point.

---

## The LLM router: using the right model for the right job

Not every agent needs the same model. The PM Agent writes structured specs — JSON-like outputs with clear fields. GPT-4o is better at that than Claude, at least in my testing. The Dev Agent runs Claude Code, which is Claude by definition. The QA Agent does reasoning about whether criteria are met — Claude Sonnet handles that well at lower cost than Opus.

The router is a lookup table:

```python
class LLMRouter:
    async def route(self, task_type, prompt, **kwargs):
        model_map = {
            'coding':    ('anthropic', 'claude-sonnet-4-20250514'),
            'review':    ('anthropic', 'claude-sonnet-4-20250514'),
            'spec':      ('openai',    'gpt-4o'),
            'simple':    ('anthropic', 'claude-haiku-4-5-20251001'),
            'test':      ('anthropic', 'claude-sonnet-4-20250514'),
            'summarise': ('openai',    'gpt-4o-mini'),
        }

        provider, model = model_map.get(
            task_type,
            ('anthropic', 'claude-sonnet-4-20250514')  # default
        )

        if provider == 'anthropic':
            return await self._call_anthropic(model, prompt, **kwargs)
        elif provider == 'openai':
            return await self._call_openai(model, prompt, **kwargs)
```

There's also a fallback chain: if the primary model fails (rate limit, outage, whatever), the router tries the next one down. Claude Sonnet → GPT-4o → Gemini Pro → Claude Haiku. If everything's down — which has happened exactly once — the bot posts an error to Discord and retries in 60 seconds.

The cost difference matters more than I expected. Running everything through Claude Sonnet cost roughly 2-3x more than the routed setup, and the routed version actually produced better specs because GPT-4o is genuinely better at that specific task. Routing isn't just a cost optimization — it's a quality one.

---

## The full picture

Here's how all the pieces connect, from the moment I send a Discord message to the moment a PR gets opened:

```
Discord Message
  → Auth check (is this user allowed?)
  → Rate limit check (too many calls recently?)
  → Budget check (daily limit reached?)
  → Job Queue (max 2 concurrent jobs)
      → PM Agent (GPT-4o: spec + tasks)
      → For each task:
          → Dev Agent (Claude Code: implementation in worktree)
          → QA Agent (Claude Sonnet: acceptance criteria evaluation)
          → If passed: Approval Gate (Discord reaction)
          → If approved: commit + push + open PR
  → Discord thread: summary + PR link
```

What I like about this structure is that each layer has a clear boundary. The agents don't know about Discord — they receive instructions and return results. The workflow engine doesn't know about LLM providers — it calls agents and manages state. The safety layer (auth, rate limit, budget) runs before anything else starts. Changing one component doesn't ripple through the rest.

The repo at `kandangkambing` reflects this: the `nanoclaw/` directory contains the orchestrator, agents, tools (git operations, Claude Code wrapper), and memory layer. The `docs/specs/` directory has the original design specs I wrote before building anything. The `.claude/` directory has the agent configuration files — system prompts, tool definitions, project context.

It's 21 commits as of this writing. Not a lot. But each one represents a real decision that got tested against an actual feature request, not a theoretical design exercise.

---

## What I'd design differently

I've been living with this architecture for a few weeks now, and there are three things I'd change.

**The task store should be SQLite, not JSON.** I defended the JSON choice earlier, and I still think it was right for getting started fast. But it's fragile. If the process crashes mid-write, you can corrupt the file. I've added a file lock, which helps, but SQLite handles concurrent access and crash recovery natively. Both persistence layers should use SQLite. I just haven't done the migration yet because, honestly, the JSON file hasn't actually corrupted on me — and I've learned not to fix things that aren't broken on side projects, even if I know they will be eventually.

**The QA Agent needs to read actual file contents.** Right now, QA sees the task description and the list of changed files. It doesn't read the code itself. This means it can confirm "a file called `auth.py` was created" but can't catch "the JWT validation logic has a subtle bug." I added a verification step at the Claude Code layer — syntax checks, test runs — which catches the obvious stuff. But the QA agent itself could be much smarter if it had access to the diff.

**Retry feedback should be passed forward.** When a task fails and retries, the Dev Agent starts cold — fresh worktree, no memory of the previous attempt. A smarter approach would feed QA's failure feedback back to the Dev Agent as context: "Last attempt failed because the `/me` endpoint returned 200 on invalid tokens. Fix this specifically." That would make retries cheaper and more targeted. Right now, each retry is essentially a coin flip with the same odds, which is wasteful.

---

In the next post, I'll walk through the full end-to-end flow in detail — what actually happens at each step, what the Discord messages look like, and what Claude Code does inside the worktree when it's implementing a task.

---

*Part 2 of 7 — [← Part 1: Why I Built This](/blog/why-i-built-nanoclaw) · [Part 3: The Full Flow →](/blog/nanoclaw-full-flow)*
