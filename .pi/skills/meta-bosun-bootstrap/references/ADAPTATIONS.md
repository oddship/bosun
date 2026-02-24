# File Adaptations Reference

When bootstrapping a downstream project, the agent reads upstream files and
adapts them. This document describes exactly what changes in each file and why.

## config.sample.toml

**Source:** `upstream/config.sample.toml`
**Target:** `config.sample.toml`

| Section | Change | Why |
|---------|--------|-----|
| `[agents].default_agent` | `"bosun"` → `"{{ORCHESTRATOR}}"` | Your orchestrator agent name |
| `[backend].command_prefix` | `"scripts/sandbox.sh"` → `"upstream/scripts/sandbox.sh"` | Sandbox script lives in submodule |
| `[env].allowed` | Add project-specific vars | e.g., `"MY_API_KEY"`, `"DATABASE_URL"` |
| `[daemon.watch]` patterns | Adjust if needed | Session paths use `.bosun-home/` which is unchanged |
| Everything else | Keep as-is | Model tiers, sandbox, daemon rules are generic |

**Minimal diff:** Only 1-2 lines change.

## scripts/init.ts

**Source:** `upstream/scripts/init.ts`
**Target:** `scripts/init.ts`

| Section | Change | Why |
|---------|--------|-----|
| `packages` array | Add your own packages | Your `packages/` entries alongside upstream's |
| `npmPackages` array | Add any extra npm Pi packages | If you use packages not in upstream |
| `settings.json` generation | Change paths to `../upstream/packages/` | Packages live in submodule |
| `agents.json` → `agentPaths` | Add `"./upstream/.pi/agents"` | Discover upstream stock agents |
| `agents.json` → `defaultAgent` | `"bosun"` → `"{{ORCHESTRATOR}}"` | Your orchestrator |
| `daemon.json` → `handlers_dir` | Point to your handlers or upstream's | `"upstream/scripts/daemon/handlers"` or `"scripts/daemon/handlers"` |

**Key detail for settings.json paths:**
Settings paths are resolved relative to `.pi/` (where settings.json lives).
So upstream packages are referenced as `"../upstream/packages/pi-agents"`.
Your local packages are `"../packages/pi-mylib"`.

The actual upstream `init.ts` has two arrays:
```typescript
const packages: string[] = ["pi-agents", "pi-daemon", "pi-question", ...];  // local workspace
const npmPackages: string[] = ["pi-mesh", "pi-web-access", "pi-mcp-adapter"]; // npm registry
```

In your adapted init.ts, split the `packages` array — upstream packages now
live under `upstream/packages/`, your local packages under `packages/`:

```typescript
// Upstream workspace packages (resolve via upstream/ submodule)
const upstreamPackages: string[] = [
  "pi-agents", "pi-daemon", "pi-question", "pi-session-context",
  "pi-sandbox", "pi-tmux", "pi-meta-skills", "pi-q",
];

// Your local workspace packages (if any)
const localPackages: string[] = [
  // "pi-mylib",  // example
];

// npm packages (unchanged)
const npmPackages: string[] = ["pi-mesh", "pi-web-access", "pi-mcp-adapter"];

writeJson("settings.json", {
  packages: [
    ...localPackages.map((p) => `../packages/${p}`),
    ...upstreamPackages.map((p) => `../upstream/packages/${p}`),
    ...npmPackages.map((p) => `npm:${p}`),
  ],
});
```

For agents.json, the upstream already has an `agentPaths` array with
`"./packages/pi-q/agents"`. You need to ADD the upstream agent path and
CHANGE the existing pi-q path:

```typescript
writeJson("agents.json", {
  models: { /* same as upstream */ },
  defaultAgent: "{{ORCHESTRATOR}}",
  agentPaths: [
    ...(Array.isArray(agents.extra_paths) ? agents.extra_paths : []),
    "./upstream/.pi/agents",                  // ADD: discover upstream stock agents
    "./upstream/packages/pi-q/agents",        // CHANGE: was "./packages/pi-q/agents"
  ],
  backend: {
    type: "tmux",
    socket: ".bosun-home/tmux.sock",
    command_prefix: "upstream/scripts/sandbox.sh",  // CHANGE: was "scripts/sandbox.sh"
  },
});
```

## justfile

**Source:** `upstream/justfile`
**Target:** `justfile`

