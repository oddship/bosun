# Memory Troubleshooting

## `memory({ action: "status" })` shows zero documents

Likely causes:
- collections point at the wrong paths
- the repository has not been indexed yet
- the selected collection has no matching markdown files

Check:
- `.pi/pi-memory.json`
- `memory({ action: "status" })`
- whether the configured collection paths exist

## Searches work but hybrid feels limited

Hybrid search benefits from qmd embeddings. Keyword mode does not require them.
If you need stronger semantic recall, generate embeddings with qmd separately.

## Search results look stale after files changed

`pi-memory` does not rescan collections on `memory` reads. Index refresh should
happen via the `memory-embed` daemon workflow or an explicit/manual qmd update.
If new markdown is missing from results, refresh the qmd index first.

## When in doubt

Use the simple fallback:
- `grep` for exact text/code lookup
- `memory({ action: "search", ... })` for curated markdown recall
