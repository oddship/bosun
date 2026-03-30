# Bridge Protocol

Technical details of the CDP-mesh bridge communication protocol.

## CDP Channel

### Browser → Bridge: `Runtime.addBinding`

The bridge registers a CDP binding at startup:

```
CDP → Runtime.addBinding({ name: "piAnnotate" })
```

This creates `window.piAnnotate(payload)` in the page context. When the annotator JS calls it, CDP fires:

```json
{
  "method": "Runtime.bindingCalled",
  "params": {
    "name": "piAnnotate",
    "payload": "{\"selectedText\":\"...\",\"comment\":\"...\", ...}"
  }
}
```

The bridge parses the payload and writes a `MeshMessage` to the target agent's inbox.

### Bridge → Browser: `Runtime.evaluate`

When an agent responds via mesh, the bridge calls:

```
CDP → Runtime.evaluate({
  expression: "window.__piAnnotatorResponse('{\"type\":\"response\",\"from\":\"bosun\",...}')"
})
```

The annotator's `__piAnnotatorResponse` function parses the JSON and shows a toast.

## Mesh Message Format

### Annotation (bridge → agent)

```json
{
  "id": "uuid",
  "from": "browser-bridge",
  "to": "target-agent-name",
  "text": "**Browser Annotation** on [Page Title](url)\n\n> selected text\n\n**Comment:** user's comment\n\nElement: `css > selector`\nHeading context: h1 > h2\nSurrounding text: ...context...\nViewport: 1440×900\n\nAnnotation: workspace/scratch/annotations/.../HH-mm.json\nScreenshot: workspace/scratch/annotations/.../HH-mm.png",
  "timestamp": "2026-03-30T...",
  "urgent": false,
  "replyTo": null
}
```

### Response (agent → bridge)

Standard mesh message. The bridge extracts `from` and `text` fields and forwards to the browser.

## Annotation JSON Format

Persisted at `workspace/scratch/annotations/{domain}/{YYYY-MM-DD}/{HH-mm}.json`:

```json
{
  "url": "http://localhost:8080/about",
  "pageTitle": "About Us",
  "selectedText": "Our team has been working...",
  "surroundingText": "Founded in 2020, our team has been working on innovative solutions...",
  "cssSelector": "main > section.about > p.intro",
  "nearestHeadings": ["About Us", "Our Story"],
  "elementSnippet": "<p class=\"intro\">Founded in 2020, our team...</p>",
  "comment": "This paragraph is too long, break it up",
  "agentTarget": "bosun-cdp-mesh",
  "timestamp": "2026-03-30T13:42:00.000Z",
  "viewport": { "width": 1440, "height": 900 }
}
```

## Re-injection on Navigation

The bridge listens for `Page.loadEventFired` and re-injects `annotator.js` via `Runtime.evaluate`. The binding (`Runtime.addBinding`) persists across navigations in CDP but is re-registered defensively.

## Startup Sequence

1. Parse CLI args, validate `--target-agent`
2. Check PID lockfile — exit if bridge already running
3. Register in mesh registry
4. Connect to Chrome via CDP (`cdp-client.ts`)
5. `Page.enable` + `Runtime.enable`
6. `Runtime.addBinding({ name: "piAnnotate" })`
7. Read and inject `annotator.js`
8. Start inbox watcher (`fs.watch`)
9. Start health endpoint (`Bun.serve`)
10. Listen for `Runtime.bindingCalled` + `Page.loadEventFired`

## Shutdown Sequence

1. Close inbox watcher
2. Close CDP connection
3. Stop health server
4. Unregister from mesh
5. Remove PID lockfile
