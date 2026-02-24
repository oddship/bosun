# CDP Commands Reference

Detailed documentation for all CDP CLI commands.

## Command Overview

| Command | Arguments | Description |
|---------|-----------|-------------|
| `tabs` | none | List all open browser tabs |
| `info` | none | Get current page title and URL |
| `navigate` | `<url>` | Navigate to URL |
| `screenshot` | `[path]` | Capture screenshot |
| `snapshot` | none | Get accessibility tree |
| `click` | `<selector>` | Click element |
| `fill` | `<selector> <value>` | Set input value instantly |
| `type` | `<selector> <text>` | Type text character by character |
| `eval` | `<expression>` | Execute JavaScript |
| `wait` | `<ms>` | Wait for duration |
| `waitfor` | `<selector> [timeout]` | Wait for element |
| `html` | `[selector]` | Get HTML content |
| `text` | `<selector>` | Get text content |
| **Debugging** | | |
| `console` | `[duration]` | Capture console messages (default: 3000ms) |
| `errors` | none | Capture only errors/exceptions (2000ms) |
| `network` | `[duration]` | Monitor network requests (default: 5000ms) |

## Global Options

### `--json`

Output results as JSON for programmatic parsing.

```bash
cdp --json tabs
cdp --json info
cdp --json click "button"
```

### `--tab=<id|title>`

Select a specific tab by ID or title substring.

```bash
# By tab ID (from 'cdp tabs' output)
cdp --tab=ABC123 navigate "https://example.com"

# By title substring
cdp --tab=Gmail info
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CDP_HOST` | localhost | Chrome debug host |
| `CDP_PORT` | 9222 | Chrome debug port |
| `CDP_TIMEOUT` | 30000 | Command timeout (ms) |

## Command Details

### tabs

List all open browser tabs.

```bash
cdp tabs
# Output:
# 0: A1B2C3D4 | Example Domain                           | https://example.com/
# 1: E5F6G7H8 | Google                                   | https://google.com/

cdp --json tabs
# Output: [{"id":"A1B2C3D4...","title":"Example Domain","url":"https://example.com/","type":"page"}]
```

### info

Get current page information.

```bash
cdp info
# Output: {"title":"Example Domain","url":"https://example.com/"}
```

### navigate

Navigate to a URL. Adds `https://` if no protocol specified.

```bash
cdp navigate "https://example.com"
cdp navigate example.com  # https:// added automatically

# Wait longer for slow pages
CDP_TIMEOUT=60000 cdp navigate "https://slow-site.com"
```

### screenshot

Capture the visible viewport as PNG.

```bash
# Default path
cdp screenshot
# Saved to: workspace/temp/screenshot.png

# Custom path
cdp screenshot workspace/temp/my-capture.png
```

**Note:** Always save to `workspace/temp/` or `.pi/temp/` inside the Zero sandbox.

### snapshot

Get the accessibility tree - the best way to discover page elements.

```bash
cdp snapshot
# Output:
# - RootWebArea "Example Domain"
#   - heading "Example Domain"
#   - paragraph
#     - StaticText "This domain is for use..."
#   - link "More information..."
```

The tree shows:
- **Role** (button, textbox, link, heading, etc.)
- **Name** (the accessible name/label)
- **Value** (for inputs)
- **States** ([checked], [disabled], [focused])

### click

Click an element by CSS selector.

```bash
cdp click "button[type=submit]"
cdp click "#login-button"
cdp click "a.nav-link"
cdp click "input[type=checkbox]"
```

The element is scrolled into view before clicking.

### fill

Set an input's value instantly (no keystroke simulation).

```bash
cdp fill "input[name=username]" "john_doe"
cdp fill "input[type=email]" "john@example.com"
cdp fill "textarea" "Long text content here"
```

Triggers `input` and `change` events.

### type

Type text character by character with keystroke events.

```bash
cdp type "input[name=search]" "hello world"
```

Use this for:
- Autocomplete fields
- Fields with per-keystroke validation
- Search boxes with live suggestions

### eval

Execute JavaScript in the page context.

```bash
# Get document title
cdp eval "document.title"

# Count elements
cdp eval "document.querySelectorAll('a').length"

# Get form data
cdp eval "new FormData(document.querySelector('form')).get('email')"

# Scroll page
cdp eval "window.scrollTo(0, document.body.scrollHeight)"
```

