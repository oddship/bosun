# CDP Scripting Reference

The `cdp-client` library lets agents write browser automation scripts in TypeScript that run under Bun. Use it for custom workflows beyond what the built-in `visual-review.ts` script covers.

## When to Use

**Use `visual-review.ts` first** — it handles the common case (multi-page, multi-viewport screenshots + audits) with zero code. Only write a custom script when you need something specific like:
- Interacting with forms or dialogs
- Testing a specific user flow (search, navigation, login)
- Checking behavior after JS interactions
- Custom assertions not covered by the built-in audits

## Import

```typescript
// From workspace/scratch/ (the standard place for agent scripts)
import { connect, run, devices } from "../../.pi/skills/cdp-browser/scripts/cdp-client";
```

Save scripts to `workspace/scratch/` and run with `bun workspace/scratch/my-script.ts`.

## Quick Start

### Auto-managed connection

```typescript
import { run } from "../../.pi/skills/cdp-browser/scripts/cdp-client";

await run(async (b) => {
  await b.navigate("http://localhost:8080");
  console.log(await b.title());
  await b.screenshot("workspace/scratch/shot.png");
});
// Connection auto-closes when the function returns.
```

### Manual connection

```typescript
import { connect } from "../../.pi/skills/cdp-browser/scripts/cdp-client";

const browser = await connect();
await browser.navigate("http://localhost:8080");
await browser.screenshot("workspace/scratch/shot.png");
browser.close();
```

### Connection options

```typescript
const browser = await connect({
  host: "localhost",    // default
  port: 9222,           // default
  timeout: 30_000,      // per-command timeout in ms
  tab: "my-app",        // select tab by title substring
});
```

## API Reference

### Navigation

```typescript
await b.navigate("http://localhost:3000");  // waits for load event
await b.reload();
const url = await b.url();
const title = await b.title();
```

### Screenshots

```typescript
// Viewport only
await b.screenshot("viewport.png");

// Full page (entire scrollable area)
await b.screenshot("fullpage.png", { fullPage: true });

// With format/quality
await b.screenshot("page.webp", { format: "webp", quality: 80 });

// Clip a region
await b.screenshot("header.png", { clip: { x: 0, y: 0, width: 1200, height: 100 } });
```

### Viewport & Device Emulation

```typescript
// Set exact dimensions (mobile auto-detected for width ≤ 768)
await b.resize(375, 812);
await b.resize(1440, 900, 2);  // with 2x device pixel ratio

// Emulate a named device preset
await b.emulate("iphone-14");
await b.emulate("ipad");
await b.emulate("laptop");

// Reset to browser defaults
await b.resetViewport();

// Get current viewport
const vp = await b.viewport();  // { width, height, dpr }
```

Available device presets: `iphone-se`, `iphone-14`, `iphone-14-pro-max`, `pixel-7`, `ipad`, `ipad-pro`, `laptop`, `desktop`, `desktop-hd`.

### Element Interaction

```typescript
await b.click("button[type=submit]");
await b.fill("input[name=email]", "test@example.com");
await b.type("input[name=search]", "hello");  // character by character
await b.press("Enter");
await b.press("Escape");
```

### Waiting

```typescript
await b.waitFor(".results", 5000);  // wait up to 5s for element
await b.sleep(1000);                // sleep 1 second
```

### Content Extraction

```typescript
const html = await b.html("main");           // outerHTML of element
const text = await b.text("h1");             // innerText
const exists = await b.exists(".sidebar");   // boolean
const count = await b.count("li.nav-item");  // number
const bg = await b.css("body", "background-color");  // computed style
const rect = await b.rect(".header");        // { x, y, width, height }
```

### JavaScript Evaluation

```typescript
const title = await b.eval<string>("document.title");
const count = await b.eval<number>("document.querySelectorAll('a').length");
await b.eval("window.scrollTo(0, document.body.scrollHeight)");
```

### Accessibility

```typescript
// Structured tree
const tree = await b.accessibilityTree();
// tree.role, tree.name, tree.children[0].role, etc.

// Flat text (for logging/inspection)
const snapshot = await b.accessibilitySnapshot();
console.log(snapshot);
// - RootWebArea "My Page"
//   - heading "Title"
//   - button "Submit"
```

### Debugging

