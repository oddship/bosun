#!/usr/bin/env bun
/**
 * CDP CLI — thin wrapper over cdp-client library.
 * Zero dependencies. Bun native.
 *
 * Usage: cdp <command> [args] [--json] [--tab=<id|title>|--target=<id>]
 */

import { connect, createWindowTarget, devices, type Browser } from "./cdp-client";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

let jsonOutput = false;
let tabSelector: string | undefined;
let targetSelector: string | undefined;

const args = process.argv.slice(2).filter((arg) => {
  if (arg === "--json") { jsonOutput = true; return false; }
  if (arg.startsWith("--tab=")) { tabSelector = arg.slice(6); return false; }
  if (arg.startsWith("--target=")) { targetSelector = arg.slice(9); return false; }
  return true;
});

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function out(data: unknown): void {
  if (typeof data === "string" && !jsonOutput) console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

function die(msg: string): never {
  if (jsonOutput) console.log(JSON.stringify({ error: msg }));
  else console.error(`Error: ${msg}`);
  process.exit(1);
}

if (tabSelector && targetSelector) {
  die("Use either --tab=<id|title> or --target=<id>, not both.");
}

/** Run a command with auto-connect/close. */
async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  const b = await connect({ tab: tabSelector, targetId: targetSelector });
  try { return await fn(b); }
  finally { b.close(); }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands: Record<string, (...a: string[]) => Promise<unknown>> = {

  // -- Tabs & info --

  async tabs() {
    // Direct HTTP call, no WS needed
    const host = process.env.CDP_HOST ?? "localhost";
    const port = process.env.CDP_PORT ?? "9222";
    const pages = await fetch(`http://${host}:${port}/json`).then(r => r.json());
    if (jsonOutput) return pages.map((p: any) => ({ id: p.id, title: p.title, url: p.url, type: p.type }));
    if (!pages.length) return "No tabs found";
    return pages.map((p: any, i: number) =>
      `${i}: ${p.id.slice(0, 8)} | ${(p.title ?? "").slice(0, 40).padEnd(40)} | ${p.url}`
    ).join("\n");
  },

  async newwindow(url?: string) {
    const target = await createWindowTarget({ url });
    return jsonOutput
      ? { success: true, targetId: target.targetId }
      : `Created window target: ${target.targetId}`;
  },

  async info() {
    return withBrowser(async (b) => ({
      title: await b.title(),
      url: await b.url(),
    }));
  },

  // -- Navigation --

  async navigate(url?: string) {
    if (!url) throw new Error("Usage: cdp navigate <url>");
    return withBrowser(async (b) => {
      await b.navigate(url);
      return jsonOutput ? { success: true, url } : `Navigated to: ${url}`;
    });
  },

  // -- Screenshots --

  async screenshot(path?: string) {
    return withBrowser(async (b) => {
      const p = await b.screenshot(path);
      return jsonOutput ? { success: true, path: p } : `Screenshot saved: ${p}`;
    });
  },

  async fullscreenshot(path?: string) {
    return withBrowser(async (b) => {
      const p = await b.screenshot(path, { fullPage: true });
      return jsonOutput ? { success: true, path: p } : `Full-page screenshot saved: ${p}`;
    });
  },

  // -- Viewport --

  async resize(w?: string, h?: string) {
    if (!w || !h) throw new Error("Usage: cdp resize <width> <height>");
    const width = Number(w), height = Number(h);
    return withBrowser(async (b) => {
      await b.resize(width, height);
      return jsonOutput
        ? { success: true, width, height }
        : `Viewport set to ${width}×${height}${width <= 768 ? " (mobile)" : ""}`;
    });
  },

  async resetviewport() {
    return withBrowser(async (b) => {
      await b.resetViewport();
      return jsonOutput ? { success: true } : "Viewport reset to browser default";
    });
  },

  async device(name?: string) {
    if (!name) {
      const list = Object.keys(devices);
      return jsonOutput ? { devices: list } : `Available devices: ${list.join(", ")}`;
    }
    return withBrowser(async (b) => {
      const preset = await b.emulate(name);
      return jsonOutput
        ? { success: true, device: name, ...preset }
        : `Emulating: ${name} (${preset.width}×${preset.height}, ${preset.dpr}x)`;
    });
  },

  // -- Accessibility --

  async snapshot() {
    return withBrowser(async (b) => {
      if (jsonOutput) return b.accessibilityTree();
      return b.accessibilitySnapshot();
    });
  },

  // -- Interaction --

  async click(selector?: string) {
    if (!selector) throw new Error("Usage: cdp click <selector>");
    return withBrowser(async (b) => {
      await b.click(selector);
      return jsonOutput ? { success: true, selector } : `Clicked: ${selector}`;
    });
  },

  async fill(selector?: string, value?: string) {
    if (!selector || value === undefined) throw new Error("Usage: cdp fill <selector> <value>");
    return withBrowser(async (b) => {
      await b.fill(selector, value);
      return jsonOutput ? { success: true, selector, value } : `Filled: ${selector} = "${value}"`;
    });
  },

  async type(selector?: string, text?: string) {
    if (!selector || text === undefined) throw new Error("Usage: cdp type <selector> <text>");
    return withBrowser(async (b) => {
      await b.type(selector, text);
      return jsonOutput ? { success: true, selector, text } : `Typed "${text}" into ${selector}`;
    });
  },

  // -- JS eval --

  async eval(expression?: string) {
    if (!expression) throw new Error("Usage: cdp eval <expression>");
    return withBrowser(async (b) => b.eval(expression));
  },

  // -- Content --

  async html(selector?: string) {
    return withBrowser(async (b) => b.html(selector));
  },

  async text(selector?: string) {
    if (!selector) throw new Error("Usage: cdp text <selector>");
    return withBrowser(async (b) => b.text(selector));
  },

  // -- Waiting --

  async wait(ms?: string) {
    const d = Number(ms);
    if (!d || d < 0) throw new Error("Usage: cdp wait <ms>");
    await Bun.sleep(d);
    return jsonOutput ? { success: true, waited: d } : `Waited ${d}ms`;
  },

  async waitfor(selector?: string, timeout?: string) {
    if (!selector) throw new Error("Usage: cdp waitfor <selector> [timeout]");
    return withBrowser(async (b) => {
      await b.waitFor(selector, Number(timeout) || undefined);
      return jsonOutput ? { success: true, selector } : `Found: ${selector}`;
    });
  },

  // -- Debugging --

  async console(duration?: string) {
    return withBrowser(async (b) => {
      const msgs = await b.console(Number(duration) || undefined);
      if (jsonOutput) return { messages: msgs, count: msgs.length };
      if (!msgs.length) return "No console messages captured";
      return msgs.map(m => {
        const pfx = m.type === "error" ? "\x1b[31m[ERROR]\x1b[0m"
          : m.type === "warning" ? "\x1b[33m[WARN]\x1b[0m"
          : m.type === "info" ? "\x1b[36m[INFO]\x1b[0m"
          : "[LOG]";
        const src = m.source ? ` (${m.source})` : "";
        return `${pfx} ${m.text}${src}`;
      }).join("\n");
    });
  },

  async errors() {
    return withBrowser(async (b) => {
      const errs = await b.errors();
      if (jsonOutput) return { errors: errs, count: errs.length };
      if (!errs.length) return "No errors captured";
      return errs.map(e => {
        const stack = e.stackTrace ? "\n" + e.stackTrace : "";
        return `\x1b[31m[ERROR]\x1b[0m ${e.text}${stack}`;
      }).join("\n\n");
    });
  },

  async network(duration?: string) {
    return withBrowser(async (b) => {
      const reqs = await b.network(Number(duration) || undefined);
      if (jsonOutput) return { requests: reqs, count: reqs.length };
      if (!reqs.length) return "No network requests captured";
      return reqs.map(r => {
        const c = (r.status ?? 0) >= 400 ? "\x1b[31m"
          : (r.status ?? 0) >= 300 ? "\x1b[33m"
          : "\x1b[32m";
        return `${r.method} ${c}${r.status}\x1b[0m ${r.url.slice(0, 80)}`;
      }).join("\n");
    });
  },

  // -- Audit helpers --

  async overflow() {
    return withBrowser(async (b) => {
      const items = await b.checkOverflow();
      if (jsonOutput) return { overflows: items, count: items.length };
      if (!items.length) return "No horizontal overflow detected";
      return items.map(i => `${i.selector} → ${i.overflow}px overflow`).join("\n");
    });
  },

  async inlinestyles() {
    return withBrowser(async (b) => {
      const items = await b.findInlineStyles();
      if (jsonOutput) return { elements: items, count: items.length };
      if (!items.length) return "No inline style attributes found";
      return items.map(i => `${i.selector}: style="${i.style}"`).join("\n");
    });
  },
};

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = `\x1b[1mcdp\x1b[0m — Chrome DevTools Protocol CLI (Bun/TypeScript)

\x1b[1mUsage:\x1b[0m cdp <command> [args] [--json] [--tab=<id|title>|--target=<id>]

\x1b[1mNavigation\x1b[0m
  tabs                        List open browser tabs
  newwindow [url]             Create a new browser window target
  info                        Current page title and URL
  navigate <url>              Go to URL (waits for load)

\x1b[1mScreenshots\x1b[0m
  screenshot [path]           Viewport screenshot
  fullscreenshot [path]       Full-page screenshot

\x1b[1mViewport & Emulation\x1b[0m
  resize <w> <h>              Set viewport size
  resetviewport               Reset to browser defaults
  device [name]               Emulate device (no args = list presets)

\x1b[1mAccessibility\x1b[0m
  snapshot                    Full accessibility tree

\x1b[1mInteraction\x1b[0m
  click <selector>            Click element
  fill <selector> <value>     Set input value
  type <selector> <text>      Type character by character

\x1b[1mContent\x1b[0m
  eval <expression>           Run JavaScript
  html [selector]             Get HTML
  text <selector>             Get innerText

\x1b[1mWaiting\x1b[0m
  wait <ms>                   Sleep
  waitfor <selector> [ms]     Wait for element

\x1b[1mDebugging\x1b[0m
  console [ms]                Console messages (default 3s)
  errors                      Errors only (2s)
  network [ms]                Network requests (default 5s)

\x1b[1mAudit\x1b[0m
  overflow                    Check for horizontal overflow
  inlinestyles                Find elements with inline style=

\x1b[1mOptions\x1b[0m
  --json                      JSON output
  --tab=<id|title>            Target tab (id prefix or title)
  --target=<id>               Attach to exact target id

\x1b[1mLibrary usage:\x1b[0m
  import { connect, run, devices } from "./cdp-client";
  await run(async (b) => {
    await b.navigate("http://localhost:8080");
    await b.resize(375, 812);
    await b.screenshot("mobile.png");
  });

\x1b[1mPrerequisite:\x1b[0m chromium --remote-debugging-port=9222
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [cmd, ...rest] = args;
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
  process.exit(0);
}
if (!commands[cmd]) die(`Unknown command: ${cmd}. Run 'cdp help' for usage.`);

try {
  const result = await commands[cmd](...rest);
  if (result !== undefined) out(result);
} catch (e: any) {
  die(e.message);
}
