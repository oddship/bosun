# pi-gateway

Localhost web gateway for interactive `pi.sites` surfaces.

## Current scope

This package currently provides a Phase 1+ skeleton:

- reads `.pi/pi-gateway.json`
- starts a Bun HTTP server when enabled
- discovers package-declared `pi.sites`
- exposes:
  - `GET /api/health`
  - `GET /api/sites`
  - `GET /api/sites/{packageSlug}/{site}/status`
  - `GET /api/sites/{packageSlug}/{site}/logs?lines=200`
  - `GET /api/sites/{packageSlug}/{site}/messages`
  - `POST /api/sites/{packageSlug}/{site}/messages`
  - `POST /api/sites/{packageSlug}/{site}/start`
  - `POST /api/sites/{packageSlug}/{site}/stop`
  - `POST /api/sites/{packageSlug}/{site}/restart`
  - `POST /api/sites/{packageSlug}/{site}/reset`
  - `GET /api/sites/{packageSlug}/{site}/events` (SSE snapshots)
- `GET /api/sites/{packageSlug}/{site}/actions`
- `POST /api/sites/{packageSlug}/{site}/actions`
- renders markdown files as HTML site pages at `/sites/{packageSlug}/{site}/...`
- serves raw markdown with `?raw=1`
- still serves non-markdown assets directly
- shows a simple root index page listing discovered sites

## Notes

- Gateway is opt-in via `[gateway]` in `config.toml`
- Package site discovery is runtime-driven from `package.json`
- Per-site `site.json` manifests are loaded when present
- Status and log/control endpoints are now present, backed by tmux session checks
- Rendered markdown pages include a lightweight work-surface sidebar for status, controls, messages, page outline, diagnostics, and state reset
- Site pages now subscribe to an SSE stream for live status/log/message snapshots
- Runtime start/restart currently requires `site.json` to define both:
  - `runtime.sessionName`
  - `runtime.command`
- Message persistence is markdown-first: each site gets `.gateway/messages.md` plus `.gateway/messages.json`
- Runtime queue sidecars are also present for the current bridge prototype: `.gateway/inbox.json` and `.gateway/outbox.json`
- These queue paths can now be declared per site via `site.json`:
  - `runtime.inboxFile`
  - `runtime.outboxFile`
- Sites can now also declare a first-class Pi-backed runtime mode:
  - `runtime.backend = "pi-agent"`
  - `runtime.agentName` (optional, defaults to top-level `agent`)
  - `runtime.prompt` (optional extra launch instructions)
  - `runtime.promptTemplate = "site-maintainer"` to launch the agent with site-ownership / site-maintenance guidance
  - `runtime.maintainerIntent` to describe what this site should help the user do
  - `runtime.contextFiles` to list the primary site files the agent should treat as its maintained surface
  - `runtime.inputMode = "tmux"` for direct input dispatch into the tmux-backed Pi session
- Sites that want structured replies can declare:
  - `runtime.framedReplies = true`
  - a runtime that writes assistant messages to `.gateway/replies.json`
  - optional `runtime.resetOnStart = true` to clear stale sidecars before launching the session
- `packages/pi-gateway/src/framed-site-runtime.ts` is now a reusable shim for queue-based framed runtimes. Gateway injects site env vars such as:
  - `PI_SITE_NAME`
  - `PI_SITE_DIR`
  - `PI_SITE_STATE_DIR`
  - `PI_SITE_INBOX_FILE`
  - `PI_SITE_OUTBOX_FILE`
  - `PI_SITE_REPLIES_FILE`
  - `PI_SITE_TRANSCRIPT_FILE`
- `GET /api/sites` now exposes this runtime contract explicitly under `runtimeContract`, including prompt-template and context-file metadata
- `GET /api/sites` also exposes per-site action metadata under `actions`
- `packages/pi-gateway/sites/agent-console/` remains the reusable structured-reply demo
- `packages/pi-q/sites/console/` is now the first site-maintainer example that launches a real `q` agent with website-ownership guidance
- Pages can now emit structured site actions either via `POST /actions` or by using link/button hooks in the rendered HTML:
  - links with `href="site-action:action-name?target=section-id&scope=homepage"`
  - elements with `data-site-action`, `data-site-target`, `data-site-scope`, and optional `data-site-payload`
- If a site runtime is running, browser messages are either queued to the runtime or dispatched directly into the tmux session, depending on `runtime.inputMode`
- For `tmux` input mode, the gateway tracks terminal capture deltas in `.gateway/terminal-state.json` and promotes new output into assistant-style transcript entries when structured framing is not enabled
- If no runtime is running, the gateway falls back to a placeholder assistant reply
- The bootstrap `pi-gateway/dashboard` site now includes a simple startable tmux runtime for control-plane validation
- True agent-mediated messaging via real Pi sessions and mesh still comes in later phases
