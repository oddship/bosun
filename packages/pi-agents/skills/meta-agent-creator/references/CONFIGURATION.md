# Agent Configuration

Complete reference for pi-agents agent configuration.

## Model Tiers

Model tiers are defined in `.pi/agents.json`:

```json
{
  "models": {
    "lite": "claude-haiku-4-5-20251001",
    "medium": "claude-sonnet-4-5-20250929",
    "high": "claude-opus-4-6",
    "oracle": "gpt-5.3-codex"
  }
}
```

Use tier names in agent frontmatter. pi-agents resolves them at spawn time.

## Agent File Format

Create `.pi/agents/<name>.md`:

```markdown
---
name: agent-name
description: Brief description of agent purpose
model: medium
thinking: off
tools: read, grep, find, ls, bash, write, edit
extensions: pi-agents, pi-question, pi-mesh
skill: git
---

# Agent System Prompt

Your role and instructions go here.
```

The filename becomes the agent name (e.g., `review.md` → `review` agent).

## All Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | filename | Agent identifier |
| `description` | string | "" | **Required**. What the agent does, when to use |
| `model` | string | — | Tier name (`lite`, `medium`, `high`, `oracle`) or raw model string |
| `thinking` | string | — | Thinking level: `off`, `medium`, `high` |
| `tools` | string | — | Comma-separated: `read, grep, find, ls, bash, write, edit` |
| `extensions` | string | — | Comma-separated pi package names loaded by spawn_agent |
| `skill` | string | — | Comma-separated skills to inject into system prompt |

## Agent Locations

| Scope | Path | Priority |
|-------|------|----------|
| Project | `.pi/agents/{name}.md` | Higher |
| Package | Via `agentPaths` in `.pi/agents.json` | Lower |

Standard `.pi/agents/` is always searched first. Package agent paths are configured in `.pi/agents.json`:

```json
{
  "agentPaths": [
    "node_modules/pi-q/agents"
  ]
}
```

## Extensions Field

The `extensions` field lists pi package names that `spawn_agent` loads when launching the agent:

```yaml
extensions: pi-agents, pi-question, pi-mesh
```

Becomes: `pi --no-extensions -e npm:pi-agents -e npm:pi-question -e npm:pi-mesh`

Include `pi-agents` if you want the spawned agent to be able to spawn sub-agents itself.

## Tools Reference

| Tool | Description | Risk Level |
|------|-------------|------------|
| `read` | Read file contents | Safe |
| `grep` | Search file contents | Safe |
| `find` | Find files by name | Safe |
| `ls` | List directory | Safe |
| `bash` | Execute shell commands | High |
| `write` | Write/create files | Medium |
| `edit` | Edit existing files | Medium |

**Recommendations:**
- **Analyzers** (review, audit): `read, grep, find, ls` only
- **Builders** (implement, fix): All tools
- **Researchers** (scout, explore): `read, grep, find, ls, bash`

## Model Selection by Use Case

| Use Case | Model Tier | Reason |
|----------|------------|--------|
| Fast exploration | lite | Speed over depth |
| Code review | medium | Balance of speed and quality |
| Implementation | medium | Good reasoning, reasonable cost |
| Complex planning | high | Best reasoning capability |
| Orchestration | high | Needs strategic thinking |
| Deep analysis | oracle | Maximum reasoning depth |

## Skill Injection

Skills declared in frontmatter are injected into the system prompt:

```yaml
skill: git, context-management
```

The agent will have access to git best practices and context management workflows.

## Backend Configuration

The spawn backend is configured in `.pi/agents.json`:

```json
{
  "backend": {
    "type": "tmux",
    "socket": ".bosun-home/tmux.sock",
    "command_prefix": "scripts/sandbox.sh"
  }
}
```

- `type`: Terminal multiplexer (only `"tmux"` today)
- `socket`: Tmux socket path. Omit to auto-detect from `$TMUX` env
- `command_prefix`: Wraps each spawned pi process (e.g., sandbox script)
