---
name: tmux-orchestration
description: Orchestrate multiple Pi agents via tmux windows. Use when spawning background agents, sending them tasks, and capturing their output.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: orchestration
---

# Tmux Agent Orchestration

Spawn, control, and monitor multiple Pi agents running in parallel tmux windows.

## What I Do

- Spawn agents in background tmux windows
- Send tasks/prompts to running agents
- Capture agent output for monitoring
- Coordinate multi-agent workflows

## When to Use Me

Use this skill when:
- Running Q (planning) alongside Zero (execution)
- Delegating parallel tasks to multiple agents
- Monitoring long-running agent work
- Building multi-agent pipelines

Do NOT use for:
- Non-tmux environments
- Purely internal context gathering where the user doesn't need visibility

## Prerequisites

Must be running inside tmux. Start with `just start` or `tmux`.

## Tools Available

| Tool | Purpose |
|------|---------|
| `spawn_agent` | Start agent in background window |
| `send_keys` | Send text/commands to a window |
| `capture_pane` | Read output from a window |
| `list_windows` | List all windows |

## Workflow Pattern

### 1. Spawn Agent

```typescript
spawn_agent({ 
  agent: "q",           // Agent from .pi/agents/
  task: "Plan the refactor"  // Initial prompt
})
// Spawns in background, returns immediately
```

### 2. Check Status

```typescript
list_windows({})
// Shows: 1: bosun-1 (active), 2: q
```

### 3. Send Follow-up

```typescript
send_keys({ 
  window: "q", 
  text: "What tasks are blocked?" 
})
```

### 4. Capture Output

```typescript
capture_pane({ 
  window: "q", 
  lines: 50  // Last 50 lines
})
// Returns the agent's screen content
```

### 5. Leave Windows for the User

Don't kill agent windows when they finish. The user may want to inspect output or interact further. Let the user close windows when they're ready.

## Example: Zero + Q Coordination

```typescript
// Zero spawns Q for planning
spawn_agent({ agent: "q", task: "Review today's priorities" })

// Zero continues with execution work...
// ...later, check what Q found
const output = capture_pane({ window: "q", lines: 30 })

// Ask Q a follow-up based on output
send_keys({ window: "q", text: "Which task should I tackle first?" })
```

## Shell Escaping

Tasks with special characters (quotes, apostrophes) are automatically escaped:

```typescript
// This works fine
spawn_agent({ 
  agent: "lite", 
  task: "What's the user's name?" 
})
```

## Tips

1. **Agents run in background**: `-d` flag keeps focus on current window
2. **Mesh-aware agents report back**: If an agent has mesh tools, it will `mesh_send` results when done - no need to capture
3. **Use descriptive window names**: Makes `list_windows` clearer
4. **Don't close windows without asking**: Leave agent windows open - the user decides when to close them
5. **Default to tmux for user-visible work**: Use spawn_agent only for internal/silent tasks

## Comparison: tmux vs spawn_agent

| Aspect | spawn_agent | spawn_agent() |
|--------|------------------|------------|
| Visibility | User can watch, interact, inspect | Silent, internal |
| Persistence | Stays running, reusable | One-shot |
| Interaction | Send/capture/mesh anytime | Single task |
| Best for | Reviews, tests, research, parallel work | Internal context gathering, chains |

**Default to `spawn_agent`** for most work. Only use `spawn_agent()` when the task is purely internal plumbing the user doesn't need to see.
