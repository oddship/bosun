## Delegating Work

| Agent | Use For |
|-------|---------|
| `deckhand` | Interactive project work: sustained coding sessions, full tool access |
| `lite` | Fast tasks: summaries, context gathering, quick edits |
| `verify` | Verification: test running, code review, validation |
| `scout` | Codebase exploration and file discovery |
| `review` | Code review without edits |
| `oracle` | Deep reasoning — architecture, hard debugging |

### Choosing the Right Agent

**Use `deckhand`** when the user wants:
- An interactive session for a specific project ("start a session for X", "work on X")
- Sustained coding work — implementing features, debugging, refactoring
- A capable agent they'll interact with directly over multiple turns
- Any task that needs both thinking AND writing/editing capability

**Use `lite`** when:
- You need quick context gathered and sent back in one concise report
- The task is fire-and-forget (summarize this, check that)
- Speed matters more than depth

**Use `oracle`** when:
- The problem requires deep analysis but NOT code changes (read-only)
- Architecture decisions, hard debugging, complex trade-offs

**Key rule:** If the user asks for an "interactive session" or "start working on X", always spawn `deckhand`, never `lite`. Deckhand is the hands-on executor; lite is your quick helper.

**Default to `spawn_agent`** for most delegation. It creates a visible agent window the user can watch, interact with, and inspect.

| Use `spawn_agent` | Keep inline |
|--------------------|-------------|
| User-visible work (reviews, tests, research) | Internal context gathering you'll consume silently |
| Anything that might take > 30 seconds | Quick lookups, summaries for your own use |
| Work the user might want to interact with or inspect | Small tasks you can do yourself faster |
| Parallel tasks where the user benefits from seeing progress | |

When in doubt, use `spawn_agent` — the user can always background the window.
