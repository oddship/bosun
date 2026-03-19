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

### Memory init flow

```bash
just e2e-memory-init
```

Validates that:
- `scripts/init.ts` generates `.pi/pi-memory.json`
- memory config is camelCase-normalized
- `settings.json` includes `../packages/pi-memory`

### Memory CLI flow

```bash
just e2e-memory-cli
```

Validates that:
- memory fixture content is indexed
- `scripts/memory.ts status/search/get/multi-get` work end-to-end
- `just memory-status` works against generated config

## Layout

- `harness.ts` — tmux server/session/window orchestration utilities
- `memory-harness.ts` — temp workspace fixture setup for memory scenarios
- `fixtures/` — tiny scripts executed inside tmux panes
- `runtime-identity-sync.ts` — concrete runtime identity scenario
- `memory-init.ts` — init/config generation scenario
- `memory-cli-flow.ts` — memory command flow scenario

### Agent slot rendering (live Pi)

```bash
just e2e-agent-slots
```

Validates that a real Pi session with `PI_AGENT=bosun`:
- loads the agent from `packages/pi-bosun/agents/bosun.md`
- renders pi-bosun slots (delegation, workspace) into the system prompt
- renders pi-memory slots (memory guidance) into the system prompt

Requires `auth.json` and `config.toml`.

## Adding scenarios

Prefer scenarios that test one distributed invariant at a time, for example:
- rename from pane A must not mutate pane B's window
- invalid rename proposals must warn and not corrupt runtime identity
- startup alignment should converge mismatched mesh/tmux names
- memory init should not emit snake_case config keys
- memory CLI should retrieve seeded fixture documents end-to-end

Keep scenarios deterministic and isolated. Use dedicated tmux sockets and temp files under the system temp/runtime directory.
