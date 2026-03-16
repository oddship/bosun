---
name: cdp-browser
description: |
  Browser automation via Chrome DevTools Protocol. Connects to Chromium
  running with --remote-debugging-port=9222. Use for: navigate, click, fill,
  screenshot, inspect DOM, capture console logs, debug errors, monitor network,
  viewport emulation, visual review, overflow detection.
  Triggers: "browser", "go to", "click", "fill form", "take screenshot", 
  "web page", "scrape", "console errors", "debug", "network requests",
  "visual review", "responsive", "viewport", "overflow".
license: MIT
compatibility: Requires Bun 1.0+, Chrome/Chromium with remote debugging enabled
allowed-tools: Bash Read Write
metadata:
  category: automation
  requires: chromium bun
---

# CDP Browser Skill

Control Chrome/Chromium via Chrome DevTools Protocol.

**Implementation:** TypeScript on Bun. Zero dependencies — uses Bun's native WebSocket + fetch.

## Two Modes

### 1. CLI — one-shot commands

```bash
CDP=".pi/skills/cdp-browser/scripts/cdp.ts"

bun $CDP tabs
bun $CDP navigate "https://example.com"
bun $CDP screenshot workspace/scratch/page.png
bun $CDP device iphone-14
bun $CDP overflow
```

Each invocation opens a WebSocket, runs one command, closes.

### 2. Library — scripted workflows

```typescript
import { run } from "../../.pi/skills/cdp-browser/scripts/cdp-client";

await run(async (b) => {
  await b.navigate("http://localhost:8080");
  await b.resize(375, 812);
  await b.screenshot("mobile.png");
  const overflows = await b.checkOverflow();
  console.log("Overflows:", overflows.length);
});
```

Single persistent connection. Use for multi-step workflows, visual reviews, or anything that touches multiple pages/viewports.

## Prerequisites

**Chrome must be started on the HOST before entering the sandbox:**

```bash
chromium --remote-debugging-port=9222
```

Quick check:
```bash
curl -s http://localhost:9222/json | head -5
```

## CLI Commands

### Navigation & Info

| Command | Description |
|---------|-------------|
| `tabs` | List open tabs |
| `info` | Current page title + URL |
| `navigate <url>` | Go to URL (waits for load) |

### Screenshots

| Command | Description |
|---------|-------------|
| `screenshot [path]` | Viewport screenshot |
| `fullscreenshot [path]` | Full-page screenshot (scrolls) |

### Viewport & Emulation

| Command | Description |
|---------|-------------|
| `resize <w> <h>` | Set viewport (mobile auto ≤768) |
| `resetviewport` | Reset to browser default |
| `device [name]` | Emulate device preset (no args = list) |

Devices: `iphone-se`, `iphone-14`, `iphone-14-pro-max`, `pixel-7`, `ipad`, `ipad-pro`, `laptop`, `desktop`, `desktop-hd`

### Interaction

| Command | Description |
|---------|-------------|
| `click <selector>` | Click (scrolls into view) |
| `fill <selector> <value>` | Set input value (instant) |
| `type <selector> <text>` | Type character by character |

### Content

| Command | Description |
|---------|-------------|
| `eval <expr>` | Run JavaScript |
| `html [selector]` | Get HTML |
| `text <selector>` | Get innerText |
| `snapshot` | Accessibility tree |

### Waiting

| Command | Description |
|---------|-------------|
| `wait <ms>` | Sleep |
| `waitfor <selector> [ms]` | Wait for element (default 10s) |

### Debugging

| Command | Description |
|---------|-------------|
| `console [ms]` | Console messages (default 3s) |
| `errors` | Errors only (2s) |
| `network [ms]` | Network requests (default 5s) |

### Audit

| Command | Description |
|---------|-------------|
| `overflow` | Detect horizontal overflow |
| `inlinestyles` | Find `style=` attributes |

### Options

- `--json` — JSON output
- `--tab=<id|title>` — Target specific tab

## Workflow: Quick Check

```bash
CDP=".pi/skills/cdp-browser/scripts/cdp.ts"

bun $CDP navigate "http://localhost:8080"
bun $CDP snapshot | grep -i "button\|link"
bun $CDP click "button[type=submit]"
bun $CDP errors
bun $CDP screenshot workspace/scratch/result.png
```

## Workflow: Visual Review (scripted)

```typescript
import { run } from "../../.pi/skills/cdp-browser/scripts/cdp-client";

await run(async (b) => {
  // Multi-viewport screenshots
  await b.screenshotViewports("http://localhost:8080", "workspace/scratch/review", {
    mobile: { width: 375, height: 812 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1440, height: 900 },
  });

  // Check each viewport for overflow
  for (const [name, vp] of [["mobile", 375], ["tablet", 768], ["desktop", 1440]]) {
    await b.resize(vp as number, 900);
    const issues = await b.checkOverflow();
    console.log(`${name}: ${issues.length ? issues.length + " overflow(s)" : "clean"}`);
  }

  // Console errors
  const errs = await b.errors();
  console.log(`Errors: ${errs.length}`);
});
```

## Library API Summary

### Connection
- `connect(opts?)` → `Browser`
- `run(fn, opts?)` → auto-connect + close
- `browser.close()`

### Navigation
- `.navigate(url)`, `.reload()`, `.url()`, `.title()`

### Screenshots
- `.screenshot(path, opts?)` — viewport or `{ fullPage: true }`
- `.screenshotViewports(url, dir, viewports, opts?)` — batch

### Viewport
- `.resize(w, h, dpr?)`, `.emulate(device)`, `.resetViewport()`, `.viewport()`

### Interaction
- `.click(sel)`, `.fill(sel, val)`, `.type(sel, text)`, `.press(key)`

### Content
- `.eval(js)`, `.html(sel?)`, `.text(sel)`, `.exists(sel)`, `.count(sel)`
- `.css(sel, prop)`, `.rect(sel)`

### Waiting
- `.waitFor(sel, timeout?)`, `.sleep(ms)`

### Accessibility
- `.accessibilityTree()` → structured `AXNode`
- `.accessibilitySnapshot()` → flat text

### Debugging
- `.console(ms?)`, `.errors(ms?)`, `.network(ms?)`

### Audit
- `.checkOverflow()` → `{ selector, overflow }[]`
- `.findInlineStyles()` → `{ selector, style }[]`

### Raw CDP
- `.send(method, params)` — any CDP protocol method
- `.on(handler)` → unsubscribe function

## References

- [CDP-COMMANDS.md](references/CDP-COMMANDS.md) — Full CLI command docs
- [SCRIPTING.md](references/SCRIPTING.md) — Library usage, recipes, visual review scripts
- [TROUBLESHOOTING.md](references/TROUBLESHOOTING.md) — Common issues
