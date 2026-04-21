/// This file contains the manifest of all blogs. Each blog is represented as an object with the following properties:
/// - title: The title of the blog post.
/// - date: The publication date of the blog post in YYYY-MM-DD format.
/// - slug: A URL-friendly identifier for the blog post, typically derived from the title.
/// - excerpt: A short summary or teaser of the blog post content.
/// - file: The path to the markdown file containing the full content of the blog post.

// ALWAYS ADD NEW BLOGS (BASED ON DATE) TO THE TOP OF THE LIST

const blogManifest = [
  {
    title: "The Architecture: How Three Agents, a JSON File, and Git Worktrees Became a System",
    date: "2026-04-19",
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
