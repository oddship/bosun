#!/usr/bin/env bun
/**
 * CDP-Mesh Bridge Server
 *
 * Bridges browser annotations to pi-mesh agents via CDP protocol.
 *
 * Browser → Bridge: Runtime.addBinding("piAnnotate") → bindingCalled event
 * Bridge → Browser: Runtime.evaluate("window.__piAnnotatorResponse(...)")
 * Bridge → Agent:   Writes MeshMessage JSON to .pi/mesh/inbox/{agent}/
 * Agent → Bridge:   Writes to .pi/mesh/inbox/browser-bridge/ → fs.watch
 *
 * Usage:
 *   bun bridge-server.ts --target-agent bosun-cdp-mesh
 *   bun bridge-server.ts --target-agent bosun-cdp-mesh --tab "My Site" --port 3457
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

// Force our own mesh identity early — before anything reads env
process.env.PI_AGENT_NAME = "browser-bridge";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    "target-agent": { type: "string" },
    tab: { type: "string" },
    port: { type: "string", default: "3456" },
  },
  strict: false,
});

const targetAgent = args["target-agent"];
const tabSelector = args.tab;
const healthPort = parseInt(args.port ?? "3456", 10);

if (!targetAgent) {
  console.error("Error: --target-agent is required");
  console.error("Usage: bun bridge-server.ts --target-agent <agent-name> [--tab <title>] [--port <n>]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function findPiDir(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".pi"))) return path.join(dir, ".pi");
    dir = path.dirname(dir);
  }
  return path.join(process.cwd(), ".pi");
}

const piDir = findPiDir();
const meshDir = path.join(piDir, "mesh");
const registryDir = path.join(meshDir, "registry");
const inboxDir = path.join(meshDir, "inbox");
const ownInbox = path.join(inboxDir, "browser-bridge");
const lockfilePath = path.join(meshDir, "browser-bridge.pid");
const projectRoot = path.dirname(piDir);

// ---------------------------------------------------------------------------
// Startup guards
// ---------------------------------------------------------------------------

// PID lockfile — prevent duplicate bridges
if (fs.existsSync(lockfilePath)) {
  try {
    const existingPid = parseInt(fs.readFileSync(lockfilePath, "utf-8").trim(), 10);
    try {
      process.kill(existingPid, 0);
      console.error(`Error: Bridge already running (PID ${existingPid}). Kill it first or remove ${lockfilePath}`);
      process.exit(1);
    } catch {
      // PID dead — stale lockfile, proceed
    }
  } catch {
    // Malformed lockfile, proceed
  }
}

fs.mkdirSync(path.dirname(lockfilePath), { recursive: true });
fs.writeFileSync(lockfilePath, String(process.pid));

// Target agent validation
function validateTargetAgent(): boolean {
  const regPath = path.join(registryDir, `${targetAgent}.json`);
  if (!fs.existsSync(regPath)) return false;
  try {
    const reg = JSON.parse(fs.readFileSync(regPath, "utf-8"));
    process.kill(reg.pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (!validateTargetAgent()) {
  console.error(`Error: Target agent '${targetAgent}' is not registered in mesh.`);
  console.error("Ensure pi-mesh is active (autoRegister: true in pi-mesh.json).");
  cleanup();
  process.exit(1);
}

console.log(`Target agent: ${targetAgent} ✓`);

// ---------------------------------------------------------------------------
// Mesh registration
// ---------------------------------------------------------------------------

function registerInMesh(): void {
  fs.mkdirSync(registryDir, { recursive: true });
  fs.mkdirSync(ownInbox, { recursive: true });

  const now = new Date().toISOString();
  const registration = {
    name: "browser-bridge",
    agentType: "browser",
    pid: process.pid,
    sessionId: "",
    cwd: process.cwd(),
    model: "bridge",
    startedAt: now,
    isHuman: false,
    session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: now },
  };

  fs.writeFileSync(
    path.join(registryDir, "browser-bridge.json"),
    JSON.stringify(registration, null, 2),
  );
  console.log("Registered in mesh as browser-bridge");
}

function updateActivity(): void {
  const regPath = path.join(registryDir, "browser-bridge.json");
  if (!fs.existsSync(regPath)) return;
  try {
    const reg = JSON.parse(fs.readFileSync(regPath, "utf-8"));
    reg.activity.lastActivityAt = new Date().toISOString();
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
  } catch {
    // Best effort
  }
}

function unregisterFromMesh(): void {
  try { fs.unlinkSync(path.join(registryDir, "browser-bridge.json")); } catch { /* ignore */ }
}

registerInMesh();

// ---------------------------------------------------------------------------
// Mesh messaging
// ---------------------------------------------------------------------------

