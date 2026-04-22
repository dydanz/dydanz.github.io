---
title: "From Discord Command to GitHub PR: What Actually Happens"
date: 2026-04-19
slug: nanoclaw-full-flow
series: Building NanoClaw
part: 3
excerpt: "A step-by-step walkthrough of what NanoClaw does when you send it a message — the happy path, the failure modes, and what the Discord thread looks like when it's working."
repo: https://github.com/dydanz/kandangkambing
---

*Part 3 of a series on building NanoClaw — following a single feature request from chat message to merged pull request.*

---

The [previous post](02-architecture.md) described the architecture — agents, memory, worktrees, the workflow engine. That's the blueprint. This post is the actual construction site. I'm going to walk through what happens, step by step, when you type a message in Discord and wait for a PR to show up.

I'm using the health check endpoint as the example because it's simple, self-contained, and — more importantly — because it's one of the first features I actually ran through the system end-to-end. The early PRs in [kandangkambing](https://github.com/dydanz/kandangkambing) were built this way. There are 10 PRs in the repo now (9 merged, 1 open), and following this flow is how most of them got there.

---

## Step 0: you type a message

You're on your phone. Maybe you're on the couch, maybe you're at a coffee shop. You open Discord and type:

```
@NanoClaw feature add a health check endpoint that returns service status
```

That's it. That's your entire contribution to this feature. Everything that follows happens on the Mac Mini sitting on your desk at home.

The bot is listening for `on_message` events. When it sees its own mention, it strips the mention and passes the rest to the orchestrator:

```python
# bot.py
@self.event
async def on_message(message: discord.Message):
    if self.user not in message.mentions:
        return
    await self.orchestrator.handle(message)
```

The orchestrator does something important before any AI runs: it checks whether you're allowed to be here at all. Three gates, in order.

**Auth check** — is your Discord user ID in the allowlist? This is a flat list in the config. If you're not on it, the message gets silently ignored. No error, no response, nothing. I didn't want the bot to acknowledge unauthorized users at all.

**Rate limit check** — have you sent too many commands in the last hour? Early on, I accidentally triggered a loop where a poorly worded command caused the bot to retry indefinitely. The rate limiter exists because of that specific incident.

**Budget guard** — has today's LLM spending hit the daily cap? The budget tracker adds up estimated token costs for every API call. At 80% of the limit, it warns you. At 100%, it stops accepting new jobs. This one saved me real money — there's a story about that in Part 6.

If all three pass, the orchestrator creates a job, enqueues it, and posts a reply in a new Discord thread: *"Got it. Starting work on your feature request..."*

The Discord handler returns immediately. The actual work happens asynchronously in the background. This matters — if the bot blocked on every request, it couldn't handle multiple commands or respond to status queries while a job was running.

---

## Step 1: the PM agent breaks it down

The job queue picks up the task and calls `WorkflowEngine.run_feature()`. First stop: the PM agent.

The PM agent's system prompt is deliberately strict. It's told to produce JSON only — no prose, no "Sure, I'd be happy to help!" preamble, no explanations. Just a structured array of tasks. Each task gets an ID, a title, a description, acceptance criteria, dependencies, and a priority.

The prompt also loads project context from `memory/context/` — things like what framework the project uses, what the file structure looks like, what coding conventions to follow. This context is what turns a generic spec into one that's actually useful for *your* codebase.

For the health check request, the PM agent (running on GPT-4o) produces something like:

```json
{
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Add health check endpoint",
      "description": "Create GET /health endpoint returning JSON with service status, uptime, and version",
      "acceptance_criteria": [
        "GET /health returns HTTP 200",
        "Response body is valid JSON",
        "Response includes 'status', 'uptime_seconds', and 'version' fields",
        "Endpoint is accessible without authentication"
      ],
      "dependencies": [],
      "priority": "high"
    }
  ]
}
```

The workflow engine parses this, creates Task records in the TaskStore (that JSON file from Part 2), and sorts them by dependency order. For a single task with no dependencies, sorting is trivial — it just runs it. For multi-task features where TASK-003 depends on TASK-001 and TASK-002, the topological sort matters.

A small thing that took me longer than expected: parsing the PM agent's JSON output reliably. Even with a strict "JSON only" prompt, GPT-4o occasionally wraps the output in markdown code fences (` ```json ... ``` `). The parser strips those before attempting `json.loads()`. It's the kind of thing you don't think about until it breaks at midnight.

---

## Step 2: the Dev agent sets up a worktree

The Dev agent receives the task. Before any AI touches any code, it sets up an isolated workspace:

