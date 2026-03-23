---
title: Bosun
description: An opinionated Pi environment
---

# Bosun

An opinionated multi-agent coding environment built on [Pi](https://github.com/badlogic/pi-mono). Agents run in tmux windows, coordinate through a mesh, and a background daemon handles the rest.

## What you get

**Agents that work together.** Spawn a test runner while you write code. Delegate a file search to a scout. Get a code review from a dedicated reviewer. Each agent runs in its own tmux window with the right model and tools for the job.

**Coordination built in.** Agents reserve files before editing them, send messages to each other, and know who's working on what. No stepping on each other's work.

**Background automation.** A daemon summarizes your sessions, generates builder's logs, fills in handoffs, and backs up your workspace — all on a schedule, without you thinking about it.

**Sandboxed by default.** Process-level isolation via bubblewrap. Tool-level access control for reads, writes, and commands. Agents can only touch what you allow. A 🛡️ indicator in the footer shows which sandbox layers are active.

**Extensible foundation.** Every piece is an independent Pi package. Use them standalone, or build your own multi-agent environment on top of bosun via `bun link`.

## Who it's for

Bosun is for developers who want a multi-agent setup without building the infrastructure. If you've used Pi and wanted to run multiple agents simultaneously — with coordination, automation, and sandboxing — bosun is that, pre-configured.

It's opinionated. The agent tiers, the tmux workflow, the daemon system — these are choices made for you. That's the point.

## Quick start

```bash
git clone https://github.com/oddship/bosun.git
cd bosun
just onboard        # install deps, create config
# edit config.toml with your API keys
just start          # sandboxed tmux session
```

Inside the session:

```
You: Explore this codebase and then add rate limiting to the API

Bosun: I'll spawn scout for recon, then plan the implementation.
```

Read the full [[Quickstart]] for details.

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
│            (reservations, messaging)                │
├─────────────────────────────────────────────────────┤
│  pi-daemon (background)                             │
│  summarize sessions · fill handoffs · backup        │
│  generate chronicles · scheduled workflows          │
├─────────────────────────────────────────────────────┤
│  sandboxing                                         │
│  bwrap (process) + pi-sandbox (tool-level)          │
└─────────────────────────────────────────────────────┘
```

## Packages

Every component is an independent Pi package:

| Package | What it does |
|---------|-------------|
| [pi-bosun](https://github.com/oddship/bosun/tree/main/packages/pi-bosun) | Framework identity — default agents, slots, skills |
| [pi-agents](https://github.com/oddship/bosun/tree/main/packages/pi-agents) | Agent discovery, model tiers, `spawn_agent` tool |
| [pi-mesh](https://www.npmjs.com/package/pi-mesh) | Multi-agent coordination — reservations, messaging |
| [pi-tmux](https://github.com/oddship/bosun/tree/main/packages/pi-tmux) | Terminal tools — split panes, send keys, capture output |
| [pi-daemon](https://github.com/oddship/bosun/tree/main/packages/pi-daemon) | Background workflows — scheduling, queue, retry |
| [pi-sandbox](https://github.com/oddship/bosun/tree/main/packages/pi-sandbox) | Tool-level access control for reads/writes/commands |
| [pi-memory](https://github.com/oddship/bosun/tree/main/packages/pi-memory) | Curated markdown memory retrieval backed by qmd v2 |
| [pi-chronicles](https://github.com/oddship/bosun/tree/main/packages/pi-chronicles) | Builder's log generation from session history |
| [pi-session-tools](https://github.com/oddship/bosun/tree/main/packages/pi-session-tools) | Session summarization and handoff workflows |
| [pi-q](https://github.com/oddship/bosun/tree/main/packages/pi-q) | Task, project, and roadmap management |

## Learn more

- [[Quickstart]] — Getting started step by step
- **Guide**
  - [[Walkthrough]] — Guided tour of a session
  - [[Agents]] — Agent tiers, spawning, mesh coordination
  - [[Workflows]] — Daemon, scheduled automation
  - [[Daily Use]] — Day-to-day patterns and commands
- **Extending**
  - [[Architecture]] — Package design, sandbox model, data flow
  - [[Runtime Identity]] — Persona vs runtime naming, tmux/mesh sync, testing
  - [[Downstream]] — Build your own environment on bosun
  - [[Packages]] — Package reference and API details
  - [[Testing]] — Unit tests, e2e scripts, live Pi tests
- [[Changelog]]
