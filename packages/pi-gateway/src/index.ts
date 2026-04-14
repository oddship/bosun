#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import matter from "gray-matter";
import { join, extname, normalize, relative, resolve, sep } from "node:path";
import { resolveMarkdownPageTitle } from "./page-title";
import { pathToFileURL } from "node:url";

type GatewayConfig = {
  enabled: boolean;
  host: string;
  port: number;
  autoStart?: boolean;
};

type SiteManifest = {
  agent?: string;
  auth?: {
    enabled?: boolean;
    module?: string;
    provider?: string;
  };
  runtime?: {
    backend?: string;
    sessionName?: string;
    meshName?: string;
    command?: string;
    inboxFile?: string;
    outboxFile?: string;
    inputMode?: "queue" | "tmux";
    prompt?: string;
    promptTemplate?: "site-maintainer" | string;
    maintainerIntent?: string;
    contextFiles?: string[];
    agentName?: string;
    automationAgentName?: string;
    automationActions?: string[];
    actionAgents?: Record<string, string>;
    framedReplies?: boolean;
    resetOnStart?: boolean;
  };
};

type SiteRegistration = {
  packageName: string;
  packageSlug: string;
  siteName: string;
  dir: string;
  absDir: string;
  manifest?: SiteManifest;
};

type PackageJson = {
  name?: string;
  pi?: {
    sites?: Record<string, { dir?: string }>;
  };
};

type SiteMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  source: "browser" | "gateway" | "runtime";
  actorId?: string;
  actorLogin?: string;
  visibility?: string;
};

type SiteActionEvent = {
  id: string;
  action: string;
  target?: string;
  gesture?: string;
  scope?: string;
  payload?: Record<string, unknown>;
  ts: string;
  status: "pending" | "dispatched" | "accepted" | "failed";
  source: "browser" | "gateway" | "runtime";
  actorId?: string;
  actorLogin?: string;
  visibility?: string;
};

type SiteAgentRuntimeState = {
  version?: number;
  updatedAt?: string;
  hostSessionName?: string | null;
  backendType?: string;
  routes?: Array<{
    agentName?: string;
    tmuxSessionName?: string;
    backendTarget?: string;
    sessionPath?: string;
    mode?: "default" | "automation";
  }>;
};

type GatewayRequestIdentity = {
  proxy: "caddy-tailscale";
  login: string;
  name?: string;
  profilePicture?: string;
  tailnet?: string;
};

type GatewayAccessRequest = {
  resource: "site" | "messages" | "actions" | "events" | "logs" | "status" | "control";
  operation: "view" | "interact" | "mutate" | "admin";
  path?: string;
  body?: unknown;
};

type GatewayAuthzDecision = {
  ok: boolean;
  status?: number;
  error?: string;
  actorId?: string;
  actorLogin?: string;
  visibility?: string;
};

type SiteAuthModule = {
  authorizeSiteRequest?: (input: {
    site: {
      packageName: string;
      siteName: string;
      absDir: string;
      manifest?: SiteManifest;
    };
    request: {
      method: string;
      url: string;
      headers: Record<string, string>;
    };
    access: GatewayAccessRequest;
    identity: GatewayRequestIdentity | null;
  }) => Promise<GatewayAuthzDecision> | GatewayAuthzDecision;
  canActorAccessVisibility?: (input: {
    viewerActorId?: string;
    itemVisibility?: string;
    itemActorId?: string;
  }) => boolean;
};

const ROOT = process.cwd();
const BOSUN_PKG = process.env.BOSUN_PKG ? resolve(process.env.BOSUN_PKG) : ROOT;
const CONFIG_PATH = join(ROOT, ".pi", "pi-gateway.json");
const siteAuthModuleCache = new Map<string, Promise<SiteAuthModule>>();

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function loadConfig(): GatewayConfig {
  const config = readJsonFile<GatewayConfig>(CONFIG_PATH);
  return {
    enabled: config?.enabled ?? false,
    host: config?.host || "127.0.0.1",
    port: config?.port || 3100,
    autoStart: config?.autoStart ?? true,
  };
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers.get(name);
  return value?.trim() || undefined;
}

function extractRequestIdentity(req: Request): GatewayRequestIdentity | null {
  const proxy = headerValue(req, "x-steward-proxy");
  const login = headerValue(req, "x-webauth-user") || headerValue(req, "tailscale-user-login");
  if (proxy !== "caddy-tailscale" || !login) return null;

  return {
    proxy: "caddy-tailscale",
    login,
    name: headerValue(req, "x-webauth-name") || headerValue(req, "tailscale-user-name"),
    profilePicture: headerValue(req, "tailscale-user-profile-pic"),
    tailnet: headerValue(req, "tailscale-tailnet"),
  };
}

function normalizeVisibility(value: string | undefined): "household" | "private" | "system" {
  if (!value) return "household";
  if (value === "family") return "household";
  if (value === "owner-only") return "private";
  if (value === "private" || value === "system") return value;
  return "household";
}

function defaultCanActorAccessVisibility(viewerActorId: string | undefined, itemVisibility: string | undefined, itemActorId: string | undefined): boolean {
  const visibility = normalizeVisibility(itemVisibility);
  if (visibility === "system") return false;
  if (visibility === "private") return Boolean(viewerActorId && itemActorId && viewerActorId === itemActorId);
  return Boolean(viewerActorId);
}

function siteAuthModulePath(site: SiteRegistration): string | undefined {
  if (site.manifest?.auth?.enabled === false) return undefined;
  const modulePath = site.manifest?.auth?.module;
  return modulePath ? resolve(site.absDir, modulePath) : undefined;
}

async function loadSiteAuthModule(site: SiteRegistration): Promise<SiteAuthModule | undefined> {
  const modulePath = siteAuthModulePath(site);
  if (!modulePath) return undefined;
  if (!existsSync(modulePath)) {
    throw new Error(`Site auth module not found: ${modulePath}`);
  }
  if (!siteAuthModuleCache.has(modulePath)) {
    siteAuthModuleCache.set(modulePath, import(pathToFileURL(modulePath).href) as Promise<SiteAuthModule>);
  }
  return await siteAuthModuleCache.get(modulePath)!;
}

