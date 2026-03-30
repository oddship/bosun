---
name: cdp-browser-mesh
description: |
  Browser-to-mesh annotation bridge via CDP. Injects an annotator UI into a
  browser tab — select text, comment, and send structured annotations to any
  mesh agent. Agent responses appear as toasts in the browser. Uses CDP
  Runtime.addBinding for the communication channel (no HTTP/CORS/CSP issues).
  Triggers: "browser-bridge", "annotate", "browser annotation", "page review".
license: MIT
compatibility: Requires Bun 1.0+, Chrome/Chromium with remote debugging, pi-mesh active
allowed-tools: Bash Read Write
metadata:
  category: automation
  requires: chromium bun pi-mesh
---

# CDP Browser-Mesh Bridge

Two-way communication between a browser page and pi-mesh agents via Chrome DevTools Protocol.

## Prerequisites

1. **Chromium with remote debugging**: `chromium --remote-debugging-port=9222`
2. **Pi-mesh active** on the target agent (`autoRegister: true` in `pi-mesh.json` — bosun default)

Quick check:
```bash
curl -s http://localhost:9222/json | head -5
```

## Quick Start

Start the bridge targeting the current agent:

```bash
# In a split pane:
bun packages/pi-cdp/skills/cdp-browser-mesh/scripts/bridge-server.ts \
  --target-agent <your-mesh-agent-name>
```

The bridge will:
1. Connect to Chrome via CDP (first page tab, or specify `--tab "title"`)
2. Inject the annotator UI into the page
3. Register as `browser-bridge` in the mesh
4. Forward annotations to the target agent as mesh messages
5. Forward agent responses back to the browser as toasts

## How It Works

### Architecture
```
Browser (injected annotator)
    ↕ CDP WebSocket (Runtime.addBinding + Runtime.evaluate)
Bridge Server (Bun process)
    ↕ File-based mesh (.pi/mesh/inbox/)
Pi Agent (target)
```

### Browser → Agent
1. User selects text on the page → popover with comment box
2. User submits → `window.piAnnotate(json)` calls CDP binding
3. Bridge receives `Runtime.bindingCalled` event
4. Bridge writes `MeshMessage` JSON to `.pi/mesh/inbox/{target-agent}/`
5. Bridge takes screenshot, persists annotation to `workspace/scratch/annotations/`

### Agent → Browser
1. Agent calls `mesh_send({ to: "browser-bridge", message: "..." })`
2. Bridge picks up from `.pi/mesh/inbox/browser-bridge/` via `fs.watch`
3. Bridge calls `Runtime.evaluate('window.__piAnnotatorResponse(...)')` 
4. Toast notification appears in browser

## CLI Arguments

| Arg | Required | Description |
|-----|----------|-------------|
| `--target-agent` | Yes | Mesh agent name to send annotations to |
| `--tab` | No | Tab ID or title substring to connect to |
| `--port` | No | Health endpoint port (default: 3456) |

## Annotation Payload

Each annotation includes rich context:

| Field | Description |
|-------|-------------|
| `selectedText` | The selected text (max 1000 chars) |
| `surroundingText` | ~400 chars from the containing block element |
| `cssSelector` | CSS path from root to selection element |
| `nearestHeadings` | Heading chain (h1→h6) above the selection |
| `elementSnippet` | Container element's outerHTML (max 500 chars) |
| `url` | Page URL |
| `pageTitle` | Page title |
| `comment` | User's annotation comment |
| `viewport` | `{ width, height }` |

## Annotation Persistence

Annotations are saved to:
```
workspace/scratch/annotations/{domain}/{YYYY-MM-DD}/{HH-mm}.json
workspace/scratch/annotations/{domain}/{YYYY-MM-DD}/{HH-mm}.png
```

## Navigation

The annotator survives full-page navigation — the bridge re-injects on each `Page.loadEventFired`.

## Troubleshooting

### Bridge says "Target agent not registered"
The target agent needs pi-mesh active. Check: `mesh_peers` in the agent session.

### Bridge says "Already running"
A previous bridge is still alive. Find and kill it, or remove `.pi/mesh/browser-bridge.pid`.

### Annotator not visible after navigation
The bridge re-injects automatically. If it doesn't appear within 1 second, the CDP connection may have dropped — restart the bridge.

### Agent response not showing in browser
Check that the agent is sending to `browser-bridge` (exact name): `mesh_send({ to: "browser-bridge", message: "..." })`.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/bridge-server.ts` | The bridge — CDP connection, mesh peer, annotation handler |
| `scripts/annotator.js` | Frontend UI — injected into browser via CDP |

## References

- [BRIDGE-PROTOCOL.md](references/BRIDGE-PROTOCOL.md) — CDP binding protocol details
