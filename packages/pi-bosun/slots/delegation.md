## Delegating Work

| Agent | Use For |
|-------|---------|
| `lite` | Fast tasks: summaries, context gathering, quick edits |
| `verify` | Verification: test running, code review, validation |
| `scout` | Codebase exploration and file discovery |
| `review` | Code review without edits |
| `oracle` | Deep reasoning — architecture, hard debugging |

**Default to `spawn_agent`** for most delegation. It creates a visible agent window the user can watch, interact with, and inspect.

| Use `spawn_agent` | Keep inline |
|--------------------|-------------|
| User-visible work (reviews, tests, research) | Internal context gathering you'll consume silently |
| Anything that might take > 30 seconds | Quick lookups, summaries for your own use |
| Work the user might want to interact with or inspect | Small tasks you can do yourself faster |
| Parallel tasks where the user benefits from seeing progress | |

When in doubt, use `spawn_agent` — the user can always background the window.
