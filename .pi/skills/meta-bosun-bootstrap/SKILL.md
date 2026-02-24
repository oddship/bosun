---
name: meta-bosun-bootstrap
description: Bootstrap a new project using bosun as a git submodule foundation. Use when creating a downstream project that inherits bosun's multi-agent infrastructure while adding custom agents, skills, and extensions. Works standalone — fetchable by any pi agent via raw GitHub URL.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: meta
  stable-url: true
---

# Create Project from Bosun

Scaffold a downstream project that uses [bosun](https://github.com/oddship/bosun)
as a git submodule, inheriting its multi-agent infrastructure while layering
your own agents, skills, and domain-specific tooling on top.

## When to Use

- You want bosun's packages (pi-agents, pi-tmux, pi-daemon, pi-mesh, etc.)
  without forking the repo
- You have domain-specific agents and skills to add
- You want to sync upstream improvements with `git submodule update`

## Prerequisites

- `git`, `bun`, `tmux`, `pi` installed
- Optionally `bwrap` (for process-level sandboxing) or `nix` (for nix-based sandboxing)

## Bootstrap

### Step 0: Gather Information

Ask the user for:
1. **Project name** (kebab-case, e.g., `my-project`)
2. **Orchestrator agent name** (e.g., `zero`) — this replaces "bosun"
3. **Brief domain description** (e.g., "Internal analytics platform")
4. **Which upstream skills to copy** — show the list from `upstream/.pi/skills/`
   and let the user pick. Generic ones worth copying: `git`, `github`,
   `context-management`, `mesh`, `tmux-orchestration`, `session-analysis`,
   `background-processes`, `skill-loading-patterns`

### Step 1: Initialize

Create the project and add bosun as a submodule. **All subsequent steps depend
on `upstream/` existing** — the agent reads upstream files to adapt them.

```bash
mkdir {{PROJECT_NAME}} && cd {{PROJECT_NAME}}
git init
git submodule add https://github.com/oddship/bosun.git upstream
touch .bosun-root
mkdir -p .pi/agents .pi/skills packages scripts workspace .bosun-home config
```

### Step 2: package.json

Write a new `package.json`:

```json
{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "upstream/packages/*"],
  "scripts": {
    "init": "bun run scripts/init.ts"
  },
  "dependencies": {
    "pi-agents": "workspace:*",
    "pi-daemon": "workspace:*",
    "pi-meta-skills": "workspace:*",
    "pi-q": "workspace:*",
    "pi-question": "workspace:*",
    "pi-sandbox": "workspace:*",
    "pi-session-context": "workspace:*",
    "pi-tmux": "workspace:*",
    "pi-mesh": "^0.1.2",
    "pi-web-access": "^0.10.2",
    "pi-mcp-adapter": "^2.1.2"
  },
  "devDependencies": {
    "@iarna/toml": "^3.0.0",
    "@types/bun": "latest"
  }
}
```

The `workspace:*` dependencies resolve against ALL workspace globs — bun searches
both `packages/*` and `upstream/packages/*` to find a match. So `"pi-agents": "workspace:*"`
finds `upstream/packages/pi-agents` automatically.
npm packages (`pi-mesh`, `pi-web-access`, `pi-mcp-adapter`) are fetched from the registry.

### Step 3: config.sample.toml

Read `upstream/config.sample.toml` and write an adapted version:

**Adaptations:**
- Change `[agents]` → `default_agent` to `"{{ORCHESTRATOR_NAME}}"`
- Change `[backend]` → `command_prefix` to `"upstream/scripts/sandbox.sh"`
- Add any project-specific env vars to `[env].allowed` (e.g., `"MY_API_KEY"`)
- Adjust `[daemon.watch]` patterns if your home dir name differs
- Keep everything else — the upstream config structure is the contract

### Step 4: scripts/init.ts

Read `upstream/scripts/init.ts` and write an adapted version:

**Adaptations:**
- In the `packages` array: keep all upstream package names (they resolve via workspaces)
- Add any of your own packages from `packages/`
- In `agents.json` generation: add `agentPaths`:
  ```typescript
  agentPaths: [
    ...(Array.isArray(agents.extra_paths) ? agents.extra_paths : []),
    "./upstream/.pi/agents",
    "./upstream/packages/pi-q/agents",
  ],
  ```
- In `settings.json` generation: package paths should reference upstream:
  ```typescript
  packages: [
    ...localPackages.map((p) => `../packages/${p}`),
    ...upstreamPackages.map((p) => `../upstream/packages/${p}`),
    ...npmPackages.map((p) => `npm:${p}`),
  ],
  ```
- Change `defaultAgent` to `"{{ORCHESTRATOR_NAME}}"`
- Everything else (daemon.json, sandbox.json, bwrap.json, pi-mesh.json, etc.)
  stays the same — it's generic config generation

### Step 5: justfile

Read `upstream/justfile` and write an adapted version. The justfile uses
`upstream/scripts/tmux-helpers.sh` for tmux management functions.

**Critical details:**
- **Tmux socket path**: Use `.sock` at project root, NOT `.bosun-home/tmux.sock`.
  Tmux sockets have a ~107 char path limit. Deep directory paths will fail.
- **Helpers preamble**: Use the `_helpers` variable pattern to source tmux helpers
  with correct `BOSUN_ROOT` and `TMUX_CMD` env vars.
- **Daemon recipe**: Include `_ensure-daemon` to start the daemon alongside the main session.

**Template** (replace `{{PROJECT_NAME}}` and `{{ORCHESTRATOR_NAME}}`):

```just
{{PROJECT_NAME}}_root := justfile_directory()
tmux_sock := {{PROJECT_NAME}}_root / ".sock"
tmux_cmd := "tmux -S " + tmux_sock

_helpers := 'export BOSUN_ROOT="' + {{PROJECT_NAME}}_root + '" TMUX_CMD="' + tmux_cmd + '"; source "' + {{PROJECT_NAME}}_root + '/upstream/scripts/tmux-helpers.sh"'

default:
    @just --list

start:
    #!/usr/bin/env bash
    just _ensure bwrap tmux bun pi
    {{{{_helpers}}}}
    ensure_dirs
    if {{{{tmux_cmd}}}} has-session -t {{PROJECT_NAME}} 2>/dev/null; then
      exec {{{{tmux_cmd}}}} attach -t {{PROJECT_NAME}}
    fi
    {{{{tmux_cmd}}}} -f "{{{{{{PROJECT_NAME}}}}_root}}/config/tmux.conf" new-session -d -s {{PROJECT_NAME}} -n {{ORCHESTRATOR_NAME}}
    set_tmux_env
    {{{{tmux_cmd}}}} send-keys -t {{PROJECT_NAME}}:{{ORCHESTRATOR_NAME}} "cd {{{{{{PROJECT_NAME}}}}_root}} && PI_AGENT={{ORCHESTRATOR_NAME}} PI_AGENT_NAME={{ORCHESTRATOR_NAME}} upstream/scripts/sandbox.sh pi" Enter
    just _ensure-daemon
    {{{{tmux_cmd}}}} attach -t {{PROJECT_NAME}}

start-unsandboxed:
    #!/usr/bin/env bash
    just _ensure tmux bun pi
    {{{{_helpers}}}}
    ensure_dirs
    if {{{{tmux_cmd}}}} has-session -t {{PROJECT_NAME}} 2>/dev/null; then
      exec {{{{tmux_cmd}}}} attach -t {{PROJECT_NAME}}
    fi
    {{{{tmux_cmd}}}} -f "{{{{{{PROJECT_NAME}}}}_root}}/config/tmux.conf" new-session -d -s {{PROJECT_NAME}} -n {{ORCHESTRATOR_NAME}}
    set_tmux_env
    {{{{tmux_cmd}}}} send-keys -t {{PROJECT_NAME}}:{{ORCHESTRATOR_NAME}} "cd {{{{{{PROJECT_NAME}}}}_root}} && BOSUN_ROOT={{{{{{PROJECT_NAME}}}}_root}} PI_AGENT={{ORCHESTRATOR_NAME}} PI_AGENT_NAME={{ORCHESTRATOR_NAME}} pi" Enter
    {{{{tmux_cmd}}}} attach -t {{PROJECT_NAME}}

init:
    @test -f config.toml || { echo "config.toml not found. Run: just setup"; exit 1; }
    bun scripts/init.ts

setup:
    #!/usr/bin/env bash
    if [[ ! -f config.toml ]]; then
        cp config.sample.toml config.toml
        echo "Created config.toml — edit with your API keys"
    fi
    bun install
    just init
    mkdir -p .bosun-home/.pi/agent workspace
    echo "Ready! Run: just start"

stop:
    {{{{tmux_cmd}}}} kill-server 2>/dev/null || true
    @echo "Stopped."

sync-upstream:
    cd upstream && git fetch origin && git checkout main && git pull
    cd .. && git add upstream
    bun install
    just init
    @echo "Upstream synced. Review changes, then commit."

_ensure-daemon:
    #!/usr/bin/env bash
    if [[ ! -f ".pi/daemon.json" ]]; then exit 0; fi
    ENABLED=$(grep -o '"enabled".*true' ".pi/daemon.json" || echo "")
    if [[ -z "$ENABLED" ]]; then exit 0; fi
    if {{{{tmux_cmd}}}} has-session -t {{PROJECT_NAME}}-daemon 2>/dev/null; then
      echo "Daemon already running"
    else
      echo "Starting daemon..."
      {{{{tmux_cmd}}}} -f "config/tmux.conf" new-session -d -s {{PROJECT_NAME}}-daemon -n daemon
      {{{{tmux_cmd}}}} send-keys -t {{PROJECT_NAME}}-daemon:daemon "cd $PWD && BOSUN_ROOT=$PWD upstream/scripts/sandbox.sh bun upstream/packages/pi-daemon/src/index.ts" Enter
      sleep 2
      echo "Daemon started"
    fi

_ensure +tools:
    #!/usr/bin/env bash
    for cmd in {{{{tools}}}}; do
      command -v "$cmd" &>/dev/null || { echo "Missing: $cmd"; exit 1; }
    done
```

**Note:** The template above uses `{{{{ }}}}` to escape just's interpolation.
When generating the actual justfile, use normal `{{ }}` just syntax.

### Step 6: Orchestrator Agent

Read `upstream/.pi/agents/bosun.md` and write `.pi/agents/{{ORCHESTRATOR_NAME}}.md`:

**Adaptations:**
- Change `name: bosun` → `name: {{ORCHESTRATOR_NAME}}`
- Change `description` to reflect the project's purpose
- Update the "You are Bosun" line to "You are {{ORCHESTRATOR_NAME}}"
- Update the "Available Agents" table — keep upstream agents (lite, verify,
  scout, review, oracle) and add any project-specific agents
- Keep everything else — the delegation patterns, mesh coordination,
  guidelines are generic and valuable

### Step 7: .gitignore

Read `upstream/.gitignore` and copy it. Add these additional entries:

```gitignore
# Tmux socket
.sock

# Direnv cache
.direnv/
```

Plus any project-specific ignores (e.g., data files that should never be committed).

### Step 7b: flake.nix (recommended)

Create a `flake.nix` so `nix develop` provides all tools including `bwrap`:

```nix
{
  description = "{{PROJECT_NAME}}";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let pkgs = nixpkgs.legacyPackages.${system}; in {
        devShells.default = pkgs.mkShell {
          name = "{{PROJECT_NAME}}-dev";
          buildInputs = [
            pkgs.bun pkgs.nodejs_22 pkgs.bubblewrap pkgs.tmux
            pkgs.git pkgs.ripgrep pkgs.fd pkgs.jq pkgs.just
          ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };
      }
    );
}
```

### Step 8: .envrc

Write a direnv config:
```bash
use flake
```

### Step 9: Copy Skills

Copy selected generic skills from upstream:

```bash
for skill in git github context-management mesh tmux-orchestration \
             session-analysis background-processes skill-loading-patterns; do
  cp -r upstream/.pi/skills/$skill .pi/skills/
done
```

The user can also copy `chronicle`, `editorial-review`, `humanizer`, etc.
as desired. Domain-specific skills are created fresh in `.pi/skills/`.

### Step 10: tmux.conf

```bash
cp upstream/config/tmux.conf config/tmux.conf
# Or: mkdir -p config && ln -s ../upstream/config/tmux.conf config/tmux.conf
```

### Step 11: Install & Initialize

```bash
bun install
cp config.sample.toml config.toml
# Edit config.toml with API keys
just init
```

### Step 12: Initial Commit

```bash
git add -A
git commit -m "feat: scaffold {{PROJECT_NAME}} from bosun"
```

### Step 13: Test

```bash
just start
```

Verify:
- Pi starts with the correct orchestrator agent
- `spawn_agent({ agent: "lite", task: "say hello" })` works
- Skills are listed correctly
- Upstream agents appear in the agent list

## Post-Bootstrap: Modifications

### Adding an Agent

Create `.pi/agents/<name>.md` with frontmatter:
```yaml
---
name: trader
description: Trading strategy specialist
model: medium
tools: read, bash, write, edit
extensions:
  - pi-agents
  - pi-mesh
  - pi-question
---
```

### Adding a Skill

Create `.pi/skills/<name>/SKILL.md`. See `upstream/.pi/skills/` for examples,
or load the `meta-skill-creator` skill for guidance.

### Adding an Extension

For quick, project-specific tools: create `.pi/extensions/<name>/index.ts`.
For reusable packages: create `packages/<name>/` with a `package.json` containing
a `"pi"` key. See upstream's packages for the pattern.

**Warning:** Don't name your packages the same as upstream packages (e.g., don't
create `packages/pi-agents/`). This causes workspace resolution conflicts.

