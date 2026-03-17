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

## Search is slower on first use

`pi-memory` opens the qmd store lazily and refreshes the index on first use
when `autoUpdateOnOpen` is enabled. That first call can be noticeably slower.

## When in doubt

Use the simple fallback:
- `grep` for exact text/code lookup
- `memory({ action: "search", ... })` for curated markdown recall
