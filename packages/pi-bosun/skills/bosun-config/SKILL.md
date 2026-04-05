---
name: bosun-config
description: Bosun configuration — models, sandbox, daemon, Pi settings. Use when changing models, editing config, or understanding how bosun is set up.
---

# Bosun Configuration

Configuration for the bosun sandboxed multi-agent environment.

## Quick Reference

| To change... | Edit this file | Then run |
|--------------|----------------|----------|
| Models | `config.toml` `[models]` | `just init` |
| Stock agent behavior | `packages/pi-bosun/agents/{name}.md` | (direct edit, checked in) |
| Shared bosun prompt policy | `packages/pi-bosun/slots/*.md` | (direct edit, checked in) |
| Project-specific agent overrides | `.pi/agents/{name}.md` | (direct edit, checked in if you choose) |
| Pi settings/packages | `config.toml` | `just init` (regenerates `.pi/settings.json`) |
| Env vars (sandbox) | `config.toml` `[env]` | Restart session |
| Daemon settings | `config.toml` `[daemon]` | `just init` then restart daemon |
| Sandbox (tool-level) | `config.toml` `[sandbox]` | `just init` |
| Sandbox (process-level) | `config.toml` `[env]`, `[paths]` | `just init` then restart |

## Config Flow

```
config.toml                   ← Source of truth (user edits this)
    │
    └─→ just init             ← Runs scripts/init.ts
            │
            ├─→ .pi/settings.json     (Pi package list)
            ├─→ .pi/agents.json       (model tiers, backend config)
            ├─→ .pi/daemon.json       (daemon settings)
            ├─→ .pi/sandbox.json      (tool-level restrictions)
            ├─→ .pi/bwrap.json        (process-level sandbox)
            ├─→ .pi/pi-q.json         (Q data paths)
            └─→ .pi/pi-bash-readonly.json (bash sandbox: network, writable paths)
```

**Generated `.pi/*.json` files are gitignored.** Don't edit them directly.

**In this repo, stock bosun agents live in `packages/pi-bosun/agents/*.md` and shared prompt slots live in `packages/pi-bosun/slots/*.md`.** Use `.pi/agents/*.md` only for local project overrides. Agent frontmatter uses model tier names (not specific model strings).

## Model Tiers

In `config.toml`:

```toml
[models]
lite = "<your-fast-model>"               # Fast, cheap — e.g. gpt-4.1-mini, claude-haiku-4-5
medium = "<your-balanced-model>"          # Balanced — e.g. gpt-5.3-codex, claude-sonnet-4-6
high = "<your-best-model>"               # Best quality — e.g. gpt-5.4, claude-opus-4-6
oracle = "<your-reasoning-model>"         # Deep reasoning — e.g. gpt-5.4, o3
```

Agent frontmatter references tiers by name:

```yaml
model: high    # Resolved to actual model string at spawn time
```

## Common Tasks

### Change the default model tier

```bash
vim config.toml                    # Edit [models] section
just init                          # Regenerate .pi/agents.json
# New spawned agents will use the updated model
```

### Add environment variable to bwrap sandbox

```toml
# In config.toml [env]
allowed = [
  "ANTHROPIC_API_KEY",
  "MY_CUSTOM_VAR",     # Add here
]
```

Then restart: `just stop && just start`

### Create a new agent

1. Create `.pi/agents/my-agent.md` with frontmatter:
   ```yaml
   ---
   name: my-agent
   description: What this agent does.
   model: medium
   extensions:
     - pi-question
     - pi-mesh
   ---
   ```
2. Use: `spawn_agent({ agent: "my-agent", task: "..." })`

### Change shared bosun behavior

- Edit `packages/pi-bosun/agents/*.md` for stock agent role/instructions
- Edit `packages/pi-bosun/slots/*.md` for shared reusable prompt fragments
- Run `just init` only when changing generated config/prompt outputs such as `.pi/prompts/spawn.md`

### Modify tool-level sandbox rules

```toml
# In config.toml [sandbox]
[sandbox.filesystem]
deny_read = ["~/.ssh", "~/.aws"]
allow_write = [".", "/tmp"]
deny_write = [".env", "*.pem"]
```

Then: `just init` (active sessions pick up changes on next tool call)

## Two Sandbox Layers

1. **Process-level (bwrap)** — `scripts/sandbox.sh` wraps the entire Pi process. Config: `[env]` + `[paths]` in config.toml → `.pi/bwrap.json`.
2. **Tool-level (pi-sandbox)** — Extension intercepts bash/write/edit/read calls. Config: `[sandbox]` in config.toml → `.pi/sandbox.json`.

## References

- [Sandbox Details](references/SANDBOX.md) — Filesystem permissions, bwrap setup
- [Daemon Config](references/DAEMON.md) — Daemon settings, workflow discovery
- [Templates](references/TEMPLATES.md) — Config file format reference
- [Pi Update](references/PI-UPDATE.md) — Upgrade workflow
