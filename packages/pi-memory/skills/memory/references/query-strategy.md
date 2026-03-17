# Memory Query Strategy

## Start simple

Prefer short keyword queries first:

- `daemon path isolation`
- `tmux sidebar mesh`
- `memory plan qmd`

This keeps searches fast and usually finds the right session, plan, or doc.

## Use `hybrid` when keywords are vague

Switch to `hybrid` when:
- exact wording is unclear
- you are recalling a decision, not a literal phrase
- results from keyword mode are sparse or noisy

Add `intent` when a term is overloaded:

```ts
memory({
  action: "search",
  query: "performance",
  mode: "hybrid",
  intent: "pi tool latency and indexing overhead, not model quality or team process"
})
```

## Retrieve after ranking

Do not paste giant documents into context immediately.

Use this flow:
1. `memory({ action: "search", ... })`
2. inspect scores/snippets
3. `memory({ action: "get", ... })` on the best hit

## Prefer collections when you know the domain

Examples:

```ts
memory({ action: "search", query: "handoff", collections: ["sessions"] })
memory({ action: "search", query: "sandbox", collections: ["docs"] })
memory({ action: "search", query: "mesh", collections: ["skills", "agents"] })
```

Collection filters improve signal and reduce noise.
