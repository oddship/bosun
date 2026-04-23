# pi-memory

Bosun-native memory retrieval for Pi agents, backed by qmd v2's library API.

## What it provides

Tool:
- `memory` — multiplexed memory tool with `action: "search" | "get" | "multi_get" | "status"`

Skill:
- `memory` — teaches agents when to use memory vs `grep`/`find`/`read`

## Why this exists

Bosun agents already have good exact lookup tools (`grep`, `find`, `read`).
`pi-memory` complements them with ranked retrieval over curated markdown
collections such as sessions, plans, docs, skills, and agent definitions.

Use memory when you want to recall prior context, not when you know the exact
code symbol you need.

## Configuration

Runtime config lives at `.pi/pi-memory.json` and is generated from the
`[memory]` section in `config.toml` by `scripts/init.ts`.

Example generated config:

```json
{
  "enabled": true,
  "dbPath": ".bosun-home/.cache/qmd/index.sqlite",
  "allowHybridSearch": true,
  "defaultMode": "keyword",
  "defaultLimit": 5,
  "collections": {
    "sessions": {
      "path": "workspace/users",
      "pattern": "**/*.md",
      "includeByDefault": true
    },
    "docs": {
      "path": "docs",
      "pattern": "**/*.md",
      "includeByDefault": true
    }
  }
}
```

Index maintenance is intentionally off the read path: `memory` search/get/status
open the qmd store, but they do not rescan the filesystem. Keep the index fresh
via the `memory-embed` daemon workflow or an explicit/manual qmd update.

## Tool behavior

### `memory` with `action: "search"`

```ts
memory({
  action: "search",
  query: "daemon path isolation",
  mode: "keyword",
  collections: ["sessions", "docs"],
  limit: 5
})
```

- `keyword` uses BM25-style lookup and is the default because it is fast and
  works without embeddings.
- `hybrid` uses qmd's broader search pipeline and can benefit from embeddings.
- `allowHybridSearch` controls whether hybrid mode is permitted at all. When it
  is `false`, explicit `mode: "hybrid"` calls fail with an actionable error
  instead of falling into the hybrid path.
- Invalid config is rejected: `defaultMode: "hybrid"` requires
  `allowHybridSearch: true`.

### `memory` with `action: "get"`

```ts
memory({ action: "get", id: "#abc123" })
memory({ action: "get", id: "#abc123", maxLines: 40 })
```

### `memory` with `action: "multi_get"`

```ts
memory({ action: "multi_get", pattern: "sessions/**/*.md" })
memory({ action: "multi_get", pattern: "#abc123,#def456" })
```

### `memory` with `action: "status"`

```ts
memory({ action: "status" })
```

Returns enabled/config state, collection layout, indexed document counts, and
embedding health.

## Implementation notes

- Uses qmd v2 as a library, not via CLI shellouts
- No MCP server required
- Collections are configured inline when the qmd store is created
- The store is lazily opened per Pi process/session; index refresh happens via daemon/manual update paths, not memory reads
