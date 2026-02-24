---
title: Downstream Projects
description: Build your own multi-agent environment on top of bosun
---

# Downstream Projects

Use bosun as a git submodule foundation for your own multi-agent environment. Inherit packages, agents, and infrastructure while adding your own domain-specific skills and tooling.

## How it works

```
your-project/
├── upstream/              ← git submodule of oddship/bosun (read-only)
├── .pi/agents/            ← your agents (override upstream by name)
├── .pi/skills/            ← your domain skills + copied generic skills
├── packages/              ← your custom Pi packages
├── config.toml            ← your config
├── justfile               ← your lifecycle (calls upstream/scripts/sandbox.sh)
└── .bosun-root            ← marker file for sandbox discovery
```

**Agent discovery**: Your `.pi/agents/` is scanned first. If you create `.pi/agents/lite.md`, it overrides upstream's lite agent. Upstream agents (bosun, verify, scout, review, oracle) remain available via `agentPaths` config.

**Package discovery**: Both `packages/*` and `upstream/packages/*` are bun workspaces. Your `scripts/init.ts` generates `.pi/settings.json` pointing to both.

**Skill propagation**: Copy generic skills (git, mesh, context-management) from upstream into your `.pi/skills/`. Add your own domain skills alongside them.

## Quick start

### Agent-assisted bootstrap

The fastest way — let an agent scaffold the project for you:

1. Start plain `pi` (no bosun needed)
2. Say:
   ```
   I want to create a project called "my-project" based on bosun.
   Fetch the guide: https://raw.githubusercontent.com/oddship/bosun/main/.pi/skills/meta-bosun-bootstrap/SKILL.md
   ```
3. The agent fetches the skill, asks you a few questions (project name, orchestrator name, domain), then scaffolds everything.

### Manual setup

```bash
mkdir my-project && cd my-project
git init
git submodule add https://github.com/oddship/bosun.git upstream
touch .bosun-root
mkdir -p .pi/agents .pi/skills packages scripts workspace .bosun-home config
```

Copy and adapt files from upstream:

```bash
# Config template
cp upstream/config.sample.toml config.sample.toml
# Edit: change default_agent, add your env vars

# Tmux config
cp upstream/config/tmux.conf config/tmux.conf

# Generic skills
for skill in git github context-management mesh tmux-orchestration \
             session-analysis background-processes skill-loading-patterns; do
  cp -r upstream/.pi/skills/$skill .pi/skills/
done
```

Files that need more than a copy (read upstream version and adapt):

- `scripts/init.ts` — add `agentPaths` pointing to upstream agents
- `justfile` — change session names, point scripts to `upstream/scripts/`
- `.pi/agents/<name>.md` — your main agent persona
- `package.json` — workspaces: `["packages/*", "upstream/packages/*"]`
- `flake.nix` — nix devShell with bwrap, tmux, bun, etc.

### Pitfalls

**Tmux socket path too long.** Tmux sockets have a ~107 character path limit. Use `.sock` at the project root in your justfile, not `.bosun-home/tmux.sock`:

```just
tmux_sock := justfile_directory() / ".sock"
```

**Daemon won't start.** `just start` must call an `_ensure-daemon` recipe that starts the daemon in a separate tmux session. Also, `.pi/daemon.json` must exist — run `just init` first.

**`.direnv/` committed.** Add `.direnv/` to `.gitignore` before the first commit.

### Install and start

```bash
bun install
cp config.sample.toml config.toml
# Edit config.toml with your API keys
just init       # generates .pi/*.json — required before start
just start
```

## Adding domain skills

Your domain skills are the main customization point:

```
.pi/skills/my-api/
├── SKILL.md              # Main instruction file
├── references/           # Detailed docs (loaded on demand)
│   └── ENDPOINTS.md
└── scripts/              # Helper scripts
    └── fetch-data.sh
```

Skills are loaded on demand by agents. Use the `meta-skill-creator` skill for scaffolding guidance.

## Syncing upstream

```bash
just sync-upstream      # Fetch latest, reinstall, regenerate config
just sync-skills        # Show upstream skills you haven't copied
```

Check for new config options:
```bash
diff config.sample.toml upstream/config.sample.toml
```

Then commit:
```bash
git add -A && git commit -m "chore: sync upstream bosun"
```

## Reference

- [Bootstrap Skill](https://github.com/oddship/bosun/tree/main/.pi/skills/meta-bosun-bootstrap) — Full scaffolding guide
- [Architecture](architecture/) — Package design and data flow
- [Packages](packages/) — Package reference
