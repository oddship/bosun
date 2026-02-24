---
name: cdp-browser
description: |
  Browser automation via Chrome DevTools Protocol. Connects to Chromium
  running with --remote-debugging-port=9222. Use for: navigate, click, fill,
  screenshot, inspect DOM, capture console logs, debug errors, monitor network.
  Triggers: "browser", "go to", "click", "fill form", "take screenshot", 
  "web page", "scrape", "console errors", "debug", "network requests".
license: MIT
compatibility: Requires Node.js 18+, Chrome/Chromium with remote debugging enabled
allowed-tools: Bash Read Write
metadata:
  category: automation
  requires: chromium
---

# CDP Browser Skill

Control Chrome/Chromium browser via Chrome DevTools Protocol.

## What I Do

- Navigate to URLs and wait for page load
- Click elements, fill forms, type text
- Take screenshots, get accessibility tree
- Execute JavaScript in page context
- Wait for elements to appear
- **Capture console logs** (console.log, console.error, etc.)
- **Track errors and exceptions** (uncaught errors with stack traces)
- **Monitor network requests** (API calls, status codes, timing)

## When to Use Me

Use this skill when:
- Automating browser interactions
- Scraping dynamic web content (JavaScript-rendered)
- Testing web applications
- Filling forms programmatically
- Taking screenshots of web pages

## Do NOT Use For

- Simple HTTP requests (use `curl` or `webfetch` instead)
- Static HTML scraping (use `curl` + parsing)
- Entering real passwords or sensitive credentials

## Prerequisites

**The browser must be started on the HOST machine before entering the Zero sandbox.**

```bash
# ON HOST (outside sandbox): Start Chrome with debugging
chromium --remote-debugging-port=9222

# Or with a specific profile:
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

Then enter Zero sandbox and use the skill.

## Quick Check

```bash
# Verify Chrome is accessible
curl -s http://localhost:9222/json | head -20
```

## CLI Usage

All commands use the `cdp` script in this skill's scripts directory:

```bash
CDP=".pi/skills/cdp-browser/scripts/cdp"

# List tabs
$CDP tabs

# Navigate
$CDP navigate "https://example.com"

# Get page info
$CDP info

# Take screenshot (saves to workspace/temp/ by default)
$CDP screenshot workspace/temp/page.png

# Get accessibility tree (best way to find elements)
$CDP snapshot

# Click element
$CDP click "button.submit"

# Fill input field
$CDP fill "input[name=email]" "test@example.com"

# Type text (character by character, for autocomplete fields)
$CDP type "input[name=search]" "hello world"

# Wait for element to appear
$CDP waitfor ".results" 5000

# Evaluate JavaScript
$CDP eval "document.title"

# Get JSON output
$CDP --json info

# === DEBUGGING ===

# Capture console messages for 3 seconds (default)
$CDP console

# Capture console for longer (10 seconds)
$CDP console 10000

# Capture only errors and exceptions
$CDP errors

# Monitor network requests for 5 seconds
$CDP network 5000

# JSON output for programmatic use
$CDP --json errors
$CDP --json console 2000
```

## Debugging Workflow

For debugging web applications:

```bash
CDP=".pi/skills/cdp-browser/scripts/cdp"

# 1. Navigate to the page
$CDP navigate "http://localhost:3000"

# 2. Capture any immediate errors
$CDP errors

# 3. Perform an action
$CDP click "button.submit"

# 4. Check console output after action
$CDP console 3000

# 5. Check network requests if needed
$CDP network 5000
```

### Example: Debug a Vue/React App

```bash
CDP=".pi/skills/cdp-browser/scripts/cdp"

# Check for Vue/React warnings and errors
$CDP console 2000

# Get just errors with stack traces
$CDP errors

# Monitor API calls
$CDP network 5000 | grep -E "api|xhr"
```

## Workflow Pattern

1. **Navigate** to the target page
2. **Snapshot** to discover element selectors
3. **Interact** using click/fill/type
4. **Verify** with screenshot or snapshot
5. **Extract** data with eval or text commands

### Example: Fill a Form

```bash
CDP=".pi/skills/cdp-browser/scripts/cdp"

# Go to form page
$CDP navigate "https://httpbin.org/forms/post"

# Discover elements
$CDP snapshot > workspace/temp/form-structure.txt

# Fill fields
$CDP fill "input[name=custname]" "John Doe"
$CDP fill "input[name=custtel]" "555-1234"
$CDP fill "input[name=custemail]" "john@example.com"

# Click submit
$CDP click "button[type=submit]"

# Verify result
$CDP screenshot workspace/temp/result.png
```

## Command Reference

| Command | Description |
|---------|-------------|
| `tabs` | List open browser tabs |
| `info` | Get current page title/URL |
| `navigate <url>` | Go to URL |
| `screenshot [path]` | Save screenshot |
| `snapshot` | Get accessibility tree |
| `click <selector>` | Click element |
| `fill <selector> <value>` | Set input value |
| `type <selector> <text>` | Type text character by character |
| `eval <expr>` | Run JavaScript |
| `wait <ms>` | Wait milliseconds |
| `waitfor <selector>` | Wait for element |
| `html [selector]` | Get HTML content |
| `text <selector>` | Get text content |
| **Debugging** | |
| `console [ms]` | Capture console messages (default: 3000ms) |
| `errors` | Capture only errors/exceptions (2000ms) |
| `network [ms]` | Monitor network requests (default: 5000ms) |

## Options

- `--json` - Output as JSON (for programmatic use)
- `--tab=<id|title>` - Select specific tab

## Environment Variables

- `CDP_HOST` - Chrome host (default: localhost)
- `CDP_PORT` - Debug port (default: 9222)
- `CDP_TIMEOUT` - Command timeout in ms (default: 30000)

## Finding Elements

**Use `snapshot` first** to discover what elements exist:

```bash
$CDP snapshot | grep -i "button\|input\|link"
```

The accessibility tree shows:
- Element roles (button, textbox, link, etc.)
- Element names/labels
- Current values
- States (checked, disabled, focused)

Then use CSS selectors to interact:
- `button[type=submit]` - Submit button
- `input[name=email]` - Input by name
- `a[href*=login]` - Link containing "login"
- `.classname` - By class
- `#id` - By ID

## Browser Agent

For complex browser automation tasks, use the `@browser` agent which has restricted bash permissions for security:

```
@browser Navigate to example.com and fill the login form
```

The agent uses this CDP CLI directly and follows the workflow patterns documented here.

## Best Practices

- Use `snapshot` first to discover elements before interacting
- Use `waitfor` before clicking dynamic elements
- Use native `click`/`fill` instead of `eval` for reliability
- Use `errors` command to debug console errors quickly
- Chain commands with `&&` for multi-step flows

## Detailed References

- [CDP-COMMANDS.md](references/CDP-COMMANDS.md) - Full command documentation
- [TROUBLESHOOTING.md](references/TROUBLESHOOTING.md) - Common issues and fixes
