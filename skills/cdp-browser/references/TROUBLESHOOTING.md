# CDP Browser Troubleshooting

Common issues and solutions when using the CDP browser skill.

## Connection Issues

### "Cannot connect to Chrome at localhost:9222"

**Cause:** Chrome is not running with remote debugging enabled.

**Solution:** Start Chrome on the HOST machine (outside the sandbox):

```bash
# Basic
chromium --remote-debugging-port=9222

# With fresh profile (avoids conflicts)
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug

# Headless mode
chromium --remote-debugging-port=9222 --headless=new
```

**Verify it's working:**
```bash
curl -s http://localhost:9222/json
```

### "No browser tabs found"

**Cause:** Chrome is running but has no tabs open.

**Solution:** Open at least one tab in Chrome, or navigate to a URL:
```bash
chromium --remote-debugging-port=9222 "https://example.com"
```

### "ECONNREFUSED"

**Cause:** The debug port is not accessible.

**Possible causes:**
1. Chrome crashed or was closed
2. Another process is using port 9222
3. Firewall blocking the connection

**Solutions:**
```bash
# Check if port is in use
lsof -i :9222

# Kill existing Chrome and restart
pkill -f "remote-debugging-port=9222"
chromium --remote-debugging-port=9222
```

## Element Interaction Issues

### "Element not found"

**Cause:** The CSS selector doesn't match any element.

**Solutions:**

1. **Use snapshot first** to see what elements exist:
   ```bash
   cdp snapshot | grep -i button
   cdp snapshot | grep -i input
   ```

2. **Check the selector syntax:**
   ```bash
   # Wrong
   cdp click "button.submit"  # Class might not exist
   
   # Right - use attributes
   cdp click "button[type=submit]"
   ```

3. **Element might be in an iframe:**
   - CDP commands only work on the main frame
   - Use `eval` to access iframe content

4. **Page might not be fully loaded:**
   ```bash
   cdp navigate "https://example.com"
   cdp wait 2000  # Wait for dynamic content
   cdp waitfor ".dynamic-element"
   ```

### "Element has no size"

**Cause:** Element exists but is hidden (display:none, visibility:hidden, or bosun dimensions).

**Solutions:**
1. The element might be in a collapsed menu - expand it first
2. Scroll to reveal lazy-loaded content
3. Use `eval` to check element visibility:
   ```bash
   cdp eval "getComputedStyle(document.querySelector('.element')).display"
   ```

### Click doesn't work

**Possible causes:**
1. Element covered by another element (modal, overlay)
2. Element needs hover first
3. JavaScript prevents default click

**Solutions:**
```bash
# Try clicking via JavaScript instead
cdp eval "document.querySelector('button').click()"

# Close any modals first
cdp click ".modal-close"
cdp wait 500
cdp click "button.submit"

# Scroll element into center of viewport
cdp eval "document.querySelector('button').scrollIntoView({block: 'center'})"
cdp click "button"
```

### Fill doesn't trigger validation

**Cause:** Some forms need actual keystrokes, not just value changes.

**Solution:** Use `type` instead of `fill`:
```bash
# fill - sets value instantly
cdp fill "input[name=email]" "test@example.com"

# type - simulates keystrokes
cdp type "input[name=email]" "test@example.com"
```

## Screenshot Issues

### Screenshots saved to wrong location

**Cause:** Using `/tmp/` which is isolated in the sandbox.

**Solution:** Always use `workspace/temp/`:
```bash
# Wrong (in sandbox, /tmp is isolated)
cdp screenshot /tmp/shot.png

# Right
cdp screenshot workspace/temp/shot.png
```

### Screenshot is blank or partial

**Cause:** Page not fully rendered.

**Solution:**
```bash
cdp navigate "https://example.com"
cdp wait 2000  # Wait for render
cdp screenshot workspace/temp/shot.png
```

## Timeout Issues

### "CDP command timeout"

**Cause:** Command took longer than `CDP_TIMEOUT` (default 30 seconds).

**Solutions:**

