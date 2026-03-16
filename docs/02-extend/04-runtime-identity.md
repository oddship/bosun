---
title: Runtime Identity
description: Persona vs runtime naming, tmux/mesh sync, and validation strategy
---

# Runtime Identity

Bosun distinguishes between an agent's **persona** and its **runtime identity**.

- `PI_AGENT` → the persona/template/type (`bosun`, `lite`, `verify`)
- `PI_AGENT_NAME` → the runtime instance identity (`bosun-2`, `foo-bar`)

That runtime identity is what operators expect to see in:
- the Pi UI title/status
- the mesh peer list
- the tmux window name

## Why this matters

Without a separate runtime identity, multi-agent sessions drift quickly:
- multiple `bosun` sessions become visually indistinguishable
- tmux window names diverge from mesh peer names
- tools like the session sidebar can no longer reliably correlate a window with the peer running inside it

## Projection model

Treat runtime identity as one logical name with multiple projections:

| Surface | Uses |
|---------|------|
| Pi UI | `PI_AGENT_NAME ?? PI_AGENT` |
| Mesh | registered peer name |
| tmux | current agent window name |

`PI_AGENT` should continue to control persona loading. It should **not** be used as the human-visible per-session identity when `PI_AGENT_NAME` is available.

## Capability matrix

Identity sync is best-effort and capability-driven.

| tmux | mesh | behavior |
|------|------|----------|
| no | no | local UI shows runtime identity only |
| yes | no | tmux exists, but no distributed identity sync occurs |
| no | yes | mesh rename still works; UI follows mesh/runtime identity |
| yes | yes | full runtime identity sync can happen |

## Sync rules

When `pi-mesh` identity sync is enabled:

1. **Startup alignment**
   - If the current tmux window name differs from the mesh/runtime identity, tmux is aligned to the mesh name.
2. **Mesh → tmux**
   - `mesh_manage({ action: "rename" })` updates runtime identity, mesh peer name, Pi UI, and tmux window.
3. **tmux → mesh**
   - Manual tmux renames are observed and proposed back into mesh.
4. **Validation failures**
   - Invalid names warn and do not propagate.
   - Name collisions warn and the tmux window reverts to the current valid runtime identity.

## Critical tmux implementation detail

Tmux rename/display commands must target the **agent's own pane**, not the currently focused client window.

Wrong:

```bash
tmux rename-window foo-bar
tmux display-message -p '#W'
```

These commands act on the active client/window and can rename the wrong window if the user is focused elsewhere.

Correct:

```bash
tmux rename-window -t "$TMUX_PANE" foo-bar
tmux display-message -p -t "$TMUX_PANE" '#W'
```

Bosun's runtime identity sync uses `TMUX_PANE` whenever available and falls back only when it is missing.

## Sandbox and tmux socket note

Bosun's process sandbox mounts `--tmpfs /tmp`, so sockets created under `/tmp` are not shared between host and sandbox.

To keep tmux reachable from both sides, bosun uses a short socket path under a dedicated shared runtime directory:

```text
${XDG_RUNTIME_DIR:-/run/user/$UID}/bosun-tmux/bosun-<hash>.sock
```

This also avoids long socket path failures in deep worktrees.

## Configuration

Bosun generates identity sync settings into `.pi/pi-mesh.json` from `config.toml`:

```toml
[mesh.identity_sync]
enabled = true
startup_align = true
mesh_to_tmux = true
tmux_to_mesh = true
poll_interval_ms = 2000
```

## Validation strategy

Bosun includes a reusable tmux E2E harness in `scripts/e2e/`.

Current validation entrypoints:

```bash
just e2e-runtime-identity
just e2e-runtime-identity-live-pi
```

These verify pane-targeted runtime identity behavior and the live Pi → tool call → mesh/tmux rename flow using isolated tmux servers.

### Recommended future E2E coverage

- tmux rename collision reverts back to valid runtime identity
- startup alignment converges mismatched names on session start
- invalid tmux names warn without corrupting mesh state