```typescript
// Collect console messages for 3 seconds
const msgs = await b.console(3000);
for (const m of msgs) console.log(m.type, m.text);

// Errors only (2 seconds)
const errs = await b.errors();

// Network requests (5 seconds)
const reqs = await b.network(5000);
for (const r of reqs) console.log(r.method, r.status, r.url);
```

### Audit Helpers

```typescript
// Check for horizontal overflow at current viewport
const overflows = await b.checkOverflow();
// [{ selector: "pre > code", overflow: 40 }]

// Find inline style= attributes
const styles = await b.findInlineStyles();
// [{ selector: "div.hero", style: "margin-top: 20px" }]
```

### Batch Operations

```typescript
// Screenshot one URL at multiple viewports
const paths = await b.screenshotViewports(
  "http://localhost:8080/guide/config/",
  "workspace/scratch/config-page",
  {
    mobile: { width: 375, height: 812 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1440, height: 900 },
  }
);
// ["workspace/scratch/config-page/mobile.png", "tablet.png", "desktop.png"]
```

### Raw CDP Commands

```typescript
// Send any CDP protocol method directly
const result = await b.send("DOM.getDocument", { depth: 2 });

// Listen for CDP events
const off = b.on((method, params) => {
  if (method === "Page.loadEventFired") console.log("Page loaded!");
});
// later: off() to unsubscribe
```

## Recipe: Visual Review Script

A full visual review of a site at multiple pages and viewports:

```typescript
import { run } from "../../.pi/skills/cdp-browser/scripts/cdp-client";

const BASE = "http://localhost:8080";
const PAGES = ["/", "/guide/config/", "/reference/cli/"];
const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

await run(async (b) => {
  const issues: string[] = [];

  for (const page of PAGES) {
    const slug = page === "/" ? "home" : page.replace(/\//g, "-").replace(/^-|-$/g, "");

    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await b.navigate(BASE + page);
      await b.resize(vp.width, vp.height);

      // Screenshot
      await b.screenshot(`workspace/scratch/review/${slug}-${vpName}.png`);

      // Check overflow
      const overflows = await b.checkOverflow();
      if (overflows.length) {
        issues.push(`${page} @ ${vpName}: ${overflows.length} overflow(s)`);
        for (const o of overflows.slice(0, 3))
          issues.push(`  ${o.selector} → ${o.overflow}px`);
      }

      // Check inline styles
      const styles = await b.findInlineStyles();
      if (styles.length > 1) {  // 1 is OK (html color-scheme)
        issues.push(`${page} @ ${vpName}: ${styles.length} inline style(s)`);
      }
    }
  }

  // Check for console errors
  await b.navigate(BASE);
  const errs = await b.errors();
  if (errs.length) {
    issues.push(`Console errors: ${errs.length}`);
    for (const e of errs) issues.push(`  ${e.text}`);
  }

  // Report
  console.log("\n=== Visual Review Report ===");
  if (issues.length) {
    console.log(`\n${issues.length} issue(s) found:\n`);
    for (const i of issues) console.log(i);
  } else {
    console.log("\n✓ No issues found.");
  }
});
```

## Recipe: Responsive Regression Check

Compare viewport behavior before and after changes:

```typescript
import { run, devices } from "../../.pi/skills/cdp-browser/scripts/cdp-client";

await run(async (b) => {
  await b.navigate("http://localhost:8080");

  // Check sidebar collapses on mobile
  await b.emulate("iphone-14");
  const sidebarVisible = await b.eval(
    `getComputedStyle(document.querySelector('aside[data-sidebar]')).display !== 'none'`
  );
  console.log("Sidebar on mobile:", sidebarVisible ? "VISIBLE (bug?)" : "hidden ✓");

  // Check dialog works at all viewports
  for (const device of ["iphone-se", "ipad", "desktop"]) {
    await b.emulate(device);
    await b.click('button[aria-label="Search"]');
    await b.sleep(300);
    const dialogOpen = await b.eval(`document.querySelector('#search-dialog')?.open ?? false`);
    console.log(`Search dialog on ${device}:`, dialogOpen ? "opens ✓" : "BROKEN");
    await b.press("Escape");
    await b.sleep(200);
  }
});
```

## Running Scripts

```bash
bun workspace/scratch/my-review.ts
```

Scripts run with full Bun TypeScript support — no compilation step, no config.
