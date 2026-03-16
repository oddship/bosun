# E2E Harness

Reusable end-to-end validation helpers for bosun's tmux-heavy workflows.

## Goals

- run against an isolated tmux server/socket
- avoid mutating the developer's active tmux session
- validate multi-window and pane-targeted behavior that unit tests cannot cover
- make regressions reproducible from the command line

## Current scenarios

### Runtime identity targeting

```bash
just e2e-runtime-identity
```

Validates that:
- window rename helpers act on the agent's own pane/window
- window lookup helpers read the agent's own pane/window
- the currently focused client window is left untouched

### Live Pi rename flow

```bash
just e2e-runtime-identity-live-pi
```

Validates that a real Pi session can:
- call `mesh_manage` to rename itself
- update its mesh registry entry
- update its own tmux window name
- leave the currently focused window untouched

## Layout

- `harness.ts` — tmux server/session/window orchestration utilities
- `fixtures/` — tiny scripts executed inside tmux panes
- `runtime-identity-sync.ts` — concrete runtime identity scenario

## Adding scenarios

Prefer scenarios that test one distributed invariant at a time, for example:
- rename from pane A must not mutate pane B's window
- invalid rename proposals must warn and not corrupt runtime identity
- startup alignment should converge mismatched mesh/tmux names

Keep scenarios deterministic and isolated. Use dedicated tmux sockets and temp files under the system temp/runtime directory.