### Adding a Daemon Handler

Either point `handlers_dir` in `config.toml` to `upstream/scripts/daemon/handlers`
(reuse stock handlers) or create your own `scripts/daemon/handlers/` directory.

### Overriding an Upstream Agent

Create `.pi/agents/<same-name>.md` in your project. Downstream `.pi/agents/`
is scanned first, so your version wins. For example, create `.pi/agents/lite.md`
to customize the lite agent's persona or extensions.

## Syncing Upstream

See `references/SYNC-GUIDE.md` for detailed instructions.

Quick version:
```bash
just sync-upstream
# Review changes to upstream/
# Check for new config options:
diff config.sample.toml upstream/config.sample.toml
# Update config.sample.toml if needed
# Commit
git commit -m "chore: sync upstream bosun"
```

## Reference Documents

For detailed guidance, fetch these reference files:

- **Directory structure**: `references/DOWNSTREAM-STRUCTURE.md`
  Full layout with explanations for every file and directory.

- **Sync guide**: `references/SYNC-GUIDE.md`
  Detailed upstream sync, config drift detection, breaking change handling.

- **Adaptations**: `references/ADAPTATIONS.md`
  Per-file diff guide — exactly what changes in each upstream file and why.

When bootstrapping via raw URL, fetch references at:
`https://raw.githubusercontent.com/oddship/bosun/main/.pi/skills/meta-bosun-bootstrap/references/<filename>`