interface MeshMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  urgent: boolean;
  replyTo: string | null;
}

function sendMeshMessage(to: string, text: string): MeshMessage {
  const targetInbox = path.join(inboxDir, to);
  fs.mkdirSync(targetInbox, { recursive: true });

  const msg: MeshMessage = {
    id: randomUUID(),
    from: "browser-bridge",
    to,
    text,
    timestamp: new Date().toISOString(),
    urgent: false,
    replyTo: null,
  };

  const random = Math.random().toString(36).substring(2, 8);
  const msgFile = path.join(targetInbox, `${Date.now()}-${random}.json`);
  fs.writeFileSync(msgFile, JSON.stringify(msg, null, 2));
  return msg;
}

// ---------------------------------------------------------------------------
// Annotation persistence
// ---------------------------------------------------------------------------

interface Annotation {
  url: string;
  pageTitle: string;
  selectedText: string;
  surroundingText: string;
  cssSelector: string;
  nearestHeadings: string[];
  elementSnippet: string;
  comment: string;
  agentTarget: string;
  timestamp: string;
  viewport: { width: number; height: number };
}

function persistAnnotation(annotation: Annotation): { jsonPath: string; pngPath: string } {
  let hostname: string;
  try {
    hostname = new URL(annotation.url).hostname;
  } catch {
    hostname = "unknown";
  }

  const now = new Date();
  const dateDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeBase = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;

  const dir = path.join(projectRoot, "workspace", "scratch", "annotations", hostname, dateDir);
  fs.mkdirSync(dir, { recursive: true });

  // Find unique basename (append random suffix on collision)
  let basename = timeBase;
  if (fs.existsSync(path.join(dir, `${basename}.json`))) {
    const suffix = Math.random().toString(36).substring(2, 6);
    basename = `${timeBase}-${suffix}`;
  }

  const jsonPath = path.join(dir, `${basename}.json`);
  const pngPath = path.join(dir, `${basename}.png`);

  fs.writeFileSync(jsonPath, JSON.stringify(annotation, null, 2));
  return { jsonPath, pngPath };
}

// ---------------------------------------------------------------------------
// CDP connection
// ---------------------------------------------------------------------------

// Resolve cdp-client.ts relative to this script
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const cdpClientPath = path.join(scriptDir, "..", "..", "cdp-browser", "scripts", "cdp-client.ts");

const { connect } = await import(cdpClientPath);
const browser = await connect({ tab: tabSelector });

const connectedTabTitle = await browser.title().catch(() => "unknown");
console.log(`CDP connected to tab: ${connectedTabTitle}`);

// Enable page events for navigation tracking
await browser.send("Page.enable");
await browser.send("Runtime.enable");

// Register the binding — creates window.piAnnotate() in the page
await browser.send("Runtime.addBinding", { name: "piAnnotate" });
console.log("CDP binding 'piAnnotate' registered");

// Read annotator.js from disk
const annotatorPath = path.join(scriptDir, "annotator.js");
if (!fs.existsSync(annotatorPath)) {
  console.error(`Error: annotator.js not found at ${annotatorPath}`);
  cleanup();
  process.exit(1);
}
const annotatorSource = fs.readFileSync(annotatorPath, "utf-8");

// Inject annotator into current page
async function injectAnnotator(): Promise<void> {
  try {
    await browser.eval(annotatorSource);
    console.log("Annotator injected");
  } catch (err) {
    console.error("Failed to inject annotator:", err);
  }
}

await injectAnnotator();

// Re-inject on navigation (debounced to handle rapid A→B→C navigations)
let reinjectTimer: ReturnType<typeof setTimeout> | null = null;
// intentional: bridge-scoped for process lifetime, no deregistration needed
browser.on((method: string, _params: unknown) => {
  if (method === "Page.loadEventFired") {
    if (reinjectTimer) clearTimeout(reinjectTimer);
    reinjectTimer = setTimeout(async () => {
      reinjectTimer = null;
      // Re-register binding (defensive — bindings usually persist, but re-add to be safe)
      try {
        await browser.send("Runtime.addBinding", { name: "piAnnotate" });
      } catch {
        // May already exist, that's fine
      }
      await injectAnnotator();
    }, 500);
  }
});

// Listen for annotations from the browser
// intentional: bridge-scoped for process lifetime, no deregistration needed
browser.on(async (method: string, params: Record<string, unknown>) => {
  if (method !== "Runtime.bindingCalled") return;
  if (params.name !== "piAnnotate") return;

  try {
    const payload = params.payload as string;
    let annotation: Annotation;
    try {
      annotation = JSON.parse(payload);
    } catch {
      console.error("Invalid annotation payload:", payload);
      return;
    }

    annotation.agentTarget = targetAgent!;
    annotation.timestamp = new Date().toISOString();

    console.log(`Annotation received: "${(annotation.comment || "").slice(0, 50)}..."`);

    // Re-validate target agent
    if (!validateTargetAgent()) {
      console.error(`Target agent '${targetAgent}' is no longer active in mesh`);
      try {
        await browser.eval(
          `window.__piAnnotatorResponse && window.__piAnnotatorResponse(${JSON.stringify(
            JSON.stringify({ type: "error", text: `Agent '${targetAgent}' is not active. Restart with /browser-bridge.` }),
          )})`,
        );
      } catch { /* ignore */ }
      return;
    }

    // Persist annotation + screenshot
    const { jsonPath, pngPath } = persistAnnotation(annotation);

    try {
      await browser.screenshot(pngPath);
      console.log(`Screenshot saved: ${pngPath}`);
    } catch (err) {
      console.error("Screenshot failed:", err);
    }

    // Build mesh message with rich context
    // Sanitize title/url to avoid breaking markdown link syntax
    const safeTitle = (annotation.pageTitle || annotation.url || "").replace(/[\[\]]/g, "");
    const safeUrl = (annotation.url || "").replace(/[()]/g, "");
    const headingsStr = annotation.nearestHeadings?.length
      ? `\nHeading context: ${annotation.nearestHeadings.join(" > ")}`
      : "";
    const surroundingStr = annotation.surroundingText
      ? `\nSurrounding text: ...${annotation.surroundingText}...`
      : "";

    const messageText = [
      `**Browser Annotation** on [${safeTitle}](${safeUrl})`,
      "",
      `> ${annotation.selectedText}`,
      "",
      `**Comment:** ${annotation.comment}`,
      "",
      `Element: \`${annotation.cssSelector}\`${headingsStr}${surroundingStr}`,
      `Viewport: ${annotation.viewport?.width}×${annotation.viewport?.height}`,
      "",
      `Annotation: ${jsonPath}`,
      `Screenshot: ${pngPath}`,
    ].join("\n");

    sendMeshMessage(targetAgent!, messageText);
    updateActivity();

    console.log(`Mesh message sent to ${targetAgent}`);

    // Confirm to browser
    try {
      await browser.eval(
        `window.__piAnnotatorResponse && window.__piAnnotatorResponse(${JSON.stringify(
          JSON.stringify({ type: "sent", text: `Annotation sent to ${targetAgent}` }),
        )})`,
      );
    } catch { /* ignore */ }
  } catch (err) {
    console.error("Error handling annotation:", err);
  }
});

// ---------------------------------------------------------------------------
// Inbox watcher — agent responses → browser
// ---------------------------------------------------------------------------

fs.mkdirSync(ownInbox, { recursive: true });

function processInbox(): void {
  let files: string[];
  try {
    files = fs.readdirSync(ownInbox).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return;
  }

  for (const file of files) {
    const msgPath = path.join(ownInbox, file);
    try {
      const msg: MeshMessage = JSON.parse(fs.readFileSync(msgPath, "utf-8"));
      console.log(`Response from ${msg.from}: "${msg.text.slice(0, 60)}..."`);

      // Forward to browser
      const responsePayload = JSON.stringify({
        type: "response",
        from: msg.from,
        text: msg.text,
        timestamp: msg.timestamp,
      });
      browser.eval(
        `window.__piAnnotatorResponse && window.__piAnnotatorResponse(${JSON.stringify(responsePayload)})`,
      ).catch(() => { /* browser may have navigated */ });

      updateActivity();
      fs.unlinkSync(msgPath);
    } catch {
      // Delete malformed
      try { fs.unlinkSync(msgPath); } catch { /* ignore */ }
    }
  }
}

// Process existing messages
processInbox();

// Watch for new messages
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const watcher = fs.watch(ownInbox, () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    processInbox();
  }, 50);
});

// ---------------------------------------------------------------------------
// Health endpoint
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: healthPort,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        tab: connectedTabTitle,
        target: targetAgent,
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
      });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Health endpoint: http://127.0.0.1:${server.port}/api/health`);
console.log(`\nBridge ready. Annotations → ${targetAgent}. Ctrl+C to stop.\n`);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

let cleanedUp = false;
function cleanup(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  try { watcher?.close(); } catch { /* ignore */ }
  if (debounceTimer) clearTimeout(debounceTimer);
  if (reinjectTimer) clearTimeout(reinjectTimer);
  try { browser?.close(); } catch { /* ignore */ }
  try { server?.stop(); } catch { /* ignore */ }
  unregisterFromMesh();
  try { fs.unlinkSync(lockfilePath); } catch { /* ignore */ }
  console.log("\nBridge shut down.");
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);
