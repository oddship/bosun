---
title: Agents
description: Agent tiers, spawning, and mesh coordination
---

# Agents

Bosun's agents are specialized Pi instances, each with a specific role, model tier, and set of tools. They run in tmux windows and coordinate through a mesh.

## Agent roster

| Agent | Tier | Role | When to use |
|-------|------|------|------------|
| **bosun** | high | Orchestrator | Planning, delegation, coordination |
| **lite** | lite | Fast helper | Quick edits, summaries, file operations |
| **verify** | medium | Validator | Run tests, check builds, validate changes |
| **scout** | lite | Reconnaissance | Explore codebases, map structure |
| **review** | medium | Code reviewer | Review changes without editing |
| **oracle** | oracle | Deep thinker | Architecture decisions, hard debugging |
| **q** | high | Executive assistant | Task tracking, project planning |

## Model tiers

Agents declare a tier, not a specific model. You map tiers to models in `config.toml`:

```toml
[models]
lite = "claude-haiku-4-5-20251001"      # Fast, cheap
medium = "claude-sonnet-4-5-20250929"    # Balanced
high = "claude-sonnet-4-5-20250929"      # Capable
oracle = "o3"                            # Maximum reasoning
```

Change the model behind a tier without touching any agent definitions.

## Spawning agents

From bosun (or any orchestrator), spawn agents with:

```typescript
spawn_agent({
  agent: "lite",
  task: "Refactor the auth module. Report via mesh_send to bosun."
})
```

This:
1. Resolves `lite` → `.pi/agents/lite.md`
2. Reads frontmatter: model tier, extensions, skills
3. Resolves tier → actual model from config
4. Spawns a new Pi instance in a tmux window
5. The agent auto-joins the mesh and starts working

### Window vs session

By default, agents spawn in tmux windows (same session). Use `session: true` for agents that:
- Work on a separate repo
- Are long-lived (like Q)
- Need direct user interaction

```typescript
// Window (default) — short-lived helper
spawn_agent({ agent: "lite", task: "..." })

// Session — long-lived, interactive
spawn_agent({ agent: "q", session: true, task: "..." })
```

## Mesh coordination

All agents auto-join the mesh on spawn. The mesh provides:

### Peer awareness

```typescript
mesh_peers({})
// Returns: who's active, what they're working on, their status
```

### File reservations

Before editing shared files, reserve them:

```typescript
mesh_reserve({ paths: ["src/auth/"], reason: "Refactoring auth" })
// Other agents see this and avoid editing those files
```

Release when done:

```typescript
mesh_release({})
```

### Messaging

Agents communicate through mesh messages:

```typescript
// Send to a specific agent
mesh_send({ to: "bosun", message: "Tests pass, 42/42." })

// Broadcast to all
mesh_send({ broadcast: true, message: "Auth interfaces changed." })

// Urgent (interrupts the recipient)
mesh_send({ to: "lite-1", message: "Stop — requirements changed.", urgent: true })
```

Messages arrive as follow-up events — no polling needed.

## Agent definitions

Agent definitions live in `.pi/agents/*.md` with YAML frontmatter:

```yaml
---
name: lite
model: lite
description: Fast helper for quick tasks
extensions:
  - npm:pi-mesh
  - npm:pi-tmux
skills:
  - git
  - context-management
---

You are lite, a fast helper agent...
```

Key fields:
- **model**: Tier name (`lite`, `medium`, `high`, `oracle`)
- **extensions**: Pi packages loaded for this agent
- **skills**: Skills available to load on demand

## Writing custom agents

Create `.pi/agents/your-agent.md`:

```yaml
---
name: security-reviewer
model: medium
description: Security-focused code review
extensions:
  - npm:pi-mesh
---

You are a security reviewer. Focus on:
- Input validation
- Auth/authz patterns
- SQL injection, XSS
- Secrets in code
...
```

Then spawn it: `spawn_agent({ agent: "security-reviewer", task: "..." })`

Use the `meta-agent-creator` skill for scaffolding guidance.
