---
title: Architecture
description: Package design, sandbox model, and data flow
---

# Architecture

Bosun is a monorepo of independent Pi packages that compose into a multi-agent coding environment. Each package is publishable to npm and usable standalone.

## Package layers

```
┌─────────────────────────────────────────────────────┐
│  Framework Identity (packages/pi-bosun/)            │
│  Agents, Slots, Skills — overridable via .pi/       │
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
│  ┌──────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │pi-memory │ │pi-bash-      │ │pi-auto-      │   │
│  │search,   │ │readonly      │ │resume        │   │
│  │get       │ │bwrap ro mode │ │after compact │   │
│  └──────────┘ └──────────────┘ └──────────────┘   │
├─────────────────────────────────────────────────────┤
│  Background                                         │
│  ┌──────────┐ ┌──────────────────┐                 │
│  │pi-daemon │ │pi-session-tools  │                 │
│  │schedule, │ │catchup-sessions, │                 │
│  │queue     │ │fill-handoff      │                 │
│  └──────────┘ └──────────────────┘                 │
├─────────────────────────────────────────────────────┤
│  Domain                                             │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │  pi-q    │ │pi-chronicles │ │pi-meta-skills│   │
│  │tasks,    │ │analyze,      │ │agent, skill, │   │
│  │projects  │ │scribe        │ │tool creators │   │
│  └──────────┘ └──────────────┘ └──────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Sandbox model

Two independent layers of isolation:

### Process-level (bwrap)

`scripts/sandbox.sh` wraps the **tmux server** in bubblewrap — not individual Pi
processes. Every window, pane, and child process spawned by that tmux server
inherits the same mount namespace:

```
Host
 └─ just start
     └─ sandbox.sh tmux ...     ← bwrap wraps tmux
         └─ tmux server         ← everything below is sandboxed
             ├─ window: bosun   → pi
             ├─ window: lite    → pi (spawn_agent)
             ├─ window: verify  → pi (spawn_agent)
             └─ session: bosun-daemon → bun pi-daemon
```

The sandbox:

- Fakes `HOME` to `.bosun-home/`
- Restricts filesystem access (explicit bind mounts from `.pi/bwrap.json`)
- Filters environment variables via allowlist
- Passes through tmux socket for agent spawning
- Binds GPU render nodes and `/sys` for hardware-accelerated compute (configurable via `gpu_passthrough`)
- Optionally binds the Docker socket for container access (`docker_passthrough`, off by default — socket access ≈ root)

When `spawn_agent` calls `sandbox.sh` recursively, nested detection kicks in
(`BOSUN_SANDBOX=1`) and the command runs directly — no double-wrapping.

**Mount namespace is frozen at startup.** bwrap creates a Linux mount namespace
once when the tmux server starts. This means:

- All windows/panes see the same filesystem — same bind mounts, same restrictions
- Changes to `config.toml` paths (`ro_bind`, `rw_bind`) require **`just stop && just start`**
- Running `just init` regenerates `.pi/bwrap.json`, but the running sandbox
  won't see new mounts until restart

This is the outer wall. If bwrap is not installed, use `just start-unsandboxed` — tool-level sandboxing still applies.

### Bundled configs

The sandbox fakes `HOME` to `.bosun-home/`, which symlinks into `config/`:

| Config | Source | Purpose |
|--------|--------|---------|
| `config/tmux.conf` | `.bosun-home/.tmux.conf` | Keybindings, status bar, agent spawn shortcuts |
| `config/nvim/init.lua` | `.bosun-home/.config/nvim/` | Neovim with lazy.nvim, render-markdown, OSC 52 clipboard |
| `config/bashrc` | `.bosun-home/.bashrc` | Shell config for new panes/splits |

**Clipboard** uses OSC 52 escape sequences — vim yanks flow through tmux to the host terminal without needing the Wayland/X11 socket inside the sandbox. tmux has `set-clipboard on` and `allow-passthrough on` to support this.

### Tool-level (pi-sandbox)

Pi extension that intercepts tool calls at runtime:

- **denyRead**: Block read access to sensitive paths
- **allowWrite**: Whitelist write directories
- **denyWrite**: Block specific file patterns (`.env`, `*.pem`)

Active even without bwrap. Configured in `.pi/sandbox.json`.

### Sandbox indicator

The footer bar shows a shield icon when sandboxing is active:

| Footer indicator | Meaning |
|-----------------|---------|
| `🛡️ bwrap+tool` | Both process-level and tool-level sandbox active |
| `🛡️ bwrap` | Process-level sandbox only (tool-level disabled in config) |
| `🛡️ tool` | Tool-level sandbox only (no bwrap) |
| *(no indicator)* | No sandboxing active |

### How you start determines what's sandboxed

| Command | Process sandbox (bwrap) | Tool sandbox (pi-sandbox) | Footer |
|---------|------------------------|--------------------------|--------|
| `just start` | ✅ | ✅ | `🛡️ bwrap+tool` |
| `just run` | ✅ | ✅ | `🛡️ bwrap+tool` |
| `just start-unsandboxed` | ❌ | ✅ | `🛡️ tool` |
| `pi` (directly) | ❌ | depends on `.pi/sandbox.json` | `🛡️ tool` or nothing |

Running `pi` directly in the repo folder skips process-level isolation entirely — there's no bwrap wrapper. Tool-level sandboxing depends on whether `.pi/sandbox.json` has `enabled: true` (set via `config.toml` and `just init`). Use `just start` for full isolation.

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

Agent files use tier names (`model: high`), not specific model strings. Default agents live in `packages/pi-bosun/agents/`; override by placing a file with the same name in `.pi/agents/`.

## Runtime identity

Bosun separates:

- **persona/type** → `PI_AGENT`
- **runtime identity** → `PI_AGENT_NAME`

The runtime identity is projected into the Pi UI, mesh peer name, and tmux window name when the relevant capabilities are available. See [[Runtime Identity]] for the detailed sync rules, tmux targeting requirements, and E2E validation strategy.

## Agent spawn flow

```
User asks bosun to delegate
    │
    ├── bosun calls spawn_agent({ agent: "lite", task: "..." })
    │       │
    │       ├── pi-agents resolves "lite" → checks .pi/agents/, then packages/*/agents/
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

**Convention over configuration.** Workflows are discovered from package directories. Agents from `packages/*/agents/` (overridable via `.pi/agents/`). Skills from packages and the root `skills/` directory (overridable via `.pi/skills/`). No central registry.

**Scheduled polling over file watchers.** Workflows run on a heartbeat schedule with input validators as gatekeepers. More reliable than file watchers, which have race conditions and restart timing issues.
