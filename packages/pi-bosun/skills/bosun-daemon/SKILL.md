---
name: bosun-daemon
description: Working with bosun's daemon system for automated workflows. Covers workflow directories, agent spawning, validators, and file-based chaining.
license: MIT
compatibility: pi
metadata:
  category: workflow
  version: "2.0"
---

# Bosun Daemon

Background automation engine. Discovers workflows, spawns agents or runs scripts, validates results.

## Architecture

```
trigger fires (schedule, file watcher, manual)
  -> input validator (optional, bun .ts, exit 0/1)
  -> spawn agent (pi --print) or run script
  -> output validator (optional, bun .ts, exit 0/1)
  -> retry with feedback if validation fails
  -> done
```

**Key principle**: Agent is the brain, scripts just validate. All domain logic lives in agent.md files, not TypeScript handlers.

## Workflow Discovery

Workflows are directories scanned from three locations (later overrides earlier):

1. `packages/*/workflows/*/` - packaged defaults
2. `.pi/workflows/*/` - repo-level customizations
3. `workspace/workflows/*/` - user-level overrides (gitignored)

Each workflow directory contains:
- `config.toml` - trigger, model, prompt, retry settings
- `agent.md` - agent system prompt (for agent workflows)
- `validate-input.ts` / `validate-output.ts` - optional validators

## Model Tiers

Configured in root `config.toml`:

```toml
[models]
lite = "claude-haiku-4-5"
medium = "claude-sonnet-4"
```

Workflows reference tiers: `model = "lite"` resolves to the configured model.

## Built-in Workflows

| Package | Workflow | Type | Trigger |
|---------|----------|------|---------|
| pi-chronicles | chronicle-analyzer | agent | hourly |
| pi-chronicles | chronicle-scribe | agent | watches analysis dir |
| pi-session-tools | summarize-session | agent | watches session JSONL |
| pi-session-tools | catchup-sessions | agent | hourly + startup |
| pi-session-tools | fill-handoff | agent | watches handoff dir |
| pi-daemon | backup-workspace | script | daily at 2 AM |

## Common Operations

```bash
# View daemon status
daemon status

# View daemon logs
daemon logs

# Trigger a workflow manually
daemon trigger <workflow-name>

# Reload workflows (after adding/changing)
daemon reload

# Visualize workflow DAG
just workflow-dag

# Stop daemon
daemon stop
```

## Creating Workflows

Load the `meta-workflow-creator` skill for full guidance. Quick version:

```bash
mkdir -p .pi/workflows/my-workflow
# Create config.toml, agent.md, optional validators
# Daemon auto-discovers on next heartbeat
```

## Related Skills

- `meta-workflow-creator` - Scaffold new workflows
- `chronicle` - Chronicle generation details
- `context-management` - Handoff and session management
