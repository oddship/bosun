---
title: Daily Use
description: Day-to-day patterns and commands for working with bosun
---

# Daily Use

Patterns for everyday work with bosun.

## Session lifecycle

### Starting

```bash
just start              # Sandboxed session (recommended)
just start-unsandboxed  # Without bwrap
just attach             # Reattach to existing session
```

### During a session

**Delegate work:**
```typescript
spawn_agent({ agent: "lite", task: "Summarize the auth module" })
spawn_agent({ agent: "verify", task: "Run all tests and report" })
```

**Check who's working:**
```typescript
mesh_peers({})
```

**Navigate tmux windows:**
- `Alt+1`, `Alt+2`, ... — switch to window by number
- `Alt+n` — next window
- `Alt+p` — previous window

### Ending

Save context before stopping:

```
You: /handoff
```

Then:
```bash
just stop               # Closes everything
```

### Resuming

```bash
just start
```

```
You: /pickup
```

Select a handoff from the list. Context restored.

## Planning

For non-trivial work (3+ files, multi-step), bosun creates a plan:

```
You: Add WebSocket support to the API

Bosun: This is complex. Let me plan first.
[Creates plan at workspace/users/.../plans/...]
[Opens in split pane for review]
```

Plans have phases with gate checks (verify → review → commit) between them.

**Commands:**
- `/handoff` — save session context for later
- `/pickup` — resume from a handoff
- `/fork` — branch an exploration from current context

## Common patterns

### Explore, then implement

```
You: Clone github.com/org/repo and understand how auth works,
     then add OAuth2 support
```

Bosun will:
1. Clone → spawn scout → get structure report
2. Plan the OAuth2 implementation
3. Delegate to lite for implementation
4. Verify with tests

### Review existing code

```
You: Review the changes in the last 3 commits for security issues
```

Bosun spawns `review` agent (read-only, won't modify code).

### Deep debugging

```
You: This test is flaking — sometimes passes, sometimes fails.
     I need to understand why.
```

Bosun may spawn `oracle` for hard reasoning problems.

### Parallel work

```
You: Write tests for the API while also updating the docs
```

Bosun spawns two agents, reserves files for each, coordinates results.

## Configuration

### config.toml

The single config file. Key sections:

```toml
[keys]
anthropic = "sk-ant-..."         # API keys

[models]
lite = "claude-haiku-4-5-20251001"
medium = "claude-sonnet-4-5-20250929"
high = "claude-sonnet-4-5-20250929"
oracle = "o3"

[sandbox]
enabled = true                    # bwrap process sandboxing
allow_paths = ["/tmp"]            # additional allowed paths

[daemon]
heartbeat = 30                    # seconds between checks
```

### Updating

```bash
just update     # Updates pi and all packages
just doctor     # Check environment health
```

### Troubleshooting

**Agent won't spawn:** Check `mesh_peers()` — is the mesh full? Check model config in `config.toml`.

**Daemon not running:** `daemon({ action: "status" })`. If stopped, restart with `just start`.

**Sandbox blocking something:** Check `.pi/sandbox.json` for read/write restrictions. Or use `just start-unsandboxed` temporarily.

**Stale mesh state:** If agents show as active but aren't, the mesh self-heals on next heartbeat. Or restart the session.
