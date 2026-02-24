---
title: Architecture
description: Package design, sandbox model, and data flow
---

# Architecture

Bosun is a monorepo of independent Pi packages that compose into a multi-agent coding environment. Each package is publishable to npm and usable standalone.

## Package layers

```
┌─────────────────────────────────────────────────────┐
│  Agent Definitions (.pi/agents/*.md)                │
│  Skills (.pi/skills/*/SKILL.md)                     │
├─────────────────────────────────────────────────────┤
│  Orchestration                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │pi-agents │ │ pi-mesh  │ │pi-session-context│   │
│  │spawn,    │ │peers,    │ │session_context,  │   │
│  │discover  │ │reserve,  │ │handoff           │   │
│  └──────────┘ └──────────┘ └──────────────────┘   │
├─────────────────────────────────────────────────────┤
│  Tools                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ pi-tmux  │ │pi-question│ │pi-sandbox│           │
│  │split,    │ │TUI multi-│ │tool-level│           │
│  │send_keys │ │select    │ │access    │           │
│  └──────────┘ └──────────┘ └──────────┘           │
├─────────────────────────────────────────────────────┤
│  Background                                         │
│  ┌──────────┐ ┌──────────────────┐                 │
│  │pi-daemon │ │pi-session-tools  │                 │
│  │schedule, │ │catchup-sessions, │                 │
│  │queue     │ │fill-handoff      │                 │
│  └──────────┘ └──────────────────┘                 │
├─────────────────────────────────────────────────────┤
│  Domain                                             │
│  ┌──────────┐ ┌──────────────┐                     │
│  │  pi-q    │ │pi-chronicles │                     │
│  │tasks,    │ │analyze,      │                     │
│  │projects  │ │scribe        │                     │
│  └──────────┘ └──────────────┘                     │
└─────────────────────────────────────────────────────┘
```

## Sandbox model

Two independent layers of isolation:

### Process-level (bwrap)

`scripts/sandbox.sh` wraps the entire Pi process in bubblewrap:

- Fakes `HOME` to `.bosun-home/`
- Restricts filesystem access (explicit bind mounts)
- Filters environment variables via `.pi/bwrap.json`
- Passes through tmux socket for agent spawning

This is the outer wall. If bwrap is not installed, use `just start-unsandboxed` — tool-level sandboxing still applies.

### Tool-level (pi-sandbox)

Pi extension that intercepts tool calls at runtime:

- **denyRead**: Block read access to sensitive paths
- **allowWrite**: Whitelist write directories
- **denyWrite**: Block specific file patterns (`.env`, `*.pem`)

Active even without bwrap. Configured in `.pi/sandbox.json`.

## Config flow

```
config.toml (source of truth)
    │
    └── just init (scripts/init.ts)
            │
            ├── .pi/settings.json      → Package list
            ├── .pi/agents.json        → Model tiers, backend config
            ├── .pi/daemon.json        → Workflow settings
            ├── .pi/sandbox.json       → Tool-level restrictions
            ├── .pi/bwrap.json         → Process-level sandbox
            └── .pi/pi-q.json          → Q data paths
```

Agent files (`.pi/agents/*.md`) are checked in directly — they use tier names (`model: high`), not specific model strings.

## Agent spawn flow

```
User asks bosun to delegate
    │
    ├── bosun calls spawn_agent({ agent: "lite", task: "..." })
    │       │
    │       ├── pi-agents resolves "lite" → .pi/agents/lite.md
    │       ├── Reads frontmatter: model tier, extensions
    │       ├── Resolves tier "lite" → "claude-haiku-4-5-20251001"
    │       ├── Builds command:
    │       │     scripts/sandbox.sh pi --no-extensions \
    │       │       -e npm:pi-mesh -e npm:pi-tmux \
    │       │       --model claude-haiku-4-5-20251001
    │       └── Spawns in tmux window or session
    │
    └── Spawned agent auto-joins mesh, works, reports back
```

## Daemon architecture

```
heartbeat (30s) ─────────────────────────────┐
                                             │
rules engine ────────────────────────────────┤
  • schedule-based: hourly, daily:HH         │
  • startup: run on daemon start             │
  • input validators: is there work to do?   │
                                             │
task queue ──────────────────────────────────┤
  • sequential execution                     │
  • retry with exponential backoff           │
  • crash recovery (stale running tasks)     │
                                             │
workflows ───────────────────────────────────┘
  • catchup-sessions (hourly + startup)
  • fill-handoff (hourly + startup)
  • chronicle-analyzer (hourly)
  • chronicle-scribe (hourly)
  • backup-workspace (daily)
```

## Data flow

```
Session ends
    │
    ├── catchup-sessions (hourly)
    │       └── sessions/{month}/YYYY-MM-DD-{slug}.md
    │
    ├── fill-handoff (hourly)
    │       └── Updates handoff: status: pending → ready
    │
    ├── chronicle-analyzer (hourly)
    │       └── chronicles/analysis/YYYY-MM-DD.json
    │
    ├── chronicle-scribe (hourly)
    │       └── public/chronicles/{month}/DD-{slug}.md
    │
    └── backup-workspace (daily)
            └── backups/backup-YYYY-MM-DD.tar.gz
```

## Key design decisions

**Independent packages.** Each package has its own `package.json`, tests, and can be installed standalone via `pi install npm:<name>`. No cross-package runtime imports.

**Tier-based model config.** Agents declare tiers, not models. Change the model behind `lite` without touching any agent definition.

**Convention over configuration.** Workflows are discovered from package directories. Agents from `.pi/agents/`. Skills from `.pi/skills/`. No central registry.

**Scheduled polling over file watchers.** Workflows run on a heartbeat schedule with input validators as gatekeepers. More reliable than file watchers, which have race conditions and restart timing issues.
