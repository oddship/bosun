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
- Coordinate multi-agent workflows via mesh

## When to Use Me

Use this skill when:
- Running Q (planning) alongside Zero (execution)
- Delegating parallel tasks to multiple agents
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
| `capture_pane` | Read output from a window (**non-mesh agents only**) |
| `list_windows` | List all windows |

## Workflow: Mesh-Aware Agents (default)

Most agents have mesh tools and will report back automatically. **Do NOT poll them.**

### 1. Spawn Agent

```typescript
spawn_agent({ 
  agent: "verify",
  task: "Run tests and report via mesh_send to bosun"
})
// Spawns in background, returns immediately
```

### 2. Tell the User You're Waiting

```
"I've spawned verify to run the tests. I'll process their report when it arrives."
```

### 3. Wait — Do Nothing

The agent's `mesh_send` message arrives automatically as a follow-up. **NEVER use `capture_pane` to check on mesh agents.** If the user has other work, handle that instead.

### 4. Process the Report

When the mesh message arrives, summarize findings and take action.

### 5. Leave Windows for the User

Don't kill agent windows when they finish. The user may want to inspect output or interact further.

## Workflow: Non-Mesh Agents (Q, interactive programs)

Only use `capture_pane` for agents that do NOT have mesh tools (e.g., Q) or interactive programs.

### 1. Spawn

```typescript
spawn_agent({ agent: "q", task: "Plan the refactor" })
```

### 2. Check Status

```typescript
list_windows({})
// Shows: 1: bosun-1 (active), 2: q
```

### 3. Capture Output (non-mesh only)

```typescript
capture_pane({ 
  window: "q", 
  lines: 50
})
```

### 4. Send Follow-up

```typescript
send_keys({ 
  window: "q", 
  text: "What tasks are blocked?" 
})
```

## Shell Escaping

Tasks with special characters (quotes, apostrophes) are automatically escaped:

```typescript
spawn_agent({ 
  agent: "lite", 
  task: "What's the user's name?" 
})
```

## Tips

1. **Agents run in background**: `-d` flag keeps focus on current window
2. **Most agents are mesh-aware**: They `mesh_send` results when done — just wait
3. **NEVER poll mesh agents**: Do not use `capture_pane` to check on agents that have mesh tools
4. **Use descriptive window names**: Makes `list_windows` clearer
5. **Don't close windows without asking**: Leave agent windows open - the user decides when to close them
6. **Default to spawn_agent for user-visible work**: Use inline work only for quick internal tasks
