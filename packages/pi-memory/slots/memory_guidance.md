## Memory

You have a `memory` tool backed by a semantic/keyword index over project markdown (sessions, plans, handoffs, docs, skills).

**When to use memory vs other tools:**

| Need | Tool |
|------|------|
| Fuzzy recall — "did we discuss X before?" | `memory` search |
| Exact symbol/filename lookup | `grep`, `find` |
| Reading a known file | `read` |
| Current project/task state | `qt`, `qp`, `qr` (if available) |

**Usage guidelines:**

- Prefer **1 search + 1-2 gets** per question. Don't do broad retrieval sprees.
- If search results look noisy or irrelevant, fall back to `grep`/`find`/`read`.
- Use `keyword` mode for specific terms, `semantic` mode for conceptual questions, `hybrid` for both.
- Memory indexes markdown files — it won't find things in code, configs, or binary files.