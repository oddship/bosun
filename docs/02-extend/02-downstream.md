---
title: Downstream Projects
description: Build your own multi-agent environment on top of bosun
---

# Downstream Projects

Build your own multi-agent environment using bosun as a foundation. Three
approaches, from simplest to most controlled.

## Option A: bun add (simplest)

Install bosun as a regular dependency. No local clone needed.

### Setup

```bash
mkdir my-project && cd my-project
bun init

# Install bosun (from GitHub — tracks main branch)
bun add github:oddship/bosun

# Or pin to a tag for stability
# bun add github:oddship/bosun#v0.1.0

# Scaffold config, justfile, and directory structure
npx bosun onboard

# Edit config.toml with your API keys and model preferences
vim config.toml

# Start
just start
```

This puts bosun at `node_modules/bosun/`. The `init.ts` script auto-detects
**dependency mode** — it discovers packages, agents, and skills from
`node_modules/bosun/packages/` automatically. No workspace globs or custom
paths needed.

### Upgrades

```bash
bun update bosun    # pulls latest from GitHub (or pinned tag)
just init           # regenerate .pi/*.json
```

## Option B: bun link (for bosun co-development)

Use when you're actively developing bosun alongside your project. Changes to
the local bosun repo are reflected immediately without reinstalling.

### Setup

```bash
# Register bosun for linking (once, from the bosun repo)
cd /path/to/bosun
bun link

# Create your project
mkdir my-project && cd my-project
bun init
bun link bosun

# Scaffold config, justfile, and directory structure
npx bosun onboard

# Edit config.toml with your API keys and model preferences
vim config.toml

# Start
just start
```

### What onboard creates

```
my-project/
├── config.toml              ← your config (API keys, models, settings)
├── justfile                 ← imports bosun's recipes, add your own below
├── .pi/
│   ├── agents/              ← empty — your overrides go here
│   ├── skills/              ← empty — your custom skills go here
│   ├── slots/               ← empty — your slot overrides go here
│   ├── settings.json        ← generated (points to bosun's packages)
│   └── agents.json          ← generated (agentPaths into node_modules/bosun/)
├── workspace/
│   └── users/               ← session logs, plans, tasks
├── .bosun-home/             ← sandboxed HOME directory
└── node_modules/
    └── bosun/               ← linked bosun repo (read-only)
```

### How discovery works

**Agents**: `.pi/agents/` is checked first. If you create `.pi/agents/bosun.md`,
it overrides bosun's default. Otherwise, agents are found via `agentPaths` pointing
into `node_modules/bosun/packages/pi-bosun/agents/`.

**Skills**: Skills from bosun's packages are auto-discovered (pi-bosun, pi-q, etc.).
Generic skills (git, github, etc.) are found via the `skills` path in settings.json.
Add your own in `.pi/skills/`.

**Slots**: Template engine checks `.pi/slots/<pkg>/` first (your overrides), then
falls through to the package's own slots directory.

**Extensions**: All bosun packages are listed in settings.json. Pi loads their
extensions automatically.

### Customization

**Override an agent:**
```bash
# Copy the default and modify
cp node_modules/bosun/packages/pi-bosun/agents/bosun.md .pi/agents/bosun.md
# Edit: change model, add tools, modify persona
```

**Add a custom agent:**
```bash
# Create .pi/agents/deploy.md with frontmatter + body
cat > .pi/agents/deploy.md << 'EOF'
---
name: deploy
description: Deployment specialist
model: medium
extensions:
  - pi-mesh
  - pi-question
---
You are a deployment specialist...
EOF
```

**Add domain skills:**
```
.pi/skills/my-api/
├── SKILL.md              # Instructions (loaded on demand)
├── references/
│   └── ENDPOINTS.md      # Detailed docs
└── scripts/
    └── fetch-data.sh     # Helper scripts
```

**Add project-specific justfile recipes:**
```just
# Your justfile — bosun recipes are inherited via import
export BOSUN_PKG := justfile_directory() / "node_modules/bosun"
import "node_modules/bosun/justfile"

# Your additions
deploy:
    ./scripts/deploy.sh

seed-db:
    bun scripts/seed.ts
```

### Upgrades

```bash
# Pull latest bosun (if you cloned it)
cd /path/to/bosun && git pull

# In your project — re-run init to pick up any new config
cd my-project
just init

# Check for new config options or tool requirements
npx bosun doctor
```

`just init` regenerates `.pi/*.json` using the latest `init.ts` from bosun.
New packages, agents, skills, and config sections are picked up automatically.
Your `config.toml` is never overwritten — missing sections use defaults.

### Config drift

When bosun adds new `config.toml` sections, `bosun doctor` reports them:

```
$ npx bosun doctor
⚠ config.toml is missing sections from the latest sample:
    [memory.search_defaults]
    [web_access.video]

  These sections use defaults. To customize, copy them from:
  /path/to/node_modules/bosun/config.sample.toml
```

## Option C: Git submodule

For environments where npm/GitHub access is restricted, or when you need the
bosun source vendored into your repo.

### Setup

```bash
mkdir my-project && cd my-project
git init
git submodule add https://github.com/oddship/bosun.git upstream

# Install bosun's deps
cd upstream && bun install && cd ..

# Your project's package.json
cat > package.json << 'EOF'
{
  "name": "my-project",
  "workspaces": ["packages/*", "upstream/packages/*"]
}
EOF
bun install
```

### Key differences from bun link

- Bosun lives at `upstream/` instead of `node_modules/bosun/`
- Your `scripts/init.ts` needs custom `agentPaths` pointing to `upstream/packages/`
- You write your own justfile (can't import from upstream easily)
- Version pinned via submodule commit

### Syncing

```bash
cd upstream && git pull origin main && cd ..
bun install
just init
git add upstream && git commit -m "chore: sync upstream bosun"
```

Check for new config:
```bash
diff config.toml upstream/config.sample.toml
```

## Reference

- [Bootstrap Skill](https://github.com/oddship/bosun/tree/main/packages/pi-bosun/skills/meta-bosun-bootstrap) — Agent-assisted scaffolding
- [[Architecture]] — Package design and data flow
- [[Packages]] — Package reference