### wait

Pause execution for specified milliseconds.

```bash
cdp wait 1000   # Wait 1 second
cdp wait 5000   # Wait 5 seconds
```

### waitfor

Wait for an element to appear in the DOM.

```bash
# Default 10 second timeout
cdp waitfor ".search-results"

# Custom timeout (5 seconds)
cdp waitfor ".search-results" 5000
```

### html

Get HTML content.

```bash
# Full page HTML
cdp html

# Specific element's outer HTML
cdp html "div.content"
cdp html "#main-article"
```

### text

Get the text content of an element.

```bash
cdp text "h1"
cdp text ".error-message"
cdp text "#price"
```

## CSS Selector Reference

Common selector patterns:

| Pattern | Description |
|---------|-------------|
| `#id` | By ID |
| `.class` | By class |
| `tag` | By tag name |
| `[attr=value]` | By attribute |
| `[attr*=value]` | Attribute contains value |
| `parent child` | Descendant |
| `parent > child` | Direct child |
| `:first-child` | First child |
| `:last-child` | Last child |
| `:nth-child(n)` | Nth child |

### Examples

```bash
# Form inputs
cdp fill "input[name=email]" "test@example.com"
cdp fill "input[type=password]" "secret123"
cdp fill "#username" "johndoe"

# Buttons
cdp click "button[type=submit]"
cdp click "button.primary"
cdp click "input[type=button][value=Send]"

# Links
cdp click "a[href='/login']"
cdp click "a[href*=signup]"  # Contains 'signup'

# Complex selectors
cdp click "form#login button[type=submit]"
cdp fill "div.form-group:nth-child(2) input" "value"
```

## Debugging Commands

### console

Capture console messages (console.log, console.warn, console.error, etc.) for a specified duration.

```bash
# Default 3 seconds
cdp console

# Custom duration (10 seconds)
cdp console 10000

# JSON output for parsing
cdp --json console 5000
```

**Output format:**
- `[LOG]` - console.log messages
- `[INFO]` - console.info messages  
- `[WARN]` - console.warn messages (yellow)
- `[ERROR]` - console.error and exceptions (red)

Each message includes source location (file:line) when available.

**JSON output:**
```json
{
  "messages": [
    {"type": "log", "text": "Hello", "timestamp": 1234567890, "source": "app.js:42"},
    {"type": "error", "text": "Failed", "timestamp": 1234567891, "source": "api.js:15"}
  ],
  "count": 2
}
```

### errors

Capture only errors and exceptions (faster, focused debugging).

```bash
cdp errors
cdp --json errors
```

Collects for 2 seconds and shows:
- `console.error()` calls
- Uncaught exceptions with stack traces

**Use case:** Quick check for JavaScript errors after an action.

```bash
# Click a button and check for errors
cdp click "button.submit"
cdp errors
```

### network

Monitor network requests (XHR, fetch, scripts, images, etc.).

```bash
# Default 5 seconds
cdp network

# Custom duration
cdp network 10000

# JSON output
cdp --json network 5000
```

**Output format:**
```
GET 200 https://api.example.com/users
POST 201 https://api.example.com/login
GET 404 https://api.example.com/missing
```

Status codes are colorized:
- Green (2xx) - Success
- Yellow (3xx) - Redirect
- Red (4xx, 5xx) - Error

**JSON output:**
```json
{
  "requests": [
    {"url": "https://api.example.com/users", "method": "GET", "status": 200, "type": "xhr"},
    {"url": "https://api.example.com/login", "method": "POST", "status": 201, "type": "fetch"}
  ],
  "count": 2
}
```

**Use case:** Debug API calls and check for failed requests.

```bash
# Monitor API calls during form submission
cdp network 5000 &
cdp click "button.submit"
wait
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (message printed to stderr) |

## Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| Cannot connect to Chrome | Chrome not running | Start Chrome with `--remote-debugging-port=9222` |
| No browser tabs found | No tabs open | Open at least one tab |
| Element not found | Invalid selector | Use `snapshot` to find correct selector |
| Element has no size | Hidden element | Element may be invisible |
| Timeout | Page/element slow | Increase `CDP_TIMEOUT` or use `waitfor` |
