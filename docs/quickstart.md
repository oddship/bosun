---
title: Quickstart
description: Get bosun running in 5 minutes
---

# Quickstart

## Prerequisites

You need: `tmux`, `bun`, `git`, `rg` (ripgrep). Optionally `bwrap` (bubblewrap) for process-level sandboxing.

**With Nix** (handles everything):
```bash
git clone https://github.com/oddship/bosun.git
cd bosun
direnv allow    # or: nix develop
```

**Without Nix** — install the tools manually, then:
```bash
git clone https://github.com/oddship/bosun.git
cd bosun
just doctor     # checks what's installed
```

## Setup

```bash
just onboard    # installs deps, creates config from template
```

Edit `config.toml` — add your API keys to the environment allowlist and choose models:

```toml
[models]
lite = "claude-haiku-4-5"           # fast, cheap
medium = "claude-sonnet-4-6"        # balanced
high = "claude-opus-4-6"            # best quality
oracle = "gpt-5.3-codex"            # deep reasoning

[env]
allowed = [
  "ANTHROPIC_API_KEY",              # set in your shell, passed into sandbox
  "OPENAI_API_KEY",
  # ...
]
```

API keys are **not stored in config.toml** — they're environment variables on your host. The `[env].allowed` list controls which ones get passed into the bwrap sandbox. Models are mapped to tiers — each agent declares a tier (`lite`, `medium`, `high`, `oracle`), and the tier resolves to whatever model you configure.

## Start

```bash
just start              # sandboxed tmux session
# or
just start-unsandboxed  # no bwrap, if you don't have it
```

You're now in a tmux session with bosun ready.

## First interaction

Ask bosun to do something:

```
You: What's in this repo?
```

Bosun will likely spawn a scout agent to explore:

```
Bosun: I'll spawn scout to map the structure.
[scout-1 appears in a new tmux window]
[mesh message arrives with findings]
Bosun: Here's what scout found: ...
```

Switch between agent windows with `Alt+1`, `Alt+2`, etc.

## Try multi-agent work

```
You: Clone github.com/some/repo into workspace and add tests for the auth module
```

Bosun will:
1. Clone the repo
2. Spawn scout for reconnaissance
3. Plan the work
4. Spawn lite to write tests
5. Spawn verify to run them
6. Report results

## Save your work

End a session with a handoff:

```
You: /handoff
```

Next time, pick up where you left off:

```
You: /pickup
```

## What's running in the background

The daemon starts automatically and runs scheduled workflows:

| Workflow | Schedule | What it does |
|----------|----------|-------------|
| catchup-sessions | Hourly + startup | Summarize completed Pi sessions |
| fill-handoff | Hourly + startup | Fill pending handoff documents |
| chronicle-analyzer | Hourly | Group sessions into development journeys |
| chronicle-scribe | Hourly | Generate builder's log narratives |
| backup-workspace | Daily | Backup workspace to tar.gz |

Check status anytime:

```
daemon({ action: "status" })
daemon({ action: "logs", lines: 20 })
```

## Configuration reference

All config lives in `config.toml`. Run `just init` to regenerate `.pi/*.json` files after changes.

```
config.toml (source of truth)
    └─► just init
          ├─► .pi/settings.json
          ├─► .pi/agents.json
          ├─► .pi/daemon.json
          ├─► .pi/sandbox.json
          └─► .pi/bwrap.json
```

**Never edit `.pi/*.json` directly** — they're regenerated.

## Next steps

- [[Walkthrough]] — See a full session play out
- [[Agents]] — Understand agent tiers and spawning
- [[Daily Use]] — Patterns for everyday work
- [[Architecture]] — How it all fits together
