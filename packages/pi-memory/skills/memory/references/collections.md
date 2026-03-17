# Memory Collections

Bosun memory is intentionally curated. The goal is retrieval over useful
markdown knowledge, not indexing every file in the repository.

## Default collections

### `sessions`
Source: `workspace/users`
Pattern: `**/*.md`

Use for:
- prior session summaries
- plans
- handoffs
- chronicles stored in user workspace

### `docs`
Source: `docs`
Pattern: `**/*.md`

Use for:
- user manuals
- guides
- architecture docs
- package docs

### `skills`
Source: `.pi/skills`
Pattern: `**/*.md`

Use for:
- skill instructions
- skill references
- reusable process docs

### `agents`
Source: `.pi/agents`
Pattern: `**/*.md`

Use for:
- agent role definitions
- frontmatter / responsibilities
- default instructions

## Why not index everything?

Exact code search is already handled well by `grep` and `find`.
Memory is meant for ranked recall over curated markdown knowledge.

Indexing all source files would blur the boundary between:
- exact repo search
- memory retrieval

That makes tool selection worse for agents.
