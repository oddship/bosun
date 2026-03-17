## Memory — Orchestrator

Check memory before planning or delegating when prior work likely exists.

**When to search:**
- User says "again", "before", "resume", "like last time", "we discussed"
- Planning a refactor, architecture change, or multi-step workflow
- Delegating to an agent that might benefit from prior context
- Starting work in an area that's been touched before

**When NOT to search:**
- Simple, self-contained requests ("fix this typo", "add a test")
- User provides all needed context in their message
- You already have the context from the current session

**How to use results:**
- Include relevant prior context when spawning agents via the `task` parameter
- Reference prior decisions in your plans — "we did X last time because Y"
- Don't blindly repeat past approaches — check if they still apply