# Bosun

An opinionated environment for [Pi](https://github.com/badlogic/pi-mono). Multiple AI agents in tmux, coordinated automatically.

## What it does

- **Multi-agent orchestration** — spawn specialized agents (test runner, code reviewer, scout) that work simultaneously in tmux windows
- **Mesh coordination** — agents reserve files, send messages, and stay out of each other's way
- **Background automation** — a daemon summarizes sessions, generates builder's logs, fills handoffs, and backs up your workspace on a schedule

## Quickstart

```bash
git clone https://github.com/oddship/bosun.git
cd bosun
just onboard        # install deps, create config
# edit config.toml with your API keys
just start          # sandboxed tmux session
```

Then:

```
You: Explore this codebase and add tests for the auth module

Bosun spawns scout → plans the work → delegates to lite → runs verify
```

See the full [Quickstart](docs/quickstart.md).

## How it works

```
┌─────────────────────────────────────────────────────┐
│  tmux session                                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ │
│  │ bosun   │ │ lite    │ │ verify  │ │ scout    │ │
│  │(orchestr)│ │(fast)   │ │(tests)  │ │(recon)   │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘ │
│       └────────────┴──────────┴────────────┘       │
│                    pi-mesh                          │
├─────────────────────────────────────────────────────┤
│  pi-daemon (background automation)                  │
├─────────────────────────────────────────────────────┤
│  sandboxing (bwrap + tool-level)                    │
└─────────────────────────────────────────────────────┘
```

## Documentation

- [Quickstart](docs/quickstart.md) — Get running in 5 minutes
- [Walkthrough](docs/01-guide/01-walkthrough.md) — Guided tour of a session
- [Agents](docs/01-guide/02-agents.md) — Agent tiers, spawning, mesh coordination
- [Workflows](docs/01-guide/03-workflows.md) — Daemon and scheduled automation
- [Daily Use](docs/01-guide/04-daily-use.md) — Patterns and commands
- [Architecture](docs/02-extend/01-architecture.md) — Package design and data flow
- [Downstream Projects](docs/02-extend/02-downstream.md) — Build your own environment on bosun
- [Packages](docs/02-extend/03-packages.md) — Package reference

## Packages

Independent Pi packages, each usable standalone via `pi install npm:<name>`:

| Package | Description |
|---------|-------------|
| [pi-agents](packages/pi-agents/) | Agent discovery, model tiers, `spawn_agent` |
| [pi-mesh](https://www.npmjs.com/package/pi-mesh) | Multi-agent coordination — reservations, messaging |
| [pi-tmux](packages/pi-tmux/) | Terminal tools — split panes, send keys, capture |
| [pi-daemon](packages/pi-daemon/) | Background workflows — scheduling, queue, retry |
| [pi-sandbox](packages/pi-sandbox/) | Tool-level access control |
| [pi-chronicles](packages/pi-chronicles/) | Builder's log generation |
| [pi-session-tools](packages/pi-session-tools/) | Session summarization and handoffs |
| [pi-q](packages/pi-q/) | Task, project, and roadmap management |

## Agents

| Agent | Tier | Role |
|-------|------|------|
| bosun | high | Orchestrator — delegates, plans, coordinates |
| lite | lite | Fast helper — quick edits, summaries |
| verify | medium | Validator — tests, builds, checks |
| scout | lite | Reconnaissance — explore, map structure |
| review | medium | Code review (read-only) |
| oracle | oracle | Deep reasoning — architecture, hard debugging |
| q | high | Executive assistant — tasks, projects, roadmaps |

Tiers map to models in `config.toml`. Change the model, not the agent.

## License

MIT
