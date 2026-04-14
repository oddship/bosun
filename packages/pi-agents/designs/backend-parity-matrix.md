# Backend parity matrix (tmux ↔ zmux)

This matrix defines the Phase 5 accepted capability set for Bosun dual-backend mode.

## Scope

- `tmux` remains the default/reference backend.
- `zmux` is opt-in via `.pi/agents.json` backend config.
- No ambient backend switching.

## Capability matrix

| Capability | tmux | zmux | Evidence |
|---|---|---|---|
| detached spawn | ✅ | ✅ | `packages/pi-agents/tests/spawn.test.ts` (`spawns using tmux...`, `spawns using zmux...`) |
| list / exists | ✅ | ✅ | `packages/pi-agents/tests/backend.test.ts` (`exercises zmux parity subset...`) + tmux contract capabilities assertion |
| attach routing | ✅ | ✅ | `packages/pi-agents/tests/backend.test.ts` (`exercises zmux parity subset...`) + queue routing/session naming tests in `packages/pi-gateway/src/pi-agent-queue-runtime.test.ts` |
| send text / send key | ✅ | ✅ | `packages/pi-agents/tests/backend.test.ts` (`exercises zmux parity subset...`) |
| capture tail | ✅ | ✅ | `packages/pi-agents/tests/backend.test.ts` (`exercises zmux parity subset...`) |
| kill | ✅ | ✅ | `packages/pi-agents/tests/backend.test.ts` (`exercises zmux parity subset...`) |
| readiness / await-ready split | ✅ (await-ready + legacy capture heuristic retained) | ✅ (await-ready only) | `packages/pi-gateway/src/pi-agent-queue-runtime.test.ts` (`zmux readiness waits...`, `tmux readiness preserves...`) |
| identity read / rename | ✅ | ✅ | `packages/pi-agents/tests/backend.test.ts` (stale target + session fallback tests) + `packages/pi-agents/tests/mesh-identity-sync.test.ts` (`mesh rename stays stable...`) |
| metadata sync | ✅ (`set-environment`) | ✅ (`write-metadata`) | `packages/pi-agents/tests/backend.test.ts` (`writeMetadata`/`readMetadata` roundtrip) + `packages/pi-agents/tests/spawn.test.ts` (pane-id metadata propagation) |
| reconnect semantics | name-scoped | durable-id scoped | `BackendCapabilities.reconnectSemantics` assertions in backend construction tests |

## Executable checks in this slice

- `packages/pi-agents/tests/config.test.ts`
- `packages/pi-agents/tests/backend.test.ts`
- `packages/pi-agents/tests/spawn.test.ts`
- `packages/pi-agents/tests/mesh-identity-sync.test.ts`
- `packages/pi-gateway/src/pi-agent-queue-runtime.test.ts`
- `packages/pi-bosun/src/cli.test.ts`

### Explicitly documented gap (accepted for this slice)

- We do not run live tmux binary attach/send/capture/kill integration in this package-level sandbox because runtime availability and process ownership vary across environments.
- Safety rationale for Phase 5 acceptance: tmux remains default, tmux codepaths are unchanged, tmux readiness behavior is still exercised in `pi-gateway` tests, and parity-sensitive contract behavior is executable against a deterministic zmux adapter harness.

## Dual-backend safety and rollback

1. Keep `.pi/agents.json` default backend = `tmux`.
2. Enable `zmux` only with explicit config (`state_dir` or `socket_path` required).
3. If operator issues appear, rollback by setting backend type back to `tmux` and re-running `just init`.
4. `tmux` codepaths stay intact (no destructive removal in Phase 5).

## Remaining cutover gate

Before making `zmux` default, require:

- sustained parity runs over the full Bosun integration suite
- operator signoff on attach/inspect ergonomics
- documented ownership for transport/backoff regressions
- explicit rollback trigger + runbook
