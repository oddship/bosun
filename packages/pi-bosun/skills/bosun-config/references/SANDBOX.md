# Sandbox Details

## How It Works

Zero uses [Bubblewrap](https://github.com/containers/bubblewrap) (bwrap) to create a lightweight sandbox. Defined in `flake.nix`.

Three Nix wrappers exist:
- `bosun` - runs Pi in sandbox (`scripts/sandbox.sh pi`)
- `bosun-bash` - debug shell in sandbox (`just start-unsandboxed`)
- `bosun-daemon` - daemon in sandbox (`bun scripts/daemon/index.ts`)

## Filesystem Permissions

| Path | Permission | Notes |
|------|------------|-------|
| `/nix/store` | Read-only | All Nix packages |
| `BOSUN_ROOT/` | Read-write | Repo root (base bind) |
| `BOSUN_ROOT/flake.lock` | Read-only | Explicit ro overlay |
| `BOSUN_ROOT/workspace/` | Read-write | User data, project code |
| `BOSUN_ROOT/.pi/` | Read-write | Skills, extensions, generated config |
| `BOSUN_ROOT/..bosun-home/` | Read-write | Virtual `$HOME` |
| `BOSUN_ROOT/.bosun-daemon/` | Read-write | Daemon logs, state |
| `BOSUN_ROOT/flake.nix` | Read-write | Explicit rw bind |
| `/tmp` | Read-write | Temporary files |
| `/etc/resolv.conf`, `/etc/ssl`, `/etc/passwd`, `/etc/group` | Read-only | Network/DNS, user info |
| Docker socket (`/var/run/docker.sock`) | Read-write | Opt-in: `docker_passthrough = true` in `[sandbox]`. Respects `DOCKER_HOST`. |
| Tmux socket | Read-write | If running in tmux |

Note: `BOSUN_ROOT` is bound read-write at the top level, with specific files like `flake.lock` overlaid as read-only. See `flake.nix` for the full bind hierarchy.

### Custom Paths

#### Adding Read-Only Host Paths

To access files or directories outside the sandbox (e.g., external repos, shared data), add them to the `ro_bind` array in `config.toml`:

```toml
[paths]
ro_bind = [
  "/home/user/other-project",
  "/opt/shared-data",
  "/mnt/external"
]
```

#### Adding Read-Write Host Paths

For paths that agents need to modify (e.g., nix-system directories, shared build caches), use the `rw_bind` array:

```toml
[paths]
rw_bind = [
  "/home/user/nix-system",
]
```

Then apply the changes:

```bash
just init          # Regenerate .pi/bwrap.json with new mount config
just stop          # Stop the sandbox session
just start         # Restart sandbox with updated mounts
```

**Useful for:**
- Referencing other repositories without cloning into `workspace/`
- Accessing shared data directories on the host
- Cross-project analysis while keeping workspaces isolated

**Note:** `bwrap` mounts are fixed at process start, so you must restart the session for new paths to take effect.

#### Blocking Sensitive Paths

To prevent access to sensitive host directories, use the `deny` array:

```toml
[paths]
deny = ["/home/user/.ssh/private-keys"]
```

This overlays the path with an empty tmpfs (read-write but ephemeral).

## Environment Variables

### Always Set

| Variable | Value |
|----------|-------|
| `HOME` | `BOSUN_ROOT/..bosun-home` |
| `BOSUN_ROOT` | Repo root path |
| `BOSUN_SANDBOX` | `1` (sandbox active) |
| `BOSUN_SESSION` | Tmux session name |
| `PI_AGENT` | Current agent (default: `bosun`) |
| `SHELL` | Path to bash |
| `PATH` | `node_modules/.bin` + Nix dev tools |
| `EDITOR` | `nvim` |
| `TMUX` | Tmux socket path (if running in tmux) |

### User-Configurable

From `config.toml` `[env].allowed`. Only variables that exist in the host environment AND are in the allowlist get passed through. See `config.toml` `[env]` section for the full list. Example:

```toml
[env]
allowed = ["ANTHROPIC_API_KEY", "USER", "TERM", ...]
```

## Available Tools

Defined in `flake.nix` `devTools`:

**Languages:** Go, Node.js 22, Bun, Python 3.12, Rust
**Search:** ripgrep, fd, fzf, bat
**Git:** git, gh (GitHub CLI), gh (GitLab CLI), openssh
**Build:** make, just, gcc (for cgo)
**Utils:** jq, yq, curl, wget, neovim, file, strace, procps
**Containers:** docker-client (CLI only — connects to host daemon via socket)
**Infra:** nomad, awscli2

## Sandbox Quirks

- `whoami` fails (no user database inside sandbox). Use `$USER`.
- Child processes inherit sandbox restrictions.
- Network access is unrestricted (needed for AI APIs).
- SSH keys are symlinked from host `~/.ssh`.
- Git config is merged from host `.gitconfig` + `config/gitconfig`.

## Startup Flow

When `just start` runs:

1. `just _preflight` - checks Nix is installed
2. `just _ensure-daemon` - starts daemon in `bosun-daemon` tmux session
3. Creates `bosun` tmux session, runs `scripts/sandbox.sh pi`
4. Nix wrapper (`bosun`):
   a. Finds `.bosun-root` marker to locate repo
   b. Parses `config.toml` for env vars and paths
   c. Sets up `..bosun-home/` (SSH symlinks, gitconfig, tmux.conf)
   d. Runs `bun scripts/bosun init.ts` to generate configs from templates
   e. Launches `bwrap` with all mounts and env vars
   f. Inside sandbox: runs `pi` (starts in `workspace/`)
