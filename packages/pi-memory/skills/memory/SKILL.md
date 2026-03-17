---
name: memory
description: Search curated markdown memory like sessions, plans, docs, and skills. Use when recalling prior context or looking for relevant historical/project knowledge.
license: MIT
compatibility: pi
metadata:
  category: retrieval
  version: "1.0"
---

# Memory

Bosun's memory system retrieves curated markdown knowledge using the `pi-memory`
extension, backed by qmd v2.

## When to use memory

Use memory when you need:
- prior sessions
- plans and handoffs
- chronicles / builder's logs
- markdown docs
- skills and agent definitions
- contextual recall where exact wording is uncertain

## When **not** to use memory

Do **not** use memory for:
- exact code symbol lookup
- filename discovery
- exact string/regex searches in source files
- one-off repository exploration

For those cases, prefer:
- `grep`
- `find`
- `read`

## Tool

Use the `memory` tool with one of these actions:

| Action | Use |
|--------|-----|
| `search` | Search curated markdown memory |
| `get` | Retrieve one document after finding it |
| `multi_get` | Retrieve several matching documents |
| `status` | Inspect index health and collections |

## Retrieval flow

1. Start with `memory({ action: "search", ... })`
2. Inspect top results (title, score, snippet, docid)
3. Use `memory({ action: "get", ... })` on the best hit
4. Use `memory({ action: "multi_get", ... })` when you need a batch of related docs

## Search modes

### `keyword`
Fast BM25-style lookup. Best when you know likely terms.

```ts
memory({ action: "search", query: "daemon path isolation", mode: "keyword" })
```

### `hybrid`
Broader qmd search for conceptual recall.

```ts
memory({
  action: "search",
  query: "what did we decide about memory indexing",
  mode: "hybrid",
  intent: "bosun package architecture and retrieval design"
})
```

`keyword` is the default because it is fast and works without embeddings.

## Collections

Bosun memory typically includes:
- `sessions` → `workspace/users/**/*.md`
- `docs` → `docs/**/*.md`
- `skills` → `.pi/skills/**/*.md`
- `agents` → `.pi/agents/**/*.md`

See `references/collections.md` for details.

## References

- `references/query-strategy.md` — how to search well
- `references/collections.md` — what is indexed and why
- `references/troubleshooting.md` — common failure modes