```python
# agents/dev.py
async def implement(self, task: Task) -> DevResult:
    worktree_path = await self.git_tool.create_worktree(task.id)
    instruction = self._build_instruction(task)
    result = await self.claude_code.run(instruction, worktree_path)
    files_changed = await self.git_tool.get_changed_files(worktree_path)
    return DevResult(
        verification_passed=result.success,
        worktree_path=worktree_path,
        branch=f"nanoclaw/{task.id}-add-health-check-endpoint",
        files_changed=files_changed,
        output=result.output
    )
```

The `_build_instruction` method is where the task spec gets turned into an actual instruction for Claude Code. It combines the task title, description, acceptance criteria, and any relevant project context into a single prompt. The context files — `project_overview.md`, `architecture.md`, `conventions.md` — are critical here. Without them, Claude Code will make reasonable guesses about your project structure, but "reasonable" and "correct for *this* project" are often different things.

For example, if your context file says "all routes live in `app/routes/` and follow the Flask blueprint pattern," Claude Code will create `app/routes/health.py` with a proper blueprint. Without that context, it might create a `health_endpoint.py` in the project root with a standalone Flask app. Technically correct. Totally wrong for your codebase.

---

## Step 3: Claude Code runs

This is where the actual coding happens. `ClaudeCodeTool` spawns a subprocess running the `claude` CLI, pointed at the worktree directory:

```python
# tools/claude_code.py
async def run(self, instruction: str, worktree_path: str) -> ToolResult:
    process = await asyncio.create_subprocess_exec(
        "claude", "-p", instruction,
        "--output-format", "json",
        "--max-turns", "10",
        cwd=worktree_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, 'CLAUDE_CODE_ENTRYPOINT': 'nanoclaw'}
    )
    stdout, stderr = await asyncio.wait_for(
        process.communicate(),
        timeout=300  # 5-minute hard timeout
    )

    if process.returncode == 0:
        return await self.verification.verify(worktree_path, stdout.decode())
    return ToolResult(success=False, error=stderr.decode())
```

Two safety rails worth mentioning. The `--max-turns 10` flag limits how many tool-use cycles Claude Code can do per invocation. Without this, a task like "refactor the entire auth module" could spiral into dozens of turns and burn through your API budget. The 5-minute timeout is the harder backstop — if Claude Code is still running after 5 minutes, the process gets killed and the task retries.

After Claude Code finishes, a verification layer runs before anything else happens:

1. Did the files Claude Code was supposed to create actually get created?
2. Does the Python code pass a basic syntax check (`py_compile`)?
3. Do the existing tests still pass (`pytest tests/ -x` — fail fast on first error)?

If any of these fail, `verification_passed` comes back as `False`, and the workflow engine retries from scratch. New worktree, new Claude Code run. No partial state carried forward.

