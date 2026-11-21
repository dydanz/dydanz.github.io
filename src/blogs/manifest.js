/// This file contains the manifest of all blogs. Each blog is represented as an object with the following properties:
/// - title: The title of the blog post.
/// - date: The publication date of the blog post in YYYY-MM-DD format.
/// - slug: A URL-friendly identifier for the blog post, typically derived from the title.
/// - excerpt: A short summary or teaser of the blog post content.
/// - file: The path to the markdown file containing the full content of the blog post.

// ALWAYS ADD NEW BLOGS (BASED ON DATE) TO THE TOP OF THE LIST

const blogManifest = [
  {
    title: "I Pressed Pay Twice: Idempotency and Concurrency",
    date: "2026-11-21",
    slug: "ledger-idempotency-concurrency",
    excerpt: "A retry has to stay a retry, and two payments can't both spend the same money. How a cloakroom ticket explains idempotency keys, why the ledger makes requests wait in line, and two bugs where my own safety rules got in the way.",
    file: "/blogs/2026-11-21-ledger-pt-4.md"
  },
  {
    title: "Your Balance Is a Story, Not a Number: Event Sourcing",
    date: "2026-11-20",
    slug: "ledger-event-sourcing",
    excerpt: "A parcel tracker doesn't store where your package is. It stores every scan, and works out the rest. Why a ledger should do the same, the life of a transaction from PENDING to SETTLED, and how to rebuild the present from the past.",
    file: "/blogs/2026-11-20-ledger-pt-3.md"
  },
  {
    title: "Never Erase, Only Add: The Double-Entry Journal",
    date: "2026-11-18",
    slug: "ledger-double-entry-journal",
    excerpt: "Why a ledger is written in ink, how a 500-year-old bookkeeping rule still catches bugs, and how you fix a mistake without deleting anything. Plus the database guard that a single TRUNCATE walked straight past.",
    file: "/blogs/2026-11-18-ledger-pt-2.md"
  },
  {
    title: "Money Doesn't Retry: Why Fintech Software Can't Just \"Try Again\"",
    date: "2026-11-18",
    slug: "ledger-money-doesnt-retry",
    excerpt: "Your app says the payment failed. Your bank says it went through. Which one is lying? Why money software plays by different rules, and the ledger I built to find out what those rules cost.",
    file: "/blogs/2026-11-18-ledger-pt-1.md"
  },
  {
    title: "What I Learned Building an Autonomous Code Agent",
    date: "2026-04-19",
    slug: "nanoclaw-lessons-learned",
    excerpt: "An honest retrospective on NanoClaw — what worked, what didn't, what I'd build differently, and what building a multi-agent system from scratch taught me about AI, engineering, and the gap between demos and daily use.",
    file: "/blogs/2026-04-19-nanoclaw-pt-7.md"
  },
  {
    title: "Staying Sane: The Unglamorous Infrastructure That Keeps the Lights On",
    date: "2026-04-19",
    slug: "nanoclaw-cost-and-safety",
    excerpt: "Cost tracking, rate limits, budget guards, emergency stops, and all the boring infrastructure that prevents an autonomous AI system from quietly ruining your evening.",
    file: "/blogs/2026-04-19-nanoclaw-pt-6.md"
  },
  {
    title: "Human-in-the-Loop: Why My Bot Asks Permission Before Pushing Code",
    date: "2026-04-19",
    slug: "nanoclaw-approval-gates",
    excerpt: "How NanoClaw waits for a human reaction without freezing, the evolution from simple emoji gates to dual-signal approval, and the bug an AI reviewer caught in the approval logic itself.",
    file: "/blogs/2026-04-19-nanoclaw-pt-5.md"
  },
  {
    title: "LLM Routing: Why I Use Three Different AI Providers (And How I Stopped Overpaying)",
    date: "2026-04-19",
    slug: "nanoclaw-llm-routing",
    excerpt: "Not every task needs the same model. How NanoClaw picks between Claude, GPT-4o, and Gemini — and the $40 mistake that made cost tracking non-negotiable.",
    file: "/blogs/2026-04-19-nanoclaw-pt-4.md"
  },
  {
    title: "From Discord Command to GitHub PR: What Actually Happens",
    date: "2026-04-21",
    slug: "nanoclaw-full-flow",
    excerpt: "A step-by-step walkthrough of what NanoClaw does when you send it a message — the happy path, the failure modes, and what the Discord thread looks like when it's working.",
    file: "/blogs/2026-04-19-nanoclaw-pt-3.md"
  },
  {
    title: "The Architecture: How Three Agents, a JSON File, and Git Worktrees Became a System",
    date: "2026-04-20",
    slug: "nanoclaw-architecture",
    excerpt: "How NanoClaw's PM → Dev → QA pipeline came together — the design decisions that worked, the ones I'd redo, and why a flat JSON file was both the best and worst choice I made.",
    file: "/blogs/2026-04-19-nanoclaw-pt-2.md"
  },
  {
    title: "I Built a Discord Bot That Writes Code and Opens PRs For Me",
    date: "2026-04-19",
    slug: "why-i-built-nanoclaw",
    excerpt: "How a side-project itch turned into a multi-agent AI system that goes from a chat message to a GitHub pull request — without me touching an IDE.",
    file: "/blogs/2026-04-19-nanoclaw-pt-1.md"
  },
  {
    slug: "hello-world",
    title: "Hello, World.",
    date: "2026-04-18",
    excerpt: "No grand plan, no content calendar — just a commitment to show up and write.",
    file: "/blogs/2026-04-18-hello-world.md"
  }, 
];

export default blogManifest;