async function authorizeSiteRequest(site: SiteRegistration, req: Request, access: GatewayAccessRequest): Promise<GatewayAuthzDecision> {
  const authModule = await loadSiteAuthModule(site);
  const identity = extractRequestIdentity(req);

  if (!authModule?.authorizeSiteRequest) {
    return {
      ok: true,
      actorLogin: identity?.login,
      visibility: access.operation === "admin" ? "system" : "household",
    };
  }

  try {
    const result = await authModule.authorizeSiteRequest({
      site: {
        packageName: site.packageName,
        siteName: site.siteName,
        absDir: site.absDir,
        manifest: site.manifest,
      },
      request: {
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
      },
      access,
      identity,
    });

    if (!result.ok) {
      return {
        ok: false,
        status: result.status || 403,
        error: result.error || "Forbidden",
      };
    }

    return {
      ok: true,
      actorId: result.actorId,
      actorLogin: result.actorLogin || identity?.login,
      visibility: normalizeVisibility(result.visibility),
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function canActorAccessVisibility(authModule: SiteAuthModule | undefined, viewerActorId: string | undefined, itemVisibility: string | undefined, itemActorId: string | undefined): boolean {
  if (authModule?.canActorAccessVisibility) {
    return authModule.canActorAccessVisibility({ viewerActorId, itemVisibility, itemActorId });
  }
  return defaultCanActorAccessVisibility(viewerActorId, itemVisibility, itemActorId);
}

function discoverPiPackageDirs(baseDir: string): string[] {
  if (!existsSync(baseDir)) return [];
  return readdirSync(baseDir)
    .map((entry) => join(baseDir, entry))
    .filter((dir) => {
      const pkgPath = join(dir, "package.json");
      if (!existsSync(pkgPath)) return false;
      const pkg = readJsonFile<PackageJson>(pkgPath);
      return !!pkg?.pi;
    })
    .sort();
}

function getPackageRoots(): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  const localPackagesDir = join(ROOT, "packages");
  for (const dir of discoverPiPackageDirs(localPackagesDir)) {
    seen.add(normalize(dir));
    results.push(dir);
  }

  const bosunPackagesDir = join(BOSUN_PKG, "packages");
  if (normalize(bosunPackagesDir) !== normalize(localPackagesDir)) {
    for (const dir of discoverPiPackageDirs(bosunPackagesDir)) {
      const key = normalize(dir);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(dir);
    }
  }

  const depPackagesDir = join(ROOT, "node_modules", "bosun", "packages");
  for (const dir of discoverPiPackageDirs(depPackagesDir)) {
    const key = normalize(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(dir);
  }

  return results;
}

function slugPackageName(packageName: string): string {
  return encodeURIComponent(packageName);
}

function discoverSites(): SiteRegistration[] {
  const sites: SiteRegistration[] = [];

  for (const pkgDir of getPackageRoots()) {
    const pkgPath = join(pkgDir, "package.json");
    const pkg = readJsonFile<PackageJson>(pkgPath);
    if (!pkg?.name || !pkg.pi?.sites) continue;

    for (const [siteName, siteConfig] of Object.entries(pkg.pi.sites)) {
      const dir = siteConfig?.dir;
      if (!dir) continue;
      const absDir = resolve(pkgDir, dir);
      if (!existsSync(absDir)) continue;
      const manifest = readJsonFile<SiteManifest>(join(absDir, "site.json"));
      sites.push({
        packageName: pkg.name,
        packageSlug: slugPackageName(pkg.name),
        siteName,
        dir,
        absDir,
        manifest,
      });
    }
  }

  return sites.sort((a, b) => `${a.packageName}/${a.siteName}`.localeCompare(`${b.packageName}/${b.siteName}`));
}

function htmlPage(sites: SiteRegistration[], config: GatewayConfig): string {
  const list = sites.length === 0
    ? '<li>No <code>pi.sites</code> registrations found yet.</li>'
    : sites.map((site) => {
        const runtime = site.manifest?.runtime?.backend || "unbound";
        const agent = site.manifest?.agent || "(none)";
        return `<li><strong>${escapeHtml(site.packageName)}/${escapeHtml(site.siteName)}</strong> — dir <code>${escapeHtml(site.dir)}</code>, agent <code>${escapeHtml(agent)}</code>, runtime <code>${escapeHtml(runtime)}</code>, route <code>/sites/${escapeHtml(site.packageSlug)}/${escapeHtml(site.siteName)}/</code></li>`;
      }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pi-gateway</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>pi-gateway</h1>
  <p class="muted">Gateway skeleton running on ${escapeHtml(config.host)}:${config.port}</p>
  <h2>Discovered sites</h2>
  <ul>${list}</ul>
  <h2>API</h2>
  <ul>
    <li><code>GET /api/health</code></li>
    <li><code>GET /api/sites</code></li>
  </ul>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdownBody(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    html.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  const flushCode = () => {
    if (codeLines.length === 0) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCode();

  return html.join("\n");
}

function siteChrome(site: SiteRegistration, bodyHtml: string, pageTitle: string): string {
  const route = `/sites/${site.packageSlug}/${site.siteName}/`;
  const apiBase = `/api/sites/${site.packageSlug}/${site.siteName}`;
  const documentTitle = `${pageTitle} · ${site.packageName}/${site.siteName}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(documentTitle)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --bg-accent: radial-gradient(circle at top, #eef4ff 0%, #f5f7fb 42%, #f5f7fb 100%);
      --surface: #ffffff;
      --surface-soft: #f8fafc;
      --border: #e5e7eb;
      --border-strong: #cbd5e1;
      --text: #0f172a;
      --muted: #64748b;
      --link: #2563eb;
      --shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
      --shadow-soft: 0 2px 8px rgba(15, 23, 42, 0.05);
      --green-bg: #dcfce7;
      --green-text: #166534;
      --red-bg: #fee2e2;
      --red-text: #991b1b;
    }
    * { box-sizing: border-box; }
    body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; margin: 0; color: var(--text); background: var(--bg-accent); }
    .wrap { max-width: 1240px; margin: 0 auto; padding: 16px 16px 56px; }
    .topbar { display: flex; gap: 12px; justify-content: space-between; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
    .site-kicker { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 999px; background: #e5e7eb; font-size: 12px; font-weight: 600; box-shadow: var(--shadow-soft); }
    .badge::before { content: ''; width: 8px; height: 8px; border-radius: 999px; background: currentColor; opacity: 0.9; }
    .badge.running { background: var(--green-bg); color: var(--green-text); }
    .badge.stopped { background: var(--red-bg); color: var(--red-text); }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
    .content, .card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); }
    .content { padding: 24px; min-width: 0; }
    .sidebar { display: grid; gap: 14px; position: sticky; top: 12px; }
    .card { padding: 16px; }
    .card h3 { margin: 0 0 10px; font-size: 15px; }
    .meta-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .meta-pill { padding: 9px 11px; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--border); }
    .meta-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 4px; }
    .meta-value { display: block; font-size: 13px; font-weight: 600; color: var(--text); word-break: break-word; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    button { border: 1px solid var(--border-strong); background: #fff; color: var(--text); border-radius: 10px; padding: 9px 12px; cursor: pointer; font: inherit; font-size: 14px; }
    button:hover { background: #f8fafc; }
    button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    button.primary:hover { background: #1d4ed8; }
    textarea { width: 100%; min-height: 92px; border: 1px solid var(--border-strong); border-radius: 12px; padding: 12px; font: inherit; resize: vertical; }
    pre { margin: 0; background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 12px; overflow-x: auto; white-space: pre-wrap; max-height: 280px; }
    code { background: #f1f5f9; padding: 0.12rem 0.32rem; border-radius: 4px; }
    pre code { background: transparent; padding: 0; }
    blockquote { margin: 18px 0; padding: 14px 16px; border-left: 4px solid #93c5fd; background: #eff6ff; color: #1e3a8a; border-radius: 12px; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .content h1 { margin: 0 0 12px; font-size: 36px; line-height: 1.05; letter-spacing: -0.04em; }
    .content h2 { margin: 24px 0 12px; font-size: 22px; line-height: 1.15; letter-spacing: -0.02em; }
    .content h3 { margin: 20px 0 10px; font-size: 18px; }
    .content p, .content li { font-size: 16px; line-height: 1.6; }
    .content p { margin: 0 0 14px; }
    .content ul { padding-left: 22px; margin: 0 0 16px; }
    .content li + li { margin-top: 8px; }
    .content h3 a { display: inline-block; padding: 6px 0; }
    .content > *:first-child { margin-top: 0; }
    .small { font-size: 12px; }
    .muted { color: var(--muted); }
    .outline { display: grid; gap: 8px; }
    .outline a { display: block; padding: 8px 10px; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--border); color: var(--text); }
    .outline a:hover { background: #eef2ff; text-decoration: none; }
    details { border: 1px solid var(--border); border-radius: 14px; background: var(--surface-soft); overflow: hidden; }
    details + details { margin-top: 10px; }
    summary { list-style: none; cursor: pointer; padding: 11px 14px; font-weight: 600; }
    summary::-webkit-details-marker { display: none; }
    .details-body { padding: 0 14px 14px; display: grid; gap: 12px; }
    .composer-note { margin: 0 0 10px; color: var(--muted); font-size: 14px; }
    .empty { color: var(--muted); font-style: italic; }
    .runtime-note { margin-top: 10px; }
    .site-route { margin-top: 8px; }
    @media (max-width: 980px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static; }
      .content { padding: 20px; }
      .content h1 { font-size: 32px; }
      .wrap { padding-top: 12px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div class="site-kicker">pi.sites / ${escapeHtml(site.packageName)} / ${escapeHtml(site.siteName)}</div>
      <div><span id="status-badge" class="badge">checking status…</span></div>
    </header>
    <div class="layout">
      <main class="content" id="site-content">${bodyHtml}</main>
      <aside class="sidebar" aria-label="Site tools">
        <section class="card">
          <h3>Message this site</h3>
          <p class="composer-note">Ask for a clarification or request an update to this page.</p>
          <div id="action-state" class="small muted" style="margin-bottom:10px">Structured page actions will appear here when available.</div>
          <textarea id="message-input" placeholder="Ask Steward to explain, reorganize, or improve something on this page…"></textarea>
          <div class="controls">
            <button id="send-message" class="primary">Send</button>
            <button id="refresh-messages">Refresh transcript</button>
          </div>
        </section>
        <nav class="card" aria-label="Page navigation">
          <h3>On this page</h3>
          <div id="page-outline" class="outline"><div class="empty">Scanning headings…</div></div>
        </nav>
        <section class="card">
          <h3>Runtime controls</h3>
          <div class="runtime-note small muted">Keep this panel for runtime operations and troubleshooting.</div>
          <div class="meta-grid" style="margin-top:10px">
            <div class="meta-pill"><span class="meta-label">Runtime</span><span class="meta-value" id="runtime-backend">Loading…</span></div>
            <div class="meta-pill"><span class="meta-label">Input</span><span class="meta-value" id="runtime-input">Loading…</span></div>
            <div class="meta-pill"><span class="meta-label">Session</span><span class="meta-value" id="runtime-session">Loading…</span></div>
            <div class="meta-pill"><span class="meta-label">Control</span><span class="meta-value" id="runtime-control">Loading…</span></div>
          </div>
          <div class="controls">
            <button id="refresh-status">Refresh</button>
            <button id="start-site">Start</button>
            <button id="stop-site">Stop</button>
            <button id="restart-site">Restart</button>
          </div>
          <div class="small muted" id="live-state">Connecting live updates…</div>
          <div class="site-route small muted">Route: <code>${escapeHtml(route)}</code></div>
        </section>
        <section class="card">
          <h3>Diagnostics</h3>
          <details>
            <summary>Transcript</summary>
            <div class="details-body">
              <div class="small muted">Gateway stores transcript sidecars for this site runtime.</div>
              <pre id="messages">No messages yet.</pre>
            </div>
          </details>
          <details>
            <summary>Logs</summary>
            <div class="details-body">
              <div class="controls">
                <button id="refresh-logs">Refresh logs</button>
                <button id="reset-site">Reset state</button>
              </div>
              <pre id="logs">Loading…</pre>
            </div>
          </details>
          <p class="small muted" style="margin:12px 0 0">Tip: add <code>?raw=1</code> to inspect the source markdown.</p>
        </section>
      </aside>
    </div>
  </div>
  <script>
    const apiBase = ${JSON.stringify(apiBase)};
    const badge = document.getElementById('status-badge');
    const runtimeBackend = document.getElementById('runtime-backend');
    const runtimeInput = document.getElementById('runtime-input');
    const runtimeSession = document.getElementById('runtime-session');
    const runtimeControl = document.getElementById('runtime-control');
    const logs = document.getElementById('logs');
    const liveState = document.getElementById('live-state');
    const messages = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const outline = document.getElementById('page-outline');
    const actionState = document.getElementById('action-state');

    function updateSiteStatus(site) {
      badge.textContent = site.running ? 'running' : 'stopped';
      badge.className = 'badge ' + (site.running ? 'running' : 'stopped');
      runtimeBackend.textContent = site.backend || 'unknown';
      runtimeInput.textContent = site.inputMode || 'queue';
      runtimeSession.textContent = site.sessionName || '(none)';
      runtimeControl.textContent = site.hasControl ? 'available' : 'read-only';
    }

    function renderOutline() {
      const headings = Array.from(document.querySelectorAll('#site-content h2, #site-content h3'));
      if (headings.length === 0) {
        outline.innerHTML = '<div class="empty">No page headings found.</div>';
        return;
      }
      outline.innerHTML = headings.map((heading, index) => {
        if (!heading.id) heading.id = 'section-' + index;
        const indent = heading.tagName === 'H3' ? ' style="margin-left:12px"' : '';
        return '<a' + indent + ' href="#' + heading.id + '">' + heading.textContent + '</a>';
      }).join('');
    }

    async function refreshStatus() {
      const res = await fetch(apiBase + '/status');
      const data = await res.json();
      updateSiteStatus(data.site || {});
    }

    async function refreshLogs() {
      const res = await fetch(apiBase + '/logs?lines=80');
      const data = await res.json();
      logs.textContent = data.lines || data.error || 'No logs';
    }

    async function refreshMessages() {
      const res = await fetch(apiBase + '/messages');
      const data = await res.json();
      const rows = (data.messages || []).map((message) => '[' + message.role + '] ' + message.content).join('\\n\\n');
      messages.textContent = rows || 'No messages yet.';
    }

    async function refreshActions() {
      const res = await fetch(apiBase + '/actions');
      const data = await res.json();
      const actions = data.actions || [];
      const last = actions[actions.length - 1];
      if (!last) {
        actionState.textContent = 'Structured page actions will appear here when available.';
        return;
      }
      actionState.textContent = 'Last action: ' + last.action + (last.target ? ' → ' + last.target : '') + ' · ' + last.status;
    }

    async function invoke(action) {
      const res = await fetch(apiBase + '/' + action, { method: 'POST' });
      const data = await res.json();
      if (data.error) logs.textContent = data.error;
      await refreshStatus();
      await refreshLogs();
    }

    async function sendMessage() {
      const content = (messageInput.value || '').trim();
      if (!content) return;
      const res = await fetch(apiBase + '/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.error) {
        messages.textContent = data.error;
        return;
      }
      messageInput.value = '';
      await refreshMessages();
    }

    function parseSiteActionHref(href) {
      if (!href || !href.startsWith('site-action:')) return null;
      const raw = href.slice('site-action:'.length);
      const normalized = raw.startsWith('/') ? raw.slice(1) : raw;
      const url = new URL('http://site-action.local/' + normalized);
      const action = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      if (!action) return null;
      const payload = {};
      for (const [key, value] of url.searchParams.entries()) {
        if (key === 'target' || key === 'gesture' || key === 'scope') continue;
        payload[key] = value;
      }
      return {
        action,
        target: url.searchParams.get('target') || undefined,
        gesture: url.searchParams.get('gesture') || 'link',
        scope: url.searchParams.get('scope') || undefined,
        payload,
      };
    }

    async function triggerSiteAction(spec) {
      if (!spec || !spec.action) return;
      actionState.textContent = 'Sending action: ' + spec.action + '…';
      const res = await fetch(apiBase + '/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(spec),
      });
      const data = await res.json();
      if (data.error) {
        actionState.textContent = data.error;
        return;
      }
      const event = data.action || {};
      actionState.textContent = 'Last action: ' + (event.action || spec.action) + (event.target ? ' → ' + event.target : '') + ' · ' + (event.status || 'accepted');
      await refreshMessages();
      await refreshActions();
    }

    document.getElementById('refresh-status')?.addEventListener('click', refreshStatus);
    document.getElementById('refresh-logs')?.addEventListener('click', refreshLogs);
    document.getElementById('refresh-messages')?.addEventListener('click', refreshMessages);
    document.getElementById('send-message')?.addEventListener('click', sendMessage);
    document.getElementById('start-site')?.addEventListener('click', () => invoke('start'));
    document.getElementById('stop-site')?.addEventListener('click', () => invoke('stop'));
    document.getElementById('restart-site')?.addEventListener('click', () => invoke('restart'));
    document.getElementById('reset-site')?.addEventListener('click', () => invoke('reset'));
    document.addEventListener('click', (event) => {
      const origin = event.target instanceof Element
        ? event.target
        : (event.target && 'parentElement' in event.target ? event.target.parentElement : null);
      const target = origin ? origin.closest('[data-site-action], a[href^="site-action:"]') : null;
      if (!target) return;
      let spec = null;
      if (target instanceof HTMLAnchorElement) {
        spec = parseSiteActionHref(target.getAttribute('href'));
      } else {
        const action = target.getAttribute('data-site-action');
        if (action) {
          spec = {
            action,
            target: target.getAttribute('data-site-target') || undefined,
            gesture: target.getAttribute('data-site-gesture') || 'click',
            scope: target.getAttribute('data-site-scope') || undefined,
            payload: target.getAttribute('data-site-payload') ? JSON.parse(target.getAttribute('data-site-payload')) : {},
          };
        }
      }
      if (!spec) return;
      event.preventDefault();
      triggerSiteAction(spec);
    });

    const events = new EventSource(apiBase + '/events');
    events.addEventListener('snapshot', (event) => {
      const data = JSON.parse(event.data || '{}');
      updateSiteStatus(data.site || {});
      const logData = data.logs || {};
      const messageData = data.messages || {};
      const actionData = data.actions || {};
      logs.textContent = logData.lines || logData.error || 'No logs';
      const rows = (messageData.messages || []).map((message) => '[' + message.role + '] ' + message.content).join('\\n\\n');
      messages.textContent = rows || 'No messages yet.';
      const actions = actionData.actions || [];
      const last = actions[actions.length - 1];
      if (last) {
        actionState.textContent = 'Last action: ' + last.action + (last.target ? ' → ' + last.target : '') + ' · ' + last.status;
      }
      liveState.textContent = 'Live updates connected · ' + (data.ts || '');
    });
    events.addEventListener('error', () => {
      liveState.textContent = 'Live updates reconnecting…';
    });

    renderOutline();
    refreshStatus();
    refreshLogs();
    refreshMessages();
    refreshActions();
  </script>
</body>
</html>`;
}

function renderMarkdownDocument(site: SiteRegistration, markdown: string, relativePath?: string): string {
  const parsed = matter(markdown);
  const title = resolveMarkdownPageTitle({
    frontmatterTitle: typeof parsed.data.title === "string" ? parsed.data.title : undefined,
    markdownContent: parsed.content,
    fallbackTitle: `${site.packageName}/${site.siteName}`,
    relativePath,
  });
  const bodyHtml = renderMarkdownBody(parsed.content);
  return siteChrome(site, bodyHtml, title);
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "application/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".md": return "text/markdown; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

function isHxRequest(req: Request): boolean {
  return req.headers.get("hx-request") === "true";
}

function humanizeActionName(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderSiteActionResultFragment(action: SiteActionEvent): string {
  const label = humanizeActionName(action.action);
  const target = action.target ? ` for ${escapeHtml(action.target)}` : "";
  return [
    `<article class="site-action-feedback" role="status">`,
    `  <strong>${escapeHtml(label)}</strong>`,
    `  <p>Steward is working on this${target}.</p>`,
    `  <p class="small muted">Requested ${escapeHtml(action.ts)} · status ${escapeHtml(action.status)}</p>`,
    `</article>`,
  ].join("\n");
}

function renderSiteActionErrorFragment(message: string): string {
  return [
    `<article class="site-action-feedback" role="alert">`,
    `  <strong>Action not sent</strong>`,
    `  <p>${escapeHtml(message)}</p>`,
    `</article>`,
  ].join("\n");
}

async function parseRequestBody(req: Request): Promise<{ body?: unknown; error?: string }> {
  const type = req.headers.get("content-type") || "";

  if (type.includes("application/json")) {
    try {
      return { body: await req.json() };
    } catch {
      return { error: "Expected JSON body" };
    }
  }

  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      return {
        body: Object.fromEntries(
          [...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : value.name]),
        ),
      };
    } catch {
      return { error: "Expected form body" };
    }
  }

  return { error: "Expected JSON or form body" };
}

function siteCandidatePaths(requested: string): string[] {
  const clean = requested.replace(/^\/+/, "");
  if (!clean) return ["index.html", "index.md"];
  if (extname(clean)) return [clean];
  return [clean, `${clean}.html`, `${clean}.md`, join(clean, "index.html"), join(clean, "index.md")];
}

function resolveSiteTarget(site: SiteRegistration, requested: string): { relativePath: string; target?: string } {
  const candidates = siteCandidatePaths(requested);
  const siteRoot = site.absDir.endsWith(sep) ? site.absDir : `${site.absDir}${sep}`;

  for (const relativePath of candidates) {
    const target = resolve(site.absDir, relativePath);
    if (target !== site.absDir && !target.startsWith(siteRoot)) continue;
    if (!existsSync(target) || !statSync(target).isFile()) continue;
    return { relativePath, target };
  }

  return { relativePath: candidates[0] || "index.md" };
}

function getTmuxSocket(): string {
  return execFileSync("bash", [join(BOSUN_PKG, "scripts", "tmux-socket.sh"), ROOT], { encoding: "utf-8" }).trim();
}

function tmux(args: string[]): string {
  const output = execFileSync("tmux", ["-S", getTmuxSocket(), ...args], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  return typeof output === "string" ? output.trim() : "";
}

function tmuxOk(args: string[]): boolean {
  try {
    tmux(args);
    return true;
  } catch {
    return false;
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function siteStateDir(site: SiteRegistration): string {
  return join(site.absDir, ".gateway");
}

function siteMessagesJsonPath(site: SiteRegistration): string {
  return join(siteStateDir(site), "messages.json");
}

function siteMessagesMarkdownPath(site: SiteRegistration): string {
  return join(siteStateDir(site), "messages.md");
}

function siteTerminalStatePath(site: SiteRegistration): string {
  return join(siteStateDir(site), "terminal-state.json");
}

function siteRepliesJsonPath(site: SiteRegistration): string {
  return join(siteStateDir(site), "replies.json");
}

function siteActionsJsonPath(site: SiteRegistration): string {
  return join(siteStateDir(site), "actions.json");
}

function siteInboxJsonPath(site: SiteRegistration): string {
  const configured = site.manifest?.runtime?.inboxFile;
  return configured ? resolve(site.absDir, configured) : join(siteStateDir(site), "inbox.json");
}

function siteOutboxJsonPath(site: SiteRegistration): string {
  const configured = site.manifest?.runtime?.outboxFile;
  return configured ? resolve(site.absDir, configured) : join(siteStateDir(site), "outbox.json");
}

function siteRuntimeStatePath(site: SiteRegistration): string {
  return join(siteStateDir(site), "agent-runtime-state.json");
}

function safeAgentSlug(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "agent";
}

function siteUsesPiAgentQueueRuntime(site: SiteRegistration): boolean {
  const command = site.manifest?.runtime?.command || "";
  return site.manifest?.runtime?.backend === "pi-agent" && command.includes("pi-agent-queue-runtime");
}

function siteManagedAgentSessionsFromManifest(site: SiteRegistration): string[] {
  if (!siteUsesPiAgentQueueRuntime(site)) return [];
  const prefix = siteSessionName(site) || "pi-site-agent";
  const sessions: string[] = [];

  const defaultAgent = site.manifest?.runtime?.agentName || site.manifest?.agent || "bosun";
  sessions.push(`${prefix}-${safeAgentSlug(defaultAgent)}`);

  const automationAgent = site.manifest?.runtime?.automationAgentName?.trim();
  if (automationAgent) sessions.push(`${prefix}-${safeAgentSlug(automationAgent)}`);

  for (const agentName of Object.values(site.manifest?.runtime?.actionAgents || {})) {
    const trimmed = agentName?.trim();
    if (trimmed) sessions.push(`${prefix}-${safeAgentSlug(trimmed)}`);
  }

  return Array.from(new Set(sessions));
}

function siteManagedAgentSessions(site: SiteRegistration): string[] {
  const fallback = siteManagedAgentSessionsFromManifest(site);
  const runtimeState = readJsonFile<SiteAgentRuntimeState>(siteRuntimeStatePath(site));
  const fromState = (runtimeState?.routes || [])
    .map((route) => route.tmuxSessionName?.trim())
    .filter((name): name is string => Boolean(name));

  return Array.from(new Set([...fallback, ...fromState]));
}

function stopManagedSiteAgentSessions(site: SiteRegistration): string[] {
  const hostSession = siteSessionName(site);
  const managed = siteManagedAgentSessions(site)
    .filter((session) => !hostSession || session !== hostSession);

  const killed: string[] = [];
  for (const session of managed) {
    if (!tmuxOk(["has-session", "-t", session])) continue;
    tmux(["kill-session", "-t", session]);
    killed.push(session);
  }

  return killed;
}

function ensureSiteStateDir(site: SiteRegistration): void {
  mkdirSync(siteStateDir(site), { recursive: true });
}

function resetSiteState(site: SiteRegistration): void {
  rmSync(siteStateDir(site), { recursive: true, force: true });
}

function readSiteMessages(site: SiteRegistration): SiteMessage[] {
  ensureSiteStateDir(site);
  return readJsonFile<SiteMessage[]>(siteMessagesJsonPath(site)) || [];
}

function dedupeMessages(messages: SiteMessage[]): SiteMessage[] {
  const deduped: SiteMessage[] = [];
  for (const message of messages) {
    const last = deduped[deduped.length - 1];
    if (last && last.role === message.role && last.source === message.source && last.content.trim() === message.content.trim()) {
      continue;
    }
    deduped.push(message);
  }
  return deduped;
}

function writeSiteMessages(site: SiteRegistration, messages: SiteMessage[]): void {
  ensureSiteStateDir(site);
  const deduped = dedupeMessages(messages);
  writeFileSync(siteMessagesJsonPath(site), `${JSON.stringify(deduped, null, 2)}\n`, "utf-8");
  const transcript = deduped.map((message) => {
    const heading = `## ${message.role} · ${message.ts}`;
    return `${heading}\n\n${message.content.trim()}\n`;
  }).join("\n");
  writeFileSync(siteMessagesMarkdownPath(site), `# Message Transcript\n\n${transcript}`, "utf-8");
}

function createMessage(
  role: SiteMessage["role"],
  content: string,
  source: SiteMessage["source"],
  metadata?: Pick<SiteMessage, "actorId" | "actorLogin" | "visibility">,
): SiteMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    ts: new Date().toISOString(),
    source,
    actorId: metadata?.actorId,
    actorLogin: metadata?.actorLogin,
    visibility: metadata?.visibility,
  };
}

function readSiteQueue(path: string): SiteMessage[] {
  return readJsonFile<SiteMessage[]>(path) || [];
}

function writeSiteQueue(path: string, messages: SiteMessage[]): void {
  writeFileSync(path, `${JSON.stringify(messages, null, 2)}\n`, "utf-8");
}

function readTerminalState(site: SiteRegistration): { lastCapture: string } {
  return readJsonFile<{ lastCapture: string }>(siteTerminalStatePath(site)) || { lastCapture: "" };
}

function readStructuredReplies(site: SiteRegistration): SiteMessage[] {
  return readJsonFile<SiteMessage[]>(siteRepliesJsonPath(site)) || [];
}

function writeStructuredReplies(site: SiteRegistration, messages: SiteMessage[]): void {
  ensureSiteStateDir(site);
  writeFileSync(siteRepliesJsonPath(site), `${JSON.stringify(messages, null, 2)}\n`, "utf-8");
}

function readSiteActions(site: SiteRegistration): SiteActionEvent[] {
  ensureSiteStateDir(site);
  return readJsonFile<SiteActionEvent[]>(siteActionsJsonPath(site)) || [];
}

function writeSiteActions(site: SiteRegistration, actions: SiteActionEvent[]): void {
  ensureSiteStateDir(site);
  writeFileSync(siteActionsJsonPath(site), `${JSON.stringify(actions, null, 2)}\n`, "utf-8");
}

function appendSiteAction(site: SiteRegistration, event: SiteActionEvent): SiteActionEvent[] {
  const actions = readSiteActions(site);
  actions.push(event);
  writeSiteActions(site, actions);
  return actions;
}

function writeTerminalState(site: SiteRegistration, state: { lastCapture: string }): void {
  ensureSiteStateDir(site);
  writeFileSync(siteTerminalStatePath(site), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function deriveTerminalReply(previous: string, current: string): string | undefined {
  const prev = previous.trimEnd();
  const next = current.trimEnd();
  if (!next || next === prev) return undefined;

  if (prev && next.startsWith(prev)) {
    const delta = next.slice(prev.length).trim();
    return delta || undefined;
  }

  const prevLines = prev ? prev.split("\n") : [];
  const nextLines = next.split("\n");
  let start = 0;
  while (start < prevLines.length && start < nextLines.length && prevLines[start] === nextLines[start]) {
    start += 1;
  }
  const deltaLines = nextLines.slice(start).map((line) => line.trimEnd()).filter(Boolean);
  return deltaLines.length > 0 ? deltaLines.join("\n") : undefined;
}

function ingestTmuxOutput(site: SiteRegistration): SiteMessage[] {
  const sessionName = siteSessionName(site);
  if (!sessionName || siteInputMode(site) !== "tmux" || !tmuxOk(["has-session", "-t", sessionName])) {
    return readSiteMessages(site);
  }

  const capture = tmux(["capture-pane", "-pt", sessionName, "-S", "-200"]);
  const terminalState = readTerminalState(site);
  const delta = deriveTerminalReply(terminalState.lastCapture, capture);
  writeTerminalState(site, { lastCapture: capture });
  if (!delta) return readSiteMessages(site);

  const messages = readSiteMessages(site);
  const last = messages[messages.length - 1];
  if (last?.source === "runtime" && last.content.trim() === delta.trim()) return messages;

  const recentUserInputs = new Set(
    messages
      .filter((message) => message.role === "user")
      .slice(-5)
      .map((message) => message.content.trim()),
  );

  const cleaned = delta
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[") && line !== "no pending user prompt")
    .filter((line) => !recentUserInputs.has(line))
    .join("\n")
    .trim();
  if (!cleaned) return messages;

  messages.push(createMessage("assistant", cleaned, "runtime", {
    actorId: last?.actorId,
    actorLogin: last?.actorLogin,
    visibility: last?.visibility,
  }));
  writeSiteMessages(site, messages);
  return messages;
}

function syncRuntimeOutbox(site: SiteRegistration): SiteMessage[] {
  ensureSiteStateDir(site);
  const outboxPath = siteOutboxJsonPath(site);
  const outbound = readSiteQueue(outboxPath);
  let messages = readSiteMessages(site);

  if (outbound.length > 0) {
    const existingIds = new Set(messages.map((message) => message.id));
    for (const message of outbound) {
      if (!existingIds.has(message.id)) messages.push(message);
    }
    writeSiteMessages(site, messages);
    writeSiteQueue(outboxPath, []);
    messages = readSiteMessages(site);
  }

  const structuredReplies = readStructuredReplies(site);
  if (structuredReplies.length > 0) {
    const existingIds = new Set(messages.map((message) => message.id));
    for (const message of structuredReplies) {
      if (!existingIds.has(message.id)) messages.push(message);
    }
    writeSiteMessages(site, messages);
    writeStructuredReplies(site, []);
    messages = readSiteMessages(site);
  }

  if (siteInputMode(site) === "tmux" && !site.manifest?.runtime?.framedReplies) {
    messages = ingestTmuxOutput(site);
  }

  return messages;
}

function queueRuntimeMessage(site: SiteRegistration, message: SiteMessage): void {
  ensureSiteStateDir(site);
  const inboxPath = siteInboxJsonPath(site);
  const pending = readSiteQueue(inboxPath);
  pending.push(message);
  writeSiteQueue(inboxPath, pending);
}

function listSiteMessages(
  site: SiteRegistration,
  viewer?: Pick<GatewayAuthzDecision, "actorId">,
  authModule?: SiteAuthModule,
): { messages: SiteMessage[]; transcriptPath: string } {
  const messages = syncRuntimeOutbox(site);
  return {
    messages: viewer?.actorId
      ? messages.filter((message) => canActorAccessVisibility(authModule, viewer.actorId, message.visibility, message.actorId))
      : messages,
    transcriptPath: siteMessagesMarkdownPath(site),
  };
}

function listSiteActions(
  site: SiteRegistration,
  viewer?: Pick<GatewayAuthzDecision, "actorId">,
  authModule?: SiteAuthModule,
): { actions: SiteActionEvent[]; actionsPath: string } {
  const actions = readSiteActions(site);
  return {
    actions: viewer?.actorId
      ? actions.filter((event) => canActorAccessVisibility(authModule, viewer.actorId, event.visibility, event.actorId))
      : actions,
    actionsPath: siteActionsJsonPath(site),
  };
}

function createSiteAction(action: string, source: SiteActionEvent["source"], options?: {
  target?: string;
  gesture?: string;
  scope?: string;
  payload?: Record<string, unknown>;
  status?: SiteActionEvent["status"];
  actorId?: string;
  actorLogin?: string;
  visibility?: string;
}): SiteActionEvent {
  return {
    id: crypto.randomUUID(),
    action,
    target: options?.target,
    gesture: options?.gesture,
    scope: options?.scope,
    payload: options?.payload,
    ts: new Date().toISOString(),
    status: options?.status || "pending",
    source,
    actorId: options?.actorId,
    actorLogin: options?.actorLogin,
    visibility: options?.visibility,
  };
}

function buildActionDispatchMessage(site: SiteRegistration, event: SiteActionEvent): string {
  return [
    `Site action for ${site.packageName}/${site.siteName}:`,
    JSON.stringify({
      type: "site-action",
      action: event.action,
      target: event.target || null,
      gesture: event.gesture || null,
      scope: event.scope || null,
      payload: event.payload || {},
      ts: event.ts,
      source: event.source,
      actorId: event.actorId || null,
      actorLogin: event.actorLogin || null,
      visibility: normalizeVisibility(event.visibility),
    }, null, 2),
    "Treat this as a structured browser event against the maintained website surface. Prefer updating or improving the site/workflow over answering generically when appropriate.",
  ].join("\n\n");
}

function dispatchSiteAction(site: SiteRegistration, event: SiteActionEvent): { event: SiteActionEvent; messages: SiteMessage[] } {
  const messages = syncRuntimeOutbox(site);
  const hasRuntime = Boolean((site.manifest?.runtime?.command || site.manifest?.runtime?.backend === "pi-agent") && siteSessionName(site));
  const runtimeRunning = Boolean(siteSessionName(site) && tmuxOk(["has-session", "-t", siteSessionName(site)!]));
  const dispatchContent = buildActionDispatchMessage(site, event);

  if (hasRuntime && runtimeRunning && siteInputMode(site) === "queue") {
    queueRuntimeMessage(site, createMessage("system", dispatchContent, "gateway", {
      actorId: event.actorId,
      actorLogin: event.actorLogin,
      visibility: event.visibility,
    }));
    event.status = "dispatched";
  } else if (hasRuntime && runtimeRunning && siteInputMode(site) === "tmux") {
    tmux(["send-keys", "-t", siteSessionName(site)!, dispatchContent, "Enter"]);
    event.status = "dispatched";
  } else {
    event.status = "failed";
    messages.push(createMessage("assistant", `Action '${event.action}' was captured, but no running site runtime was available to handle it.`, "gateway", {
      actorId: event.actorId,
      actorLogin: event.actorLogin,
      visibility: event.visibility,
    }));
    writeSiteMessages(site, messages);
  }

  return { event, messages: syncRuntimeOutbox(site) };
}

async function postSiteAction(site: SiteRegistration, req: Request, authz: GatewayAuthzDecision, authModule?: SiteAuthModule): Promise<{
  action: SiteActionEvent;
  actions: SiteActionEvent[];
  messages: SiteMessage[];
  actionsPath: string;
} | { error: string; status?: number }> {
  const parsed = await parseRequestBody(req);
  if (parsed.error) return { error: parsed.error, status: 400 };
  const body = parsed.body;

  const action = typeof body === "object" && body && "action" in body && typeof body.action === "string"
    ? body.action.trim()
    : "";
  if (!action) return { error: "Action name is required", status: 400 };

  const target = typeof body === "object" && body && "target" in body && typeof body.target === "string"
    ? body.target.trim() || undefined
    : undefined;
  const gesture = typeof body === "object" && body && "gesture" in body && typeof body.gesture === "string"
    ? body.gesture.trim() || undefined
    : undefined;
  const scope = typeof body === "object" && body && "scope" in body && typeof body.scope === "string"
    ? body.scope.trim() || undefined
    : undefined;
  let payload = typeof body === "object" && body && "payload" in body && body.payload && typeof body.payload === "object"
    ? body.payload as Record<string, unknown>
    : undefined;
  if (!payload && typeof body === "object" && body && "payload" in body && typeof body.payload === "string" && body.payload.trim()) {
    try {
      const parsedPayload = JSON.parse(body.payload) as unknown;
      if (parsedPayload && typeof parsedPayload === "object") payload = parsedPayload as Record<string, unknown>;
    } catch {
      payload = undefined;
    }
  }

  const event = createSiteAction(action, "browser", {
    target,
    gesture,
    scope,
    payload,
    actorId: authz.actorId,
    actorLogin: authz.actorLogin,
    visibility: normalizeVisibility(authz.visibility),
  });
  const messages = syncRuntimeOutbox(site);
  messages.push(createMessage("system", `Browser action: ${action}${target ? ` → ${target}` : ""}`, "gateway", {
    actorId: authz.actorId,
    actorLogin: authz.actorLogin,
    visibility: normalizeVisibility(authz.visibility),
  }));
  writeSiteMessages(site, messages);

  const dispatched = dispatchSiteAction(site, event);
  const actions = appendSiteAction(site, dispatched.event);

  return {
    action: dispatched.event,
    actions,
    messages: listSiteMessages(site, authz, authModule).messages,
    actionsPath: siteActionsJsonPath(site),
  };
}

async function postSiteMessage(site: SiteRegistration, req: Request, authz: GatewayAuthzDecision, authModule?: SiteAuthModule): Promise<{ messages: SiteMessage[]; added: SiteMessage[]; transcriptPath: string } | { error: string; status?: number }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: "Expected JSON body", status: 400 };
  }

  const content = typeof body === "object" && body && "content" in body && typeof body.content === "string"
    ? body.content.trim()
    : "";
  if (!content) return { error: "Message content is required", status: 400 };

  const messages = syncRuntimeOutbox(site);
  const added: SiteMessage[] = [];
  const userMessage = createMessage("user", content, "browser", {
    actorId: authz.actorId,
    actorLogin: authz.actorLogin,
    visibility: normalizeVisibility(authz.visibility),
  });
  messages.push(userMessage);
  added.push(userMessage);
  writeSiteMessages(site, messages);

  const hasRuntime = Boolean((site.manifest?.runtime?.command || site.manifest?.runtime?.backend === "pi-agent") && siteSessionName(site));
  const runtimeRunning = Boolean(siteSessionName(site) && tmuxOk(["has-session", "-t", siteSessionName(site)!]));

  if (hasRuntime && runtimeRunning && siteInputMode(site) === "queue") {
    queueRuntimeMessage(site, userMessage);
  } else if (hasRuntime && runtimeRunning && siteInputMode(site) === "tmux") {
    const sessionName = siteSessionName(site)!;
    tmux(["send-keys", "-t", sessionName, content, "Enter"]);
    const dispatched = createMessage("system", `Dispatched to tmux session ${sessionName}.`, "gateway", {
      actorId: authz.actorId,
      actorLogin: authz.actorLogin,
      visibility: normalizeVisibility(authz.visibility),
    });
    messages.push(dispatched);
    added.push(dispatched);
    writeSiteMessages(site, messages);
  } else {
    const assistantReply = createMessage(
      "assistant",
      [
        `Received for ${site.packageName}/${site.siteName}.`,
        site.manifest?.agent
          ? `Target agent: ${site.manifest.agent}.`
          : "No agent is bound yet.",
        hasRuntime
          ? "A runtime exists but is not currently running, so the gateway generated this placeholder reply."
          : "No site runtime command or pi-agent backend is configured yet.",
      ].join(" "),
      "gateway",
      {
        actorId: authz.actorId,
        actorLogin: authz.actorLogin,
        visibility: normalizeVisibility(authz.visibility),
      },
    );
    messages.push(assistantReply);
    added.push(assistantReply);
    writeSiteMessages(site, messages);
  }

  return {
    messages: listSiteMessages(site, authz, authModule).messages,
    added,
    transcriptPath: siteMessagesMarkdownPath(site),
  };
}

function siteSessionName(site: SiteRegistration): string | undefined {
  return site.manifest?.runtime?.sessionName;
}

function siteInputMode(site: SiteRegistration): "queue" | "tmux" {
  if (site.manifest?.runtime?.inputMode) return site.manifest.runtime.inputMode;
  if (site.manifest?.runtime?.backend === "pi-agent") return "tmux";
  return "queue";
}

function siteStatus(site: SiteRegistration) {
  const sessionName = siteSessionName(site);
  const backend = site.manifest?.runtime?.backend || "unbound";
  const hasControl = Boolean((site.manifest?.runtime?.command || backend === "pi-agent") && sessionName);
  const running = sessionName ? tmuxOk(["has-session", "-t", sessionName]) : false;
  const managedAgentSessions = siteManagedAgentSessions(site);
  const runningManagedAgentSessions = managedAgentSessions.filter((managedSession) => tmuxOk(["has-session", "-t", managedSession]));

  return {
    packageName: site.packageName,
    packageSlug: site.packageSlug,
    siteName: site.siteName,
    route: `/sites/${site.packageSlug}/${site.siteName}/`,
    agent: site.manifest?.agent || null,
    backend,
    sessionName: sessionName || null,
    meshName: site.manifest?.runtime?.meshName || null,
    inputMode: siteInputMode(site),
    running,
    hasControl,
    managedAgentSessions,
    runningManagedAgentSessions,
    runtimeStatePath: siteRuntimeStatePath(site),
  };
}

function siteLogs(site: SiteRegistration, lines: number): { sessionName: string; lines: string } | { error: string } {
  const sessionName = siteSessionName(site);
  if (!sessionName) return { error: "Site has no configured runtime.sessionName" };
  if (!tmuxOk(["has-session", "-t", sessionName])) return { error: `Session '${sessionName}' is not running` };

  try {
    const output = tmux(["capture-pane", "-pt", sessionName, "-S", `-${lines}`]);
    return { sessionName, lines: output };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to capture logs" };
  }
}

function keepAliveCommand(command: string): string {
  return `${command}; EXIT=$?; if [ $EXIT -ne 0 ]; then echo "=== PI EXITED ($EXIT) ==="; sleep 300; fi`;
}

function listSiteContextFiles(site: SiteRegistration): string[] {
  const configured = site.manifest?.runtime?.contextFiles;
  const defaults = ["index.md", "site.json"];
  const relPaths = (configured && configured.length > 0 ? configured : defaults)
    .map((value) => value.trim())
    .filter(Boolean);

  return relPaths.filter((relPath, index) => {
    if (relPaths.indexOf(relPath) !== index) return false;
    const absPath = resolve(site.absDir, relPath);
    return absPath === site.absDir || absPath.startsWith(`${site.absDir}${sep}`) ? existsSync(absPath) : false;
  });
}

function buildSiteMaintainerPrompt(site: SiteRegistration): string {
  const runtime = site.manifest?.runtime;
  const explicitPrompt = runtime?.prompt?.trim();
  if (runtime?.promptTemplate !== "site-maintainer") return explicitPrompt || "";

  const contextFiles = listSiteContextFiles(site);
  const intent = runtime?.maintainerIntent?.trim();
  const repoRelativeSiteDir = relative(ROOT, site.absDir) || ".";
  const packageSpecific = site.packageName === "pi-q"
    ? "Because this is pi-q, use Q's real operating model: tasks, projects, roadmaps, blockers, recent updates, and suggested next actions. Prefer using qt / qp / qr rather than ad-hoc file globbing when working with Q data."
    : "Maintain the site's package-specific workflow and present the most useful entry points, views, and meaningful actions for the user.";

  const sections = [
    `You are the site maintainer for ${site.packageName}/${site.siteName}.`,
    "This is not just a chat surface. You are responsible for maintaining and improving the website the user interacts with.",
    `Treat ${repoRelativeSiteDir} as an owned interface surface (absolute path: ${site.absDir}). You may edit templates, components, assets, markdown, JSON sidecars, and other site-owned files to make the experience more useful, legible, and action-oriented.`,
    `Your current working directory is the repo root: ${ROOT}. Prefer repo-relative tool paths like ${repoRelativeSiteDir}/index.md or workspace/... . Do not prefix repo-relative paths with workspace/code/... or repeat the repo root inside the path.`,
    "Prefer improving the site and its flows over relying on repeated generic chat when the user is interacting with the same workflow repeatedly.",
    "Ordinary browsing is navigation. Reserve structured or audited actions for meaningful product intents.",
    "The browser is not a mesh peer. The gateway hosts the site and mediates browser interactions for you.",
    packageSpecific,
  ];

  if (intent) sections.push(`Site intent: ${intent}`);
  if (contextFiles.length > 0) {
    sections.push(`Primary site files:\n${contextFiles.map((file) => `- ${file}`).join("\n")}`);
  }
  sections.push("When working on this site, keep the primary entry page useful, welcoming, and action-oriented, leading into more detailed views.");

  if (explicitPrompt) {
    sections.push(`Additional launch instructions:\n${explicitPrompt}`);
  }

  return sections.join("\n\n");
}

function buildPiAgentRuntimeCommand(site: SiteRegistration, sessionName: string): string {
  const agentName = site.manifest?.runtime?.agentName || site.manifest?.agent || "bosun";
  const prompt = buildSiteMaintainerPrompt(site);
  const args = ["pi"];
  if (prompt) args.push(prompt);
  const env = [
    `PI_CODING_AGENT_DIR=${shellEscape(join(ROOT, ".bosun-home", ".pi", "agent"))}`,
    `PI_AGENT=${shellEscape(agentName)}`,
    `PI_AGENT_NAME=${shellEscape(sessionName)}`,
    ...buildSiteRuntimeEnv(site, sessionName),
  ];
  return keepAliveCommand(`cd ${shellEscape(ROOT)} && ${env.join(" ")} ${args.map(shellEscape).join(" ")}`);
}

function buildSiteRuntimeEnv(site: SiteRegistration, sessionName: string): string[] {
  const prompt = buildSiteMaintainerPrompt(site);
  const agentName = site.manifest?.runtime?.agentName || site.manifest?.agent || "bosun";
  const automationAgentName = site.manifest?.runtime?.automationAgentName || "";
  const automationActions = site.manifest?.runtime?.automationActions?.join(",") || "";
  const actionAgents = JSON.stringify(site.manifest?.runtime?.actionAgents || {});
  return [
    `BOSUN_ROOT=${shellEscape(ROOT)}`,
    `BOSUN_PKG=${shellEscape(BOSUN_PKG)}`,
    `BOSUN_WORKSPACE=${shellEscape(join(ROOT, "workspace"))}`,
    `PI_SITE_PACKAGE=${shellEscape(site.packageName)}`,
    `PI_SITE_PACKAGE_SLUG=${shellEscape(site.packageSlug)}`,
    `PI_SITE_NAME=${shellEscape(site.siteName)}`,
    `PI_SITE_DIR=${shellEscape(site.absDir)}`,
    `PI_SITE_STATE_DIR=${shellEscape(siteStateDir(site))}`,
    `PI_SITE_SESSION_NAME=${shellEscape(sessionName)}`,
    `PI_SITE_AGENT_NAME=${shellEscape(agentName)}`,
    `PI_SITE_AUTOMATION_AGENT_NAME=${shellEscape(automationAgentName)}`,
    `PI_SITE_AUTOMATION_ACTIONS=${shellEscape(automationActions)}`,
    `PI_SITE_ACTION_AGENTS=${shellEscape(actionAgents)}`,
    `PI_SITE_SYSTEM_PROMPT=${shellEscape(prompt)}`,
    `PI_SITE_INBOX_FILE=${shellEscape(siteInboxJsonPath(site))}`,
    `PI_SITE_OUTBOX_FILE=${shellEscape(siteOutboxJsonPath(site))}`,
    `PI_SITE_REPLIES_FILE=${shellEscape(siteRepliesJsonPath(site))}`,
    `PI_SITE_TRANSCRIPT_FILE=${shellEscape(siteMessagesMarkdownPath(site))}`,
  ];
}

function buildSiteRuntimeCommand(site: SiteRegistration, sessionName: string): string | undefined {
  const command = site.manifest?.runtime?.command;
  if (command) {
    const env = buildSiteRuntimeEnv(site, sessionName);
    const exports = env.map((assignment) => `export ${assignment};`).join(" ");
    return `/bin/sh -lc ${shellEscape(`cd ${shellEscape(ROOT)} && ${exports} ${command}`)}`;
  }
  if (site.manifest?.runtime?.backend === "pi-agent") {
    return buildPiAgentRuntimeCommand(site, sessionName);
  }
  return undefined;
}

function startSite(site: SiteRegistration): { ok: true; sessionName: string } | { error: string; status?: number } {
  const sessionName = siteSessionName(site);
  const command = sessionName ? buildSiteRuntimeCommand(site, sessionName) : undefined;
  if (!sessionName) return { error: "Site has no configured runtime.sessionName", status: 400 };
  if (!command) return { error: "Site has no configured runtime.command or pi-agent backend", status: 501 };
  if (tmuxOk(["has-session", "-t", sessionName])) return { ok: true, sessionName };

  try {
    if (site.manifest?.runtime?.resetOnStart) {
      stopManagedSiteAgentSessions(site);
      resetSiteState(site);
    }
    if (tmuxOk(["has-session"])) {
      tmux(["new-session", "-d", "-s", sessionName, "-n", site.siteName, command]);
    } else {
      execFileSync(join(BOSUN_PKG, "scripts", "sandbox.sh"), [
        "tmux", "-S", getTmuxSocket(), "-f", join(BOSUN_PKG, "config", "tmux.conf"),
        "new-session", "-d", "-s", sessionName, "-n", site.siteName, command,
      ], { stdio: "pipe" });
      tmux(["set-environment", "-g", "BOSUN_SANDBOX_VERSION", "2"]);
    }
    tmux(["set-environment", "-g", "BOSUN_ROOT", ROOT]);
    return { ok: true, sessionName };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to start site runtime", status: 500 };
  }
}

function stopSite(site: SiteRegistration): { ok: true; sessionName: string } | { error: string; status?: number } {
  const sessionName = siteSessionName(site);
  if (!sessionName) return { error: "Site has no configured runtime.sessionName", status: 400 };

  try {
    stopManagedSiteAgentSessions(site);
    if (tmuxOk(["has-session", "-t", sessionName])) {
      tmux(["kill-session", "-t", sessionName]);
    }
    return { ok: true, sessionName };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to stop site runtime", status: 500 };
  }
}

function siteEventStream(site: SiteRegistration, viewer?: Pick<GatewayAuthzDecision, "actorId">, authModule?: SiteAuthModule): Response {
  let interval: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = () => {
        const payload = {
          site: siteStatus(site),
          logs: siteLogs(site, 80),
          messages: listSiteMessages(site, viewer, authModule),
          actions: listSiteActions(site, viewer, authModule),
          ts: new Date().toISOString(),
        };
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      controller.enqueue(encoder.encode(`retry: 2000\n\n`));
      send();
      interval = setInterval(send, 2000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function findSiteByRoute(sites: SiteRegistration[], packageSlug: string, siteName: string): SiteRegistration | undefined {
  return sites.find((site) => site.packageSlug === packageSlug && site.siteName === siteName);
}

async function serveSiteAsset(req: Request, url: URL, sites: SiteRegistration[]): Promise<Response | undefined> {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "sites") return undefined;

  const [, packageSlug, siteName, ...rest] = parts;
  const site = sites.find((s) => s.packageSlug === packageSlug && s.siteName === siteName);
  if (!site) return new Response("Site not found", { status: 404 });

  const requested = rest.join("/");
  const resolved = resolveSiteTarget(site, requested);
  const relativePath = resolved.relativePath;
  const authz = await authorizeSiteRequest(site, req, {
    resource: "site",
    operation: "view",
    path: relativePath,
  });
  if (!authz.ok) return new Response(authz.error || "Forbidden", { status: authz.status || 403 });

  const target = resolved.target;
  if (!target) {
    return new Response("Not found", { status: 404 });
  }

  if (extname(target).toLowerCase() === ".md" && url.searchParams.get("raw") !== "1") {
    const markdown = readFileSync(target, "utf-8");
    return new Response(renderMarkdownDocument(site, markdown, relative(site.absDir, target)), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response(Bun.file(target), {
    headers: { "content-type": contentType(target) },
  });
}

const config = loadConfig();

if (!config.enabled) {
  console.error("pi-gateway is disabled (.pi/pi-gateway.json has enabled=false).");
  process.exit(1);
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);
    const sites = discoverSites();

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "pi-gateway",
        host: config.host,
        port: config.port,
        sites: sites.length,
      });
    }

    if (url.pathname === "/api/sites") {
      return Response.json({
        sites: sites.map((site) => ({
          ...siteStatus(site),
          dir: site.dir,
          absDir: site.absDir,
          manifest: site.manifest || null,
          messages: {
            count: listSiteMessages(site).messages.length,
            transcriptPath: siteMessagesMarkdownPath(site),
            inboxPath: siteInboxJsonPath(site),
            outboxPath: siteOutboxJsonPath(site),
            repliesPath: siteRepliesJsonPath(site),
            terminalStatePath: siteTerminalStatePath(site),
            runtimeStatePath: siteRuntimeStatePath(site),
          },
          actions: {
            count: listSiteActions(site).actions.length,
            actionsPath: siteActionsJsonPath(site),
          },
          runtimeContract: {
            framedReplies: site.manifest?.runtime?.framedReplies ?? false,
            resetOnStart: site.manifest?.runtime?.resetOnStart ?? false,
            promptTemplate: site.manifest?.runtime?.promptTemplate || null,
            maintainerIntent: site.manifest?.runtime?.maintainerIntent || null,
            contextFiles: listSiteContextFiles(site),
            env: {
              BOSUN_ROOT: ROOT,
              BOSUN_PKG,
              PI_SITE_NAME: site.siteName,
              PI_SITE_DIR: site.absDir,
              PI_SITE_STATE_DIR: siteStateDir(site),
              PI_SITE_INBOX_FILE: siteInboxJsonPath(site),
              PI_SITE_OUTBOX_FILE: siteOutboxJsonPath(site),
              PI_SITE_REPLIES_FILE: siteRepliesJsonPath(site),
              PI_SITE_TRANSCRIPT_FILE: siteMessagesMarkdownPath(site),
            },
          },
          api: {
            status: `/api/sites/${site.packageSlug}/${site.siteName}/status`,
            logs: `/api/sites/${site.packageSlug}/${site.siteName}/logs`,
            messages: `/api/sites/${site.packageSlug}/${site.siteName}/messages`,
            actions: `/api/sites/${site.packageSlug}/${site.siteName}/actions`,
            start: `/api/sites/${site.packageSlug}/${site.siteName}/start`,
            stop: `/api/sites/${site.packageSlug}/${site.siteName}/stop`,
            restart: `/api/sites/${site.packageSlug}/${site.siteName}/restart`,
            reset: `/api/sites/${site.packageSlug}/${site.siteName}/reset`,
            events: `/api/sites/${site.packageSlug}/${site.siteName}/events`,
          },
        })),
      });
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "api" && parts[1] === "sites" && parts.length >= 4) {
      const [, , packageSlug, siteName, action] = parts;
      const site = findSiteByRoute(sites, packageSlug, siteName);
      if (!site) return Response.json({ error: "Site not found" }, { status: 404 });

      let authBody: unknown;
      if (req.method === "POST" && (action === "messages" || action === "actions")) {
        try {
          authBody = await req.clone().json();
        } catch {
          authBody = undefined;
        }
      }

      const access: GatewayAccessRequest | undefined = !action || action === "status"
        ? { resource: "status", operation: "view" }
        : action === "logs"
          ? { resource: "logs", operation: "view" }
          : action === "events"
            ? { resource: "events", operation: "view" }
            : action === "messages" && req.method === "GET"
              ? { resource: "messages", operation: "view" }
              : action === "messages" && req.method === "POST"
                ? { resource: "messages", operation: "interact", body: authBody }
                : action === "actions" && req.method === "GET"
                  ? { resource: "actions", operation: "view" }
                  : action === "actions" && req.method === "POST"
                    ? { resource: "actions", operation: "interact", body: authBody }
                    : ["start", "stop", "restart", "reset"].includes(action || "") && req.method === "POST"
                      ? { resource: "control", operation: "admin" }
                      : undefined;

      if (access) {
        const authz = await authorizeSiteRequest(site, req, access);
        if (!authz.ok) {
          return Response.json({ error: authz.error || "Forbidden" }, { status: authz.status || 403 });
        }
        const authModule = await loadSiteAuthModule(site);

        if (!action || action === "status") {
          return Response.json({ site: siteStatus(site) });
        }

        if (action === "logs") {
          const lines = Math.max(1, Math.min(1000, Number(url.searchParams.get("lines") || "200")));
          const result = siteLogs(site, lines);
          if ("error" in result) return Response.json(result, { status: 400 });
          return Response.json(result);
        }

        if (action === "events") {
          return siteEventStream(site, authz, authModule);
        }

        if (action === "messages" && req.method === "GET") {
          return Response.json(listSiteMessages(site, authz, authModule));
        }

        if (action === "messages" && req.method === "POST") {
          const result = await postSiteMessage(site, req, authz, authModule);
          if ("error" in result) return Response.json(result, { status: result.status || 500 });
          return Response.json(result);
        }

        if (action === "actions" && req.method === "GET") {
          return Response.json(listSiteActions(site, authz, authModule));
        }

        if (action === "actions" && req.method === "POST") {
          const result = await postSiteAction(site, req, authz, authModule);
          if ("error" in result) {
            if (isHxRequest(req)) {
              return new Response(renderSiteActionErrorFragment(result.error), {
                status: result.status || 500,
                headers: { "content-type": "text/html; charset=utf-8" },
              });
            }
            return Response.json(result, { status: result.status || 500 });
          }
          if (isHxRequest(req)) {
            return new Response(renderSiteActionResultFragment(result.action), {
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }
          return Response.json(result);
        }

        if (action === "start" && req.method === "POST") {
          const result = startSite(site);
          if ("error" in result) return Response.json(result, { status: result.status || 500 });
          return Response.json(result);
        }

        if (action === "stop" && req.method === "POST") {
          const result = stopSite(site);
          if ("error" in result) return Response.json(result, { status: result.status || 500 });
          return Response.json(result);
        }

        if (action === "restart" && req.method === "POST") {
          const stopped = stopSite(site);
          if ("error" in stopped) return Response.json(stopped, { status: stopped.status || 500 });
          const started = startSite(site);
          if ("error" in started) return Response.json(started, { status: started.status || 500 });
          return Response.json(started);
        }

        if (action === "reset" && req.method === "POST") {
          stopManagedSiteAgentSessions(site);
          resetSiteState(site);
          return Response.json({ ok: true, reset: true, stateDir: siteStateDir(site) });
        }
      }

      return Response.json({ error: "Unsupported site API route" }, { status: 404 });
    }

    const asset = await serveSiteAsset(req, url, sites);
    if (asset) return asset;

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(htmlPage(sites, config), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`pi-gateway listening on http://${server.hostname}:${server.port}`);