This verification step caught more bugs than I expected. The most common failure: Claude Code creates a file but imports a module that doesn't exist in the project. The syntax check passes (the import is valid Python), but the tests fail because the module isn't there. Without this step, QA would pass the task (it doesn't run the code), and I'd discover the import error when I tried to actually use the feature.

---

## Step 4: QA evaluates the output

If verification passes, the QA agent gets called. It receives the task (with acceptance criteria) and the dev result (list of changed files, the branch name, Claude Code's output).

The QA agent's job is straightforward: for each acceptance criterion, determine whether it was met. Its system prompt enforces structured JSON output — no narratives, just a verdict per criterion:

```json
{
  "passed": true,
  "criteria": [
    {"criterion": "GET /health returns HTTP 200", "passed": true,
     "reason": "Route registered with @app.route('/health') returning jsonify response"},
    {"criterion": "Response body is valid JSON", "passed": true,
     "reason": "Uses Flask jsonify() which guarantees valid JSON"},
    {"criterion": "Response includes status, uptime_seconds, and version fields", "passed": true,
     "reason": "All three fields present in response dict"},
    {"criterion": "Endpoint is accessible without authentication", "passed": true,
     "reason": "No @login_required or auth middleware on this route"}
  ],
  "feedback": "All criteria satisfied."
}
```

If any criterion fails, `passed` is `false`, and the workflow engine retries. Up to `max_retries` times — default is 2, so you get 3 total attempts (initial + 2 retries).

One thing I mentioned in Part 2 that's worth repeating: the QA agent doesn't read the actual file contents right now. It sees the task spec and the list of changed files, and it reasons about whether the criteria are met based on what Claude Code reported doing. This is a known limitation. It means QA can confirm "a file called `health.py` was created" but can't catch "the route returns a 200 but the response body is missing the `version` field." The verification step (syntax + tests) covers some of that gap, but not all of it.

This is one of the changes in PR #10 — the new `CodeReviewerAgent` actually reads the PR diff, which is closer to what QA should have been doing all along. More on that in a later post.

---

## Step 5: the approval gate

QA passed. The bot has code it's reasonably confident about. Now it stops and waits for you.

The approval gate posts a message to the Discord thread:

```
✅ Task TASK-001 — Add health check endpoint

QA passed (4/4 criteria).

Files changed:
  • app/routes/health.py (new)
  • tests/test_health.py (new)

React with ✅ to approve and push, or ❌ to reject.
```

Under the hood, this is an `asyncio.Future` that gets resolved when `on_reaction_add` fires with the right emoji from an authorized user:

```python
# workflow/approval_gate.py
async def request(self, task: Task, dev_result: DevResult) -> bool:
    future = asyncio.get_event_loop().create_future()
    self._pending[task.id] = future
    await self._post_approval_message(task, dev_result)
    return await asyncio.wait_for(future, timeout=3600)  # 60-min timeout
```

The 60-minute timeout exists because I forgot to check Discord once and the bot sat waiting for 14 hours. Now, if you don't respond within an hour, the task fails and the worktree gets cleaned up. The code stays in the branch though — if you want to pick it up later, you can re-run the task.

While it's waiting for your reaction, the event loop is free. Other jobs can continue. Status queries get answered. The bot isn't blocked — just this particular task's future is pending.

This is also where the system recently got more sophisticated. In PR #10 (the one currently open), I added a **dual-signal approval gate**: the task can be approved either by reacting in Discord *or* by merging the PR directly on GitHub. Whichever happens first wins. The idea is that if I'm already looking at the PR on GitHub and it looks good, I shouldn't have to switch back to Discord to click a button.

---

## Step 6: commit, push, PR

You react with ✅ from your phone. The approval gate resolves the future with `True`. The workflow engine calls `commit_and_push()`:

```python
# agents/dev.py
async def commit_and_push(self, task: Task, dev_result: DevResult) -> PRInfo:
    await self.git_tool.commit(
        worktree_path=dev_result.worktree_path,
        message=f"feat({task.id}): {task.title}"
    )
    await self.git_tool.push(branch=dev_result.branch)
    pr_url = await self.git_tool.create_pr(
        branch=dev_result.branch,
        title=task.title,
        body=self._build_pr_body(task)
    )
    pr_number = int(pr_url.rstrip("/").split("/")[-1])
    await self.git_tool.remove_worktree(dev_result.worktree_path)
    await self.task_store.update(task.id, status="done", pr_url=pr_url)
    return PRInfo(url=pr_url, number=pr_number)
```

The PR description is generated from the task — title, description, acceptance criteria as a checklist, list of files changed. The commit message follows conventional commits (`feat(TASK-001): Add health check endpoint`), which is a small thing but makes the git log readable when you're scrolling through it later.

Then the worktree gets deleted. Clean. The Discord thread gets a final message:

```
🎉 Done! PR opened:
https://github.com/dydanz/kandangkambing/pull/4
```

That `PRInfo` return type — a namedtuple with `url` and `number` — was added in one of the commits on the `feat/code-reviewer-agent` branch (PR #10). Before that, `commit_and_push` returned just the URL string. I needed the PR number so the CodeReviewerAgent could fetch the diff with `gh pr diff <number>`. Small refactor, but it shows how the system evolves: you build a feature, realize you need a hook point that doesn't exist yet, and go back to add it.

---

## What the timeline actually looks like

For a single-task feature with no retries, from message to PR:

```
T+0s      Discord message received
T+1s      Auth / rate limit / budget checks pass
T+2s      Job enqueued, thread created
T+3s      PM agent starts (GPT-4o)
T+15-20s  PM agent returns tasks, TaskStore updated
T+22s     Dev agent creates worktree
T+25s     Claude Code starts running
T+60-120s Claude Code finishes writing code
T+125s    Verification runs (syntax + tests)
T+130s    QA agent evaluates (Claude Sonnet)
T+145s    Approval message posted to Discord
T+???     You check your phone, react ✅
T+???+2s  Commit, push, PR created
T+???+5s  Discord: "Done! PR: https://..."
```

The total machine time is usually under 3 minutes. The total wall-clock time is however long it takes you to notice the notification and react. For me, that's usually 5-30 minutes — which is fine. That's the point. I don't need to be watching it happen.

For a multi-task feature (say, the PM agent produces 4 tasks with dependencies), multiply the Dev+QA portion by the number of tasks. Each task gets its own worktree and its own approval message. You approve them individually. This is deliberate — I want to be able to reject task 3 without losing tasks 1 and 2.

---

## The failure modes I actually hit

Building this system, I kept a running list of things that went wrong. Not theoretical failure modes — things that actually broke in practice, with real PRs.

**Claude Code writes code for the wrong framework.** The project uses Flask, but without context, Claude Code sometimes reaches for FastAPI (probably because it's more common in its training data). The fix was adding more detail to `memory/context/project_overview.md` — not just "this is a Flask project" but "routes use Flask blueprints, see `app/routes/` for examples." Specific context beats generic context every time.

**JSON parsing fails on the PM agent's output.** GPT-4o wraps its JSON in markdown fences about 15% of the time, even with a strict "no prose, no markdown, just JSON" prompt. The fix is a preprocessing step that strips ` ```json ` and ` ``` ` before parsing. Boring. Necessary.

**Verification passes but the feature doesn't actually work.** This happens when Claude Code creates a new file that doesn't get imported anywhere. The file exists, the syntax is valid, the tests pass (because there are no tests for the new feature yet and the old tests don't import it). But the endpoint isn't actually reachable because the blueprint isn't registered. The fix is better acceptance criteria — "the health endpoint is registered in the app factory" is more useful than "the health endpoint exists."

**The approval gate times out.** The 60-minute timeout was originally 24 hours. I changed it after a weekend where I forgot to check Discord, the bot had created 6 worktrees, and my disk was getting full. Shorter timeout, auto-cleanup. Lesson: resources should not accumulate silently.

**PR creation fails because `gh` CLI isn't authenticated.** The GitHub CLI needs to be logged in on the Mac Mini, and the auth token can expire. This manifests as `commit_and_push` throwing an exception after the commit and push succeed but before the PR gets created. The code is on the remote branch, the worktree is still alive, but there's no PR. I added a try/except around `create_pr` that posts the error to Discord and tells you the branch name so you can open the PR manually.

---

## How the PR history tells the story

If you look at the [kandangkambing repo](https://github.com/dydanz/kandangkambing), the PRs trace the evolution of the system itself:

The early PRs (#1 through #5 or so) are the foundation — the basic agents, the orchestrator, the memory layer, the workflow engine. Each one small, each one testable.

The later PRs are where things got interesting. PR #10, which is currently open, adds a `CodeReviewerAgent` — a fourth agent that runs *after* QA passes and the PR is created. It fetches the PR diff using `gh pr diff`, sends it to an LLM with a code review prompt, and posts its findings as a GitHub comment. If it finds critical issues, it blocks the Discord approval gate and tells you to review the PR on GitHub directly.

That PR has 19 commits, most co-authored with Claude Sonnet 4.6. It also has review comments from GPT-5.4-Mini via Codex — yes, an AI reviewing the code of a system that uses AI to write code that gets reviewed by AI. It caught a real bug, too: the `review override` command couldn't actually unblock PRs blocked by critical findings because the approval gate was never populated in the critical-findings path. That's the kind of thing a human reviewer might miss on first pass.

194 tests passing, up from about 150 before that branch. The test count tells its own story about the system growing more robust over time.

---

## The honest take on this flow

When it works — and it works most of the time now — this flow feels almost mundane. You type a message, notifications happen in the background, you react from your phone, a PR appears. It's not magic. It's just... delegation to a process that does the tedious parts.

When it doesn't work, the failure is usually loud and obvious. A timeout, a parse error, a missing import. The system is designed to fail visibly rather than silently produce garbage. Every failure posts to Discord. Every retry is logged. If something goes wrong, I know about it within minutes, and I know exactly which step failed.

The hardest part of building this wasn't any individual piece. It was getting all the pieces to hand off to each other reliably — the JSON that needs to parse, the worktree that needs to exist, the subprocess that needs to finish, the approval that needs to resolve. The orchestration code is 80% error handling. That's not a complaint. That's the reality of systems that coordinate multiple unreliable components.

In the next post, I'll dig into the LLM routing layer — why GPT-4o writes better specs, why Claude writes better code, and how the routing table evolved from "use Claude for everything" to a multi-provider setup that's both cheaper and better.

---

*Part 3 of 7 — [← Part 2: The Architecture](/blog/nanoclaw-architecture) · Part 4: Coming Soon*