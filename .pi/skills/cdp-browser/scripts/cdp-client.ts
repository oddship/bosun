/**
 * cdp-client — CDP browser automation library for Bun
 *
 * Zero dependencies. Uses Bun's native WebSocket + fetch.
 *
 * Usage:
 *   import { connect, devices } from "./cdp-client";
 *
 *   const browser = await connect();  // localhost:9222
 *   await browser.navigate("https://example.com");
 *   await browser.screenshot("shot.png");
 *   await browser.resize(375, 812);
 *   await browser.screenshot("mobile.png");
 *   browser.close();
 *
 * Or use the `run` helper for auto-cleanup:
 *   import { run } from "./cdp-client";
 *   await run(async (b) => {
 *     await b.navigate("https://example.com");
 *     console.log(await b.title());
 *   });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectOptions {
  host?: string;
  port?: number;
  timeout?: number;
  /** Select tab by id prefix or title substring */
  tab?: string;
}

export interface DevicePreset {
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
  ua?: string;
}

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp?: number;
  source?: string | null;
  stackTrace?: string;
}

export interface NetworkRequest {
  url: string;
  method: string;
  type?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  timestamp?: number;
}

export interface ScreenshotOptions {
  /** Full page (scroll entire document). Default: false (viewport only) */
  fullPage?: boolean;
  /** Image format. Default: "png" */
  format?: "png" | "jpeg" | "webp";
  /** JPEG/WebP quality 0-100 */
  quality?: number;
  /** Clip region { x, y, width, height } */
  clip?: { x: number; y: number; width: number; height: number };
}

export interface AXNode {
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  focused?: boolean;
  children: AXNode[];
}

// ---------------------------------------------------------------------------
// Device presets
// ---------------------------------------------------------------------------

export const devices: Record<string, DevicePreset> = {
  "iphone-se": { width: 375, height: 667, dpr: 2, mobile: true },
  "iphone-14": { width: 390, height: 844, dpr: 3, mobile: true },
  "iphone-14-pro-max": { width: 430, height: 932, dpr: 3, mobile: true },
  "pixel-7": { width: 412, height: 915, dpr: 2.625, mobile: true },
  "ipad": { width: 768, height: 1024, dpr: 2, mobile: true },
  "ipad-pro": { width: 1024, height: 1366, dpr: 2, mobile: true },
  "laptop": { width: 1366, height: 768, dpr: 1, mobile: false },
  "desktop": { width: 1920, height: 1080, dpr: 1, mobile: false },
  "desktop-hd": { width: 2560, height: 1440, dpr: 1, mobile: false },
};

// ---------------------------------------------------------------------------
// Core CDP connection
// ---------------------------------------------------------------------------

interface CDPTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

async function discoverTargets(
  host: string,
  port: number,
  tab?: string
): Promise<CDPTarget> {
  let pages: CDPTarget[];
  try {
    pages = await fetch(`http://${host}:${port}/json`).then((r) => r.json());
  } catch (e: any) {
    throw new Error(
      `Cannot connect to Chrome at ${host}:${port}. ` +
        `Is it running with --remote-debugging-port=${port}?`
    );
  }

  if (!pages.length) throw new Error("No browser tabs found.");

  let page: CDPTarget | undefined;
  if (tab) {
    page = pages.find(
      (p) =>
        p.id === tab ||
        p.id.startsWith(tab) ||
        p.title?.toLowerCase().includes(tab.toLowerCase())
    );
    if (!page) throw new Error(`Tab not found: "${tab}"`);
  } else {
    page =
      pages.find(
        (p) => p.type === "page" && !p.url.startsWith("chrome-extension://")
      ) ?? pages[0];
  }

  if (!page.webSocketDebuggerUrl)
    throw new Error("Page has no WebSocket URL — may be a special page.");
  return page;
}

// ---------------------------------------------------------------------------
// Browser class — the main API
// ---------------------------------------------------------------------------

export class Browser {
  private ws: WebSocket;
  private msgId = 0;
  private timeout: number;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private eventHandlers: ((method: string, params: any) => void)[] = [];
  private _closed = false;

