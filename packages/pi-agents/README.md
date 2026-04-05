# pi-agents

Agent identity, model tier resolution, and `spawn_agent` tool for [Pi](https://github.com/badlogic/pi-mono).

## What it does

- **Identity injection**: Reads `PI_AGENT` env var, loads the matching `.pi/agents/{name}.md` file, and injects the agent's persona into the system prompt via `before_agent_start`.
- **Model tier resolution**: Maps tier names (`lite`, `medium`, `high`) from agent frontmatter to actual model strings defined in `.pi/agents.json`.
- **Session tracking**: Writes `agent_identity` entries to session JSONL for daemon filtering and analytics.
- **`spawn_agent` tool**: Launches new Pi agents in tmux windows with correct model, extensions, and environment variables.
- **Agent discovery**: Scans `.pi/agents/` plus any additional `agentPaths` configured in `.pi/agents.json`.
- **Bundled skill**: `meta-agent-creator` teaches agents how to create new agent definitions.

## Install

```bash
pi install npm:pi-agents
```

Or try without installing:

```bash
PI_AGENT=myagent pi -e npm:pi-agents
```

## Agent file format

Create `.pi/agents/<name>.md` with YAML frontmatter:

```markdown
---
name: reviewer
description: Reviews code for best practices
model: medium
thinking: medium
extensions: pi-agents, pi-question, pi-mesh
skill: git
---

You are a senior code reviewer. Focus on...
```

### Frontmatter fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent identifier (defaults to filename) |
| `description` | string | When to use this agent |
| `model` | string | Tier name or raw model string |
| `thinking` | string | `off`, `medium`, `high` |
| `tools` | string | Comma-separated tool names |
| `extensions` | string | Comma-separated package names for `spawn_agent` |
| `skill` | string | Comma-separated skill names |

## Configuration

Create `.pi/agents.json`:

```json
{
  "models": {
    "lite": "<your-fast-model>",
    "medium": "<your-balanced-model>",
    "high": "<your-best-model>"
  },
  "defaultAgent": "bosun",
  "agentPaths": [],
  "backend": {
    "type": "tmux",
    "command_prefix": "scripts/sandbox.sh"
  }
}
```

All fields are optional — sensible defaults are used when missing.

### `models`

Maps tier names to model strings. Agent frontmatter uses tier names; pi-agents resolves them at spawn time.

### `agentPaths`

Extra directories to scan for agent `.md` files (relative to cwd or absolute). Useful for packages that ship their own agents (e.g., `"node_modules/pi-q/agents"`).

### `backend`

Controls how `spawn_agent` launches processes:

- `type`: `"tmux"` (only option today)
- `socket`: Tmux socket path for `tmux -S`. Omit to auto-detect from `$TMUX`
- `command_prefix`: Wraps spawned `pi` commands (e.g., sandbox script)

## Environment variables

| Variable | Description |
|----------|-------------|
| `PI_AGENT` | Agent persona/type to load (default: `"none"` — no persona) |
| `PI_AGENT_NAME` | Runtime identity shown in the Pi UI and used as mesh peer / tmux window name when available (set from `PI_AGENT` if missing) |

## Runtime identity

`pi-agents` treats `PI_AGENT` as the persona/type and `PI_AGENT_NAME` as the per-session runtime identity.

That means:
- persona loading still comes from `PI_AGENT`
- the visible Pi UI title/status prefers `PI_AGENT_NAME ?? PI_AGENT`
- spawned agents set `PI_AGENT_NAME` to the target window/peer name so tmux and mesh can correlate the session correctly

## How spawn_agent works

```
spawn_agent({ agent: "lite", task: "fix tests" })
  → reads .pi/agents/lite.md frontmatter
  → resolves model: lite → <configured lite model>
  → reads extensions: pi-agents, pi-question
  → builds: [command_prefix] pi --no-extensions -e npm:pi-agents -e npm:pi-question --models <resolved-model> --thinking <level> 'fix tests'
  → tmux -S <socket> new-window -d -n lite -e PI_AGENT=lite -e PI_AGENT_NAME=lite "<command>"
```

## License

MIT
