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
just doctor     # or: bosun doctor
```

## Setup

```bash
just onboard    # installs deps, creates config from template
```

Edit `config.toml` — add your API keys to the environment allowlist and choose models:

```toml
[models]
lite = "<your-fast-model>"           # e.g. gpt-4.1-mini, claude-haiku-4-5
medium = "<your-balanced-model>"     # e.g. gpt-5.3-codex, claude-sonnet-4-6
high = "<your-best-model>"           # e.g. gpt-5.4, claude-opus-4-6
oracle = "<your-reasoning-model>"    # e.g. gpt-5.4, o3

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
just start              # sandboxed tmux session (recommended)
# or
just start-unsandboxed  # no bwrap, if you don't have it
```

Bosun is now CLI-first. `just` recipes call the same commands under the hood:

```bash
bosun start             # start/attach main session
bosun run               # start a new session (bosun-2, bosun-3, ...)
bosun run --window      # add a new agent window to current session
bosun attach [session]  # attach (or choose from active sessions)
bosun stop              # stop all Bosun tmux sessions
bosun init              # regenerate .pi/*.json from config.toml
bosun doctor            # dependency + config drift checks
```

You're now in a tmux session with bosun ready. Look for the **🛡️** indicator in the bottom bar — it shows which sandbox layers are active:

- `🛡️ bwrap+tool` — full isolation (`just start`)
- `🛡️ tool` — tool-level only (`just start-unsandboxed`, or `pi` with sandbox config enabled)

If you run `pi` directly in the repo without the `just` wrapper, you skip process-level sandboxing (bwrap). This means the agent has full access to your filesystem and environment. Use `just start` for the full security model.

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

All config lives in `config.toml`. Run `just init` (or `bosun init`) to regenerate `.pi/*.json` files after changes.

```
config.toml (source of truth)
    └─► just init
          ├─► .pi/settings.json
          ├─► .pi/agents.json
          ├─► .pi/daemon.json
          ├─► .pi/sandbox.json
          └─► .pi/bwrap.json
```

`[pi] default_provider`, `default_model`, and `default_thinking_level` in `config.toml` are generated into `.pi/settings.json` as project-level Pi defaults.

**Never edit `.pi/*.json` directly** — they're regenerated.

## Next steps

- [[Walkthrough]] — See a full session play out
- [[Agents]] — Understand agent tiers and spawning
- [[Daily Use]] — Patterns for everyday work
- [[Architecture]] — How it all fits together