  private constructor(ws: WebSocket, timeout: number) {
    this.ws = ws;
    this.timeout = timeout;

    this.ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
      if (msg.method) {
        for (const h of this.eventHandlers) h(msg.method, msg.params);
      }
    };
  }

  /** Connect to a running Chrome instance via CDP. */
  static async connect(opts: ConnectOptions = {}): Promise<Browser> {
    const host = opts.host ?? process.env.CDP_HOST ?? "localhost";
    const port = opts.port ?? Number(process.env.CDP_PORT ?? 9222);
    const timeout = opts.timeout ?? Number(process.env.CDP_TIMEOUT ?? 30_000);

    const target = await discoverTargets(host, port, opts.tab);
    const ws = new WebSocket(target.webSocketDebuggerUrl!);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("WebSocket connect timeout")),
        timeout
      );
      ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      ws.onerror = (e: any) => {
        clearTimeout(t);
        reject(new Error(e.message ?? "WebSocket error"));
      };
    });

    return new Browser(ws, timeout);
  }

  /** Send a raw CDP method call. */
  send(method: string, params: Record<string, any> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this._closed) return reject(new Error("Connection closed"));
      const id = ++this.msgId;
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, this.timeout);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Listen for CDP events (e.g. Runtime.consoleAPICalled). */
  on(handler: (method: string, params: any) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  /** Close the WebSocket connection. */
  close(): void {
    this._closed = true;
    this.ws.close();
  }

  get closed(): boolean {
    return this._closed;
  }

  // -----------------------------------------------------------------------
  // Evaluate
  // -----------------------------------------------------------------------

  /** Evaluate JavaScript in the page context and return the result. */
  async eval<T = any>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "JS evaluation error"
      );
    }
    return result.result?.value;
  }

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  /** Navigate to a URL and wait for the page to load. */
  async navigate(url: string): Promise<void> {
    if (!url.startsWith("http://") && !url.startsWith("https://"))
      url = "https://" + url;

    await this.send("Page.enable");
    const loaded = new Promise<void>((resolve) => {
      const off = this.on((method) => {
        if (method === "Page.loadEventFired") {
          off();
          resolve();
        }
      });
      setTimeout(() => {
        off();
        resolve();
      }, 8000);
    });
    await this.send("Page.navigate", { url });
    await loaded;
  }

  /** Reload the current page. */
  async reload(): Promise<void> {
    await this.send("Page.enable");
    const loaded = new Promise<void>((resolve) => {
      const off = this.on((method) => {
        if (method === "Page.loadEventFired") {
          off();
          resolve();
        }
      });
      setTimeout(() => {
        off();
        resolve();
      }, 8000);
    });
    await this.send("Page.reload");
    await loaded;
  }

  /** Get the current page URL. */
  async url(): Promise<string> {
    return this.eval("location.href");
  }

  /** Get the current page title. */
  async title(): Promise<string> {
    return this.eval("document.title");
  }

  // -----------------------------------------------------------------------
  // Screenshots
  // -----------------------------------------------------------------------

  /**
   * Take a screenshot and save to disk.
   * Returns the file path written.
   */
  async screenshot(
    path: string = "workspace/scratch/screenshot.png",
    opts: ScreenshotOptions = {}
  ): Promise<string> {
    // Ensure parent directory exists
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir) Bun.spawnSync(["mkdir", "-p", dir]);

    if (opts.fullPage) {
      const metrics = await this.eval(`({
        width: Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth),
        height: Math.max(document.documentElement.scrollHeight, document.documentElement.clientHeight),
        dpr: window.devicePixelRatio
      })`);

      await this.send("Emulation.setDeviceMetricsOverride", {
        width: metrics.width,
        height: metrics.height,
        deviceScaleFactor: metrics.dpr,
        mobile: false,
      });
      await Bun.sleep(200);
    }

    const params: Record<string, any> = {
      format: opts.format ?? "png",
      captureBeyondViewport: false,
    };
    if (opts.quality != null) params.quality = opts.quality;
    if (opts.clip) {
      params.clip = { ...opts.clip, scale: 1 };
    }

    const result = await this.send("Page.captureScreenshot", params);

    if (opts.fullPage) {
      await this.send("Emulation.clearDeviceMetricsOverride");
    }

    await Bun.write(path, Buffer.from(result.data, "base64"));
    return path;
  }

  // -----------------------------------------------------------------------
  // Viewport & emulation
  // -----------------------------------------------------------------------

  /** Set the viewport size. Mobile emulation auto-enables for width ≤ 768. */
  async resize(width: number, height: number, dpr = 1): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile: width <= 768,
    });
    await Bun.sleep(200);
  }

  /** Emulate a named device preset. See `devices` export. */
  async emulate(deviceName: string): Promise<DevicePreset> {
    const preset = devices[deviceName.toLowerCase()];
    if (!preset) {
      throw new Error(
        `Unknown device: ${deviceName}. Available: ${Object.keys(devices).join(", ")}`
      );
    }
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: preset.width,
      height: preset.height,
      deviceScaleFactor: preset.dpr,
      mobile: preset.mobile,
    });
    if (preset.ua) {
      await this.send("Emulation.setUserAgentOverride", {
        userAgent: preset.ua,
      });
    }
    await Bun.sleep(200);
    return preset;
  }

  /** Reset viewport to browser defaults. */
  async resetViewport(): Promise<void> {
    await this.send("Emulation.clearDeviceMetricsOverride");
  }

  /** Get current viewport dimensions. */
  async viewport(): Promise<{ width: number; height: number; dpr: number }> {
    return this.eval(
      `({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })`
    );
  }

  // -----------------------------------------------------------------------
  // Element interaction
  // -----------------------------------------------------------------------

  /** Click an element by CSS selector. Scrolls into view first. */
  async click(selector: string): Promise<void> {
    const pos = await this.elementCenter(selector);
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: pos.x,
      y: pos.y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: pos.x,
      y: pos.y,
      button: "left",
      clickCount: 1,
    });
  }

  /** Set an input's value instantly. Fires input + change events. */
  async fill(selector: string, value: string): Promise<void> {
    const res = await this.eval(`(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: 'Element not found' };
      if (!('value' in el)) return { error: 'Not an input' };
      el.focus();
      el.value = '';
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`);
    if (res?.error) throw new Error(`${res.error}: ${selector}`);
  }

  /** Type text character by character (for autocomplete, live validation). */
  async type(selector: string, text: string): Promise<void> {
    await this.eval(
      `document.querySelector(${JSON.stringify(selector)})?.focus()`
    );
    for (const char of text) {
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", text: char });
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", text: char });
    }
  }

  /** Press a key (e.g. "Enter", "Escape", "Tab", "ArrowDown"). */
  async press(key: string): Promise<void> {
    // Map common key names to CDP key codes
    const keyMap: Record<string, number> = {
      Enter: 13,
      Escape: 27,
      Tab: 9,
      Backspace: 8,
      Delete: 46,
      ArrowUp: 38,
      ArrowDown: 40,
      ArrowLeft: 37,
      ArrowRight: 39,
    };
    const code = keyMap[key] ?? 0;
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    });
  }

  // -----------------------------------------------------------------------
  // Waiting
  // -----------------------------------------------------------------------

  /** Wait for an element to appear in the DOM. */
  async waitFor(selector: string, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this.eval(
        `!!document.querySelector(${JSON.stringify(selector)})`
      );
      if (found) return;
      await Bun.sleep(200);
    }
    throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${selector}`);
  }

  /** Sleep for the given milliseconds. */
  async sleep(ms: number): Promise<void> {
    await Bun.sleep(ms);
  }

  // -----------------------------------------------------------------------
  // Content extraction
  // -----------------------------------------------------------------------

  /** Get outerHTML of an element (or the entire page if no selector). */
  async html(selector?: string): Promise<string> {
    const expr = selector
      ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML ?? null`
      : `document.documentElement.outerHTML`;
    const val = await this.eval(expr);
    if (selector && val == null)
      throw new Error(`Element not found: ${selector}`);
    return val;
  }

  /** Get innerText of an element. */
  async text(selector: string): Promise<string> {
    const val = await this.eval(
      `document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`
    );
    if (val == null)
      throw new Error(`Element not found or empty: ${selector}`);
    return val;
  }

  /** Check whether an element exists. */
  async exists(selector: string): Promise<boolean> {
    return this.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
  }

  /** Count matching elements. */
  async count(selector: string): Promise<number> {
    return this.eval(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`
    );
  }

  /** Get a CSS property's computed value. */
  async css(selector: string, property: string): Promise<string> {
    const val = await this.eval(
      `(function(){
        var el = document.querySelector(${JSON.stringify(selector)});
        return el ? getComputedStyle(el).getPropertyValue(${JSON.stringify(property)}) : null;
      })()`
    );
    if (val == null) throw new Error(`Element not found: ${selector}`);
    return val;
  }

  /** Get element bounding rect. */
  async rect(
    selector: string
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const val = await this.eval(
      `(function(){
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()`
    );
    if (!val) throw new Error(`Element not found: ${selector}`);
    return val;
  }

  // -----------------------------------------------------------------------
  // Accessibility
  // -----------------------------------------------------------------------

  /** Get the accessibility tree as a structured object. */
  async accessibilityTree(): Promise<AXNode> {
    const result = await this.send("Accessibility.getFullAXTree");
    if (!result.nodes?.length) return { role: "none", name: "", children: [] };

    const map = new Map<string, any>();
    for (const n of result.nodes) map.set(n.nodeId, n);

    function convert(raw: any): AXNode {
      const node: AXNode = {
        role: raw.role?.value ?? "unknown",
        name: raw.name?.value ?? "",
        children: [],
      };
      if (raw.value?.value) node.value = raw.value.value;
      if (raw.checked?.value) node.checked = true;
      if (raw.disabled?.value) node.disabled = true;
      if (raw.focused?.value) node.focused = true;
      if (raw.childIds) {
        node.children = raw.childIds
          .map((id: string) => map.get(id))
          .filter(Boolean)
          .map(convert);
      }
      return node;
    }

    return convert(result.nodes[0]);
  }

  /**
   * Get a flat text representation of the accessibility tree.
   * Useful for quick inspection.
   */
  async accessibilitySnapshot(): Promise<string> {
    const tree = await this.accessibilityTree();
    const lines: string[] = [];
    function walk(node: AXNode, depth = 0) {
      const indent = "  ".repeat(depth);
      const props: string[] = [];
      if (node.value) props.push(`value="${node.value}"`);
      if (node.checked) props.push("[checked]");
      if (node.disabled) props.push("[disabled]");
      if (node.focused) props.push("[focused]");

      let line = `${indent}- ${node.role}`;
      if (node.name) line += ` "${node.name.slice(0, 60)}"`;
      if (props.length) line += ` ${props.join(" ")}`;
      lines.push(line);
      for (const c of node.children) walk(c, depth + 1);
    }
    walk(tree);
    return lines.join("\n");
  }

  // -----------------------------------------------------------------------
  // Debugging: console, errors, network
  // -----------------------------------------------------------------------

  /** Collect console messages for a duration. */
  async console(durationMs = 3000): Promise<ConsoleMessage[]> {
    const messages: ConsoleMessage[] = [];
    const off = this.on((method, params) => {
      if (method === "Runtime.consoleAPICalled") {
        messages.push({
          type: params.type,
          text: params.args
            .map((a: any) => a.value ?? a.description ?? JSON.stringify(a))
            .join(" "),
          timestamp: params.timestamp,
          source: params.stackTrace?.callFrames?.[0]
            ? `${params.stackTrace.callFrames[0].url}:${params.stackTrace.callFrames[0].lineNumber}`
            : null,
        });
      }
      if (method === "Runtime.exceptionThrown") {
        const d = params.exceptionDetails;
        messages.push({
          type: "error",
          text: d.exception?.description ?? d.text ?? "Unknown error",
          timestamp: params.timestamp,
          source: d.url ? `${d.url}:${d.lineNumber}` : null,
          stackTrace: d.stackTrace?.callFrames
            ?.map(
              (f: any) =>
                `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber}:${f.columnNumber})`
            )
            .join("\n"),
        });
      }
    });
    await this.send("Runtime.enable");
    await Bun.sleep(durationMs);
    off();
    return messages;
  }

  /** Collect only error messages for a duration. */
  async errors(durationMs = 2000): Promise<ConsoleMessage[]> {
    const all = await this.console(durationMs);
    return all.filter((m) => m.type === "error");
  }

  /** Monitor network requests for a duration. */
  async network(durationMs = 5000): Promise<NetworkRequest[]> {
    const requests = new Map<string, NetworkRequest>();
    const off = this.on((method, params) => {
      if (method === "Network.requestWillBeSent") {
        requests.set(params.requestId, {
          url: params.request.url,
          method: params.request.method,
          type: params.type,
          timestamp: params.timestamp,
        });
      }
      if (method === "Network.responseReceived") {
        const req = requests.get(params.requestId);
        if (req) {
          req.status = params.response.status;
          req.statusText = params.response.statusText;
          req.mimeType = params.response.mimeType;
        }
      }
    });
    await this.send("Network.enable");
    await Bun.sleep(durationMs);
    off();
    return [...requests.values()].filter((r) => r.status != null);
  }

  // -----------------------------------------------------------------------
  // Batch helpers
  // -----------------------------------------------------------------------

  /**
   * Screenshot a page at multiple viewports.
   * Returns array of file paths written.
   *
   * Example:
   *   await browser.screenshotViewports("https://example.com", "workspace/scratch", {
   *     mobile: { width: 375, height: 812 },
   *     tablet: { width: 768, height: 1024 },
   *     desktop: { width: 1440, height: 900 },
   *   });
   *   // writes: workspace/scratch/mobile.png, tablet.png, desktop.png
   */
  async screenshotViewports(
    url: string,
    outDir: string,
    viewports: Record<string, { width: number; height: number; dpr?: number }>,
    opts: Omit<ScreenshotOptions, "clip"> = {}
  ): Promise<string[]> {
    await this.navigate(url);
    const paths: string[] = [];

    for (const [name, vp] of Object.entries(viewports)) {
      await this.resize(vp.width, vp.height, vp.dpr ?? 1);
      const p = `${outDir}/${name}.png`;
      await this.screenshot(p, opts);
      paths.push(p);
    }

    await this.resetViewport();
    return paths;
  }

  /**
   * Check for horizontal overflow at the current viewport.
   * Returns outermost elements that extend beyond the viewport width.
   * Children of an already-overflowing element are excluded to reduce noise.
   */
  async checkOverflow(): Promise<
    { selector: string; overflow: number }[]
  > {
    return this.eval(`(function() {
      var vw = document.documentElement.clientWidth;
      var overflowing = [];
      document.querySelectorAll('*').forEach(function(el) {
        var r = el.getBoundingClientRect();
        if (r.right > vw + 1) overflowing.push(el);
      });
      // Filter to outermost: skip elements whose parent is also in the list
      var set = new Set(overflowing);
      var roots = overflowing.filter(function(el) {
        var p = el.parentElement;
        while (p) { if (set.has(p)) return false; p = p.parentElement; }
        return true;
      });
      return roots.map(function(el) {
        var r = el.getBoundingClientRect();
        var path = [];
        var node = el;
        while (node && node !== document.body) {
          var tag = node.tagName.toLowerCase();
          if (node.id) { path.unshift(tag + '#' + node.id); break; }
          else if (node.className && typeof node.className === 'string') {
            path.unshift(tag + '.' + node.className.trim().split(/\\s+/).join('.'));
          } else {
            path.unshift(tag);
          }
          node = node.parentElement;
        }
        return { selector: path.join(' > '), overflow: Math.round(r.right - vw) };
      });
    })()`);
  }

  /**
   * Collect all elements with inline style attributes.
   * Useful for enforcing "no inline styles" policies.
   */
  async findInlineStyles(): Promise<{ selector: string; style: string }[]> {
    return this.eval(`(function() {
      var results = [];
      document.querySelectorAll('[style]').forEach(function(el) {
        var tag = el.tagName.toLowerCase();
        var id = el.id ? '#' + el.id : '';
        var cls = el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
        results.push({
          selector: tag + id + cls,
          style: el.getAttribute('style')
        });
      });
      return results;
    })()`);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async elementCenter(
    selector: string
  ): Promise<{ x: number; y: number }> {
    await this.eval(
      `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`
    );
    await Bun.sleep(100);
    const pos = await this.eval(`(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { error: 'Element has no size' };
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    })()`);
    if (!pos) throw new Error(`Element not found: ${selector}`);
    if (pos.error) throw new Error(`${pos.error}: ${selector}`);
    return pos;
  }
}

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

/** Connect to Chrome/Chromium via CDP. Shorthand for Browser.connect(). */
export function connect(opts?: ConnectOptions): Promise<Browser> {
  return Browser.connect(opts);
}

/** Connect, run a function, then close. */
export async function run<T>(
  fn: (browser: Browser) => Promise<T>,
  opts?: ConnectOptions
): Promise<T> {
  const browser = await connect(opts);
  try {
    return await fn(browser);
  } finally {
    browser.close();
  }
}