1. **Increase timeout:**
   ```bash
   CDP_TIMEOUT=60000 cdp navigate "https://slow-site.com"
   ```

2. **Break into smaller steps:**
   ```bash
   cdp navigate "https://example.com"
   cdp waitfor ".content"  # Wait for specific element
   cdp click "button"
   ```

### "Timeout waiting for element"

**Cause:** Element never appeared within the timeout.

**Solutions:**
1. Increase waitfor timeout:
   ```bash
   cdp waitfor ".slow-element" 30000
   ```

2. Check if selector is correct:
   ```bash
   cdp snapshot | grep -i "slow"
   ```

3. Element might require user action (login, captcha)

## Page-Specific Issues

### Single Page Applications (SPAs)

SPAs don't trigger full page loads. After clicking navigation:
```bash
cdp click "a[href='/dashboard']"
cdp wait 1000  # Wait for route change
cdp waitfor ".dashboard-content"
```

### Sites with anti-bot protection

Some sites detect automation. Workarounds:
1. Use a real user profile with cookies
2. Add realistic delays between actions
3. Use `type` instead of `fill` for natural input

### Login-protected pages

1. Navigate to login page
2. Fill credentials
3. Click submit
4. Wait for redirect
5. Continue automation

```bash
cdp navigate "https://example.com/login"
cdp fill "input[name=username]" "user"
cdp fill "input[name=password]" "pass"
cdp click "button[type=submit]"
cdp waitfor ".dashboard"  # Wait for post-login page
```

## Debugging Tips

### Get verbose output

```bash
# Use JSON output for debugging
cdp --json info
cdp --json click "button"
```

### Check what the page looks like

```bash
cdp screenshot workspace/temp/debug.png
# Then view the screenshot
```

### Inspect the DOM

```bash
# Get full accessibility tree
cdp snapshot > workspace/temp/page-tree.txt

# Get specific element info
cdp eval "document.querySelector('button').outerHTML"
```

### Check browser console for errors

```bash
cdp eval "console.log('test')"  # Won't show, but checks JS works
```

## Zero Sandbox Specific

### Network works but files don't persist

The sandbox has separate `/tmp`. Use:
- `workspace/temp/` for output files
- `.pi/temp/` as alternative

### Can't start Chrome from inside sandbox

Chrome must run on the HOST, not inside the sandbox:
1. Open a regular terminal (not inside zero)
2. Start Chrome with debugging
3. Enter bosun sandbox
4. Use CDP commands

## Best Practices

### 1. Use native commands instead of evaluate

**Problem:** Complex JS in evaluate is unreliable, often fails with "Uncaught"

```bash
# BAD - complex JS in evaluate often fails
cdp eval "document.querySelector('.btn').click()"

# GOOD - use native click with CSS selector
cdp click "button.submit"
```

### 2. Don't pause after screenshots

**Problem:** Agent stops and waits for user input unnecessarily

```bash
# GOOD - take screenshot, analyze result, proceed to next action
cdp screenshot workspace/temp/result.png
cdp click ".next-button"  # Continue immediately
```

### 3. Use waitfor for dynamic content

**Problem:** Elements may not exist yet when trying to interact

```bash
# BAD - element may not exist yet
cdp click ".dynamic-element"

# GOOD - wait for element first
cdp waitfor ".dynamic-element"
cdp click ".dynamic-element"
```

### 4. Always use snapshot first

**Problem:** Guessing selectors instead of discovering what exists

```bash
# GOOD workflow: snapshot → waitfor → interact → verify
cdp snapshot           # See what elements exist
cdp waitfor ".target"
cdp click ".target"
cdp screenshot workspace/temp/result.png  # Verify, then continue
```

## Complex Flow Pattern

For multi-step browser automation, chain commands:

```bash
CDP=".pi/skills/cdp-browser/scripts/cdp"

# Chain commands
$CDP navigate "https://example.com" && \
$CDP waitfor ".loaded" && \
$CDP snapshot > workspace/temp/elements.txt && \
$CDP click "button.submit" && \
$CDP screenshot workspace/temp/result.png
```
