---
name: meta-agent-creator
description: Create Pi agent definitions with proper frontmatter, model tiers, and tool permissions. Use when building specialized agents for code review, documentation, security, research, etc.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: meta
---

# Meta Agent Creator

Create specialized Pi agent personas using pi-agents.

## What I Do

- Create agent markdown files with proper frontmatter
- Configure model tier selection
- Set up extension loading for spawned agents
- Guide tool permissions and skill injection

## When to Use Me

Use this skill when:
- Creating specialized agents (code review, docs, security, etc.)
- Setting up agents for parallel work via `spawn_agent`
- Configuring agent tool access and models

Do NOT use for:
- Creating skills (use meta-skill-creator)
- Creating extensions (use meta-extension-creator)
- Creating prompt templates (use meta-command-creator)

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

Use tier names in agent frontmatter. pi-agents resolves them to actual model strings at spawn time.

| Tier | Use Case |
|------|----------|
| **lite** | Fast tasks: scouting, context gathering |
| **medium** | Balanced: code review, implementation |
| **high** | Complex: planning, orchestration |
| **oracle** | Deep reasoning, architecture |

## Quick Start

### Basic Agent

Create `.pi/agents/<name>.md`:

```markdown
---
name: reviewer
description: Reviews code for best practices and security
model: medium
extensions: pi-agents, pi-question
---

You are a senior code reviewer. Focus on:
- Code quality and best practices
- Security vulnerabilities
- Performance implications

Provide detailed feedback in markdown format.
```

### Agent with Skills

```markdown
---
name: git-helper
description: Assists with git operations and commit messages
model: lite
extensions: pi-agents, pi-question
skill: git
---

You help with git operations. Follow conventional commits.
Use the git skill for best practices.
```

## Agent Locations

| Scope | Path |
|-------|------|
| Project | `.pi/agents/{name}.md` |
| Package | Via `agentPaths` in `.pi/agents.json` |

## Frontmatter Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Agent identifier |
| `description` | string | When to use this agent |
| `model` | string | Tier name (`lite`, `medium`, `high`) or raw model string |
| `thinking` | string | Thinking level: `off`, `medium`, `high` |
| `tools` | string | Comma-separated: `read, grep, find, ls, bash, write, edit` |
| `extensions` | string | Comma-separated pi package names for spawn_agent to load |
| `skill` | string | Comma-separated skills to inject into system prompt |

## Invoking Agents

### spawn_agent (tmux — visible work)

Use `spawn_agent` when the user should see the agent's work:

```
spawn_agent({ agent: "reviewer", task: "Review the auth module" })
```

Parallel visible work:
```
spawn_agent({ agent: "reviewer", task: "Review frontend" })
spawn_agent({ agent: "reviewer", task: "Review backend" })
```

## Common Patterns

| Pattern | Tools | Model Tier | Use Case |
|---------|-------|------------|----------|
| Scout | read, grep, find, ls | lite | Fast codebase analysis |
| Reviewer | read, grep, find, ls | medium | Code review, no changes |
| Builder | all | medium | Implementation |
| Planner | read, grep, find, ls | high | Complex planning |
| Researcher | read, grep, find, bash | lite | Information gathering |

## Tips

1. **Minimal tools**: Only grant tools the agent actually needs
2. **Use skills**: Inject domain knowledge via `skill:` frontmatter
3. **Lite for speed**: Use `lite` tier for fast, focused tasks
4. **Medium for quality**: Use `medium` tier for implementation
5. **High for complexity**: Use `high` tier for planning/orchestration
6. **Extensions list**: Include `pi-agents` so spawned agents can spawn sub-agents too

## Detailed References

- [Configuration](references/CONFIGURATION.md) — All frontmatter options and model tiers
- [Examples](references/EXAMPLES.md) — Complete agent examples
- [Permissions](references/PERMISSIONS.md) — Tool permissions details