| Pattern | Change | Why |
|---------|--------|-----|
| `scripts/sandbox.sh` | → `upstream/scripts/sandbox.sh` | Sandbox lives in submodule |
| `scripts/tmux-helpers.sh` | → `upstream/scripts/tmux-helpers.sh` | Helpers live in submodule |
| `scripts/tmux-next-bosun.sh` | → `upstream/scripts/tmux-next-bosun.sh` | Session naming script |
| `bosun` (session names) | → `{{PROJECT_NAME}}` | Your project name |
| `bosun-daemon` | → `{{PROJECT_NAME}}-daemon` | Daemon session name |
| `PI_AGENT=bosun` | → `PI_AGENT={{ORCHESTRATOR}}` | Your orchestrator |
| `PI_AGENT_NAME=bosun` | → `PI_AGENT_NAME={{ORCHESTRATOR}}` | Your orchestrator |
| `_ensure-daemon` paths | Update daemon script path | `scripts/sandbox.sh bun packages/pi-daemon/src/index.ts` → `upstream/scripts/sandbox.sh bun upstream/packages/pi-daemon/src/index.ts` |
| `_ensure-daemon` config path | Update daemon.json check | `.pi/daemon.json` path stays the same (it's in your project root) |

**Add new recipes:**
```just
# Update pi and ecosystem packages
update:
    #!/usr/bin/env bash
    set -euo pipefail
    CURRENT=$(node -e "console.log(require('./node_modules/@mariozechner/pi-coding-agent/package.json').version)")
    echo "Current: v$CURRENT"
    LATEST=$(npm info @mariozechner/pi-coding-agent version 2>/dev/null || echo "unknown")
    echo "Latest:  v$LATEST"
    if [[ "$CURRENT" == "$LATEST" ]]; then
      echo "Already up to date."
      exit 0
    fi
    echo ""
    echo "Updating pi packages..."
    bun update @mariozechner/pi-coding-agent pi-spawn_agent pi-mcp-adapter pi-interactive-shell pi-mesh
    UPDATED=$(node -e "console.log(require('./node_modules/@mariozechner/pi-coding-agent/package.json').version)")
    echo ""
    echo "Updated: v$CURRENT → v$UPDATED"
    echo ""
    echo "Changelog: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md"
    echo ""
    echo "Next steps:"
    echo "  1. Review changelog for breaking changes"
    echo "  2. git add package.json bun.lock && git commit -m 'build: update pi-coding-agent to v$UPDATED'"
    echo "  3. Restart: exit and run 'just start'"

# Sync upstream bosun
sync-upstream:
    cd upstream && git fetch origin && git checkout main && git pull
    cd .. && git add upstream
    bun install
    just init
    @echo "Upstream synced. Review with: git diff --cached upstream"

# Show skills diff with upstream
sync-skills:
    @echo "Skills in upstream not copied locally:"
    @comm -23 <(ls upstream/.pi/skills/ | sort) <(ls .pi/skills/ | sort) 2>/dev/null || true
    @echo ""
    @echo "Copy with: cp -r upstream/.pi/skills/<name> .pi/skills/"
```

## .pi/agents/{{ORCHESTRATOR}}.md

**Source:** `upstream/.pi/agents/bosun.md`
**Target:** `.pi/agents/{{ORCHESTRATOR}}.md`

| Section | Change | Why |
|---------|--------|-----|
| Frontmatter `name:` | `bosun` → `{{ORCHESTRATOR}}` | Agent identity |
| Frontmatter `description:` | Update to reflect project domain | e.g., "Main orchestrator for internal analytics platform" |
| "You are Bosun" | → "You are {{ORCHESTRATOR}}" | Persona |
| "sandboxed developer environment" | → project-specific description | Domain context |
| Available Agents table | Add project-specific agents | Keep upstream agents (lite, verify, etc.), add yours |
| Skills references | Add project-specific skills | Domain skills the orchestrator should know about |

**Keep everything else:** Delegation patterns, mesh coordination, spawn_agent
usage, guidelines — these are generic and well-tuned.

## .gitignore

**Source:** `upstream/.gitignore`
**Target:** `.gitignore`

Minimal changes. Add any project-specific ignores at the end.
The upstream .gitignore already covers `.bosun-home/`, `workspace/`,
`config.toml`, `.pi/*.json`, `node_modules/`, etc.

## Other Files (New, Not Adapted)

These are written fresh, not adapted from upstream:

| File | Content |
|------|---------|
| `.bosun-root` | Empty file (marker for sandbox.sh) |
| `.envrc` | `use flake` or `export PATH="$PWD/node_modules/.bin:$PATH"` |
| `README.md` | Project-specific readme |
| `flake.nix` | Optional — can reference upstream's `flake.nix` for devTools list |
| `config/tmux.conf` | Copy from upstream: `cp upstream/config/tmux.conf config/tmux.conf` |
