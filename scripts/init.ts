#!/usr/bin/env bun
/**
 * Bosun Init — Generate .pi/*.json config files from config.toml.
 *
 * Each package reads its own .pi/<name>.json. This script generates
 * them all from a single config.toml source of truth.
 *
 * Usage:
 *   bun scripts/init.ts
 *   just init
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseToml } from "@iarna/toml";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, "config.toml");

if (!existsSync(CONFIG_PATH)) {
  console.error("Error: config.toml not found");
  console.error("Run: just onboard");
  process.exit(1);
}

const configContent = readFileSync(CONFIG_PATH, "utf-8");
const config = parseToml(configContent) as Record<string, unknown>;

console.log("Loaded config.toml");

const piDir = join(ROOT, ".pi");
mkdirSync(piDir, { recursive: true });

function writeJson(name: string, data: unknown): void {
  const path = join(piDir, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`  Generated .pi/${name}`);
}

// --- settings.json ---
// Auto-discover local packages that have a "pi" key in package.json
import { readdirSync } from "node:fs";

const packagesDir = join(ROOT, "packages");
const localPackages: string[] = readdirSync(packagesDir)
  .filter((d) => {
    const pkgPath = join(packagesDir, d, "package.json");
    if (!existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return !!pkg.pi;
    } catch {
      return false;
    }
  })
  .sort();

// npm packages (not in packages/) — discovered from root package.json dependencies
// that aren't workspace:* references
const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const npmPackages: string[] = Object.entries(rootPkg.dependencies || {})
  .filter(([name, version]) =>
    typeof version === "string" &&
    !version.startsWith("workspace:") &&
    !name.startsWith("@") // skip scoped deps like @mariozechner/pi-coding-agent, @tobilu/qmd
  )
  .map(([name]) => name)
  .sort();

// Paths in settings.json are resolved relative to .pi/ (where the file lives),
// so we need "../packages/" to reach the packages directory.
writeJson("settings.json", {
  packages: [
    ...localPackages.map((p) => `../packages/${p}`),
    ...npmPackages.map((p) => `npm:${p}`),
  ],
});

// --- agents.json ---
const models = (config.models as Record<string, string>) || {};
const agents = (config.agents as Record<string, unknown>) || {};
const backend = (config.backend as Record<string, unknown>) || {};

writeJson("agents.json", {
  models: {
    lite: models.lite || "claude-haiku-4-5-20251001",
    medium: models.medium || "claude-sonnet-4-5-20250929",
    high: models.high || "claude-opus-4-6",
    oracle: models.oracle || "gpt-5.3-codex",
  },
  defaultAgent: agents.default_agent || "bosun",
  agentPaths: [
    ...(Array.isArray(agents.extra_paths) ? agents.extra_paths : []),
    "./packages/pi-q/agents",
  ],
  backend: {
    type: backend.type || "tmux",
    socket: backend.socket || ".bosun-home/tmux.sock",
    command_prefix: backend.command_prefix || "scripts/sandbox.sh",
  },
});

// --- daemon.json ---
// Workflows are auto-discovered from packages/*/workflows/, .pi/workflows/,
// and workspace/workflows/. daemon.json only needs basic settings.
const daemon = (config.daemon as Record<string, unknown>) || {};

writeJson("daemon.json", {
  enabled: daemon.enabled ?? true,
  heartbeat_interval_seconds: daemon.heartbeat_interval_seconds || 60,
  state_dir: ".bosun-daemon",
  log_level: daemon.log_level || "info",
});

// --- sandbox.json ---
const sandbox = (config.sandbox as Record<string, unknown>) || {};
const filesystem = (sandbox.filesystem as Record<string, unknown>) || {};

writeJson("sandbox.json", {
  enabled: sandbox.enabled ?? true,
  filesystem: {
    denyRead: (filesystem.deny_read as string[]) || ["~/.ssh", "~/.aws", "~/.gnupg"],
    allowWrite: (filesystem.allow_write as string[]) || [".", "/tmp"],
    denyWrite: (filesystem.deny_write as string[]) || [".env", ".env.*", "*.pem", "*.key"],
  },
});

// --- bwrap.json ---
const env = (config.env as Record<string, unknown>) || {};
const paths = (config.paths as Record<string, unknown>) || {};

writeJson("bwrap.json", {
  env_allow: (env.allowed as string[]) || [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "PERPLEXITY_API_KEY",
    "OPENROUTER_API_KEY",
    "USER",
    "LOGNAME",
    "TERM",
    "COLORTERM",
    "LANG",
    "TZ",
  ],
  ro_bind: (paths.ro_bind as string[]) || [],
  workspace: (config.workspace as Record<string, unknown>)?.path || "workspace",
});

// --- pi-mesh.json ---
const mesh = (config.mesh as Record<string, unknown>) || {};

writeJson("pi-mesh.json", {
  autoRegister: mesh.auto_register ?? true,
  contextMode: mesh.context_mode || "full",
  feedRetention: mesh.feed_retention ?? 50,
  autoStatus: mesh.auto_status ?? true,
});

// --- pi-q.json ---
const q = (config.q as Record<string, unknown>) || {};

writeJson("pi-q.json", {
  data_dir: q.data_dir || "workspace/users",
});

// --- web-search.json (pi-web-access) ---
// This goes in HOME/.pi/ (not project .pi/) since pi-web-access reads from ~/.pi/
const webAccess = (config.web_access as Record<string, unknown>) || {};
const webSearchConfig: Record<string, unknown> = {};
if (webAccess.perplexity_api_key) webSearchConfig.perplexityApiKey = webAccess.perplexity_api_key;
if (webAccess.gemini_api_key) webSearchConfig.geminiApiKey = webAccess.gemini_api_key;
if (webAccess.provider) webSearchConfig.provider = webAccess.provider;
if (webAccess.curate_window !== undefined) webSearchConfig.curateWindow = webAccess.curate_window;
if (webAccess.auto_filter !== undefined) webSearchConfig.autoFilter = webAccess.auto_filter;
// GitHub clone settings
const githubClone = (webAccess.github_clone as Record<string, unknown>) || {};
if (Object.keys(githubClone).length > 0) {
  webSearchConfig.githubClone = {
    enabled: githubClone.enabled ?? true,
    maxRepoSizeMB: githubClone.max_repo_size_mb || 350,
    cloneTimeoutSeconds: githubClone.clone_timeout_seconds || 30,
    clonePath: githubClone.clone_path || "/tmp/pi-github-repos",
  };
}
// YouTube settings
const youtube = (webAccess.youtube as Record<string, unknown>) || {};
if (Object.keys(youtube).length > 0) {
  webSearchConfig.youtube = {
    enabled: youtube.enabled ?? true,
    preferredModel: youtube.preferred_model || "gemini-3-flash-preview",
  };
}
// Video settings
const video = (webAccess.video as Record<string, unknown>) || {};
if (Object.keys(video).length > 0) {
  webSearchConfig.video = {
    enabled: video.enabled ?? true,
    preferredModel: video.preferred_model || "gemini-3-flash-preview",
    maxSizeMB: video.max_size_mb || 50,
  };
}

const homeDir = process.env.HOME || join(ROOT, ".bosun-home");
const homePiDir = join(homeDir, ".pi");
mkdirSync(homePiDir, { recursive: true });
const webSearchPath = join(homePiDir, "web-search.json");
writeFileSync(webSearchPath, JSON.stringify(webSearchConfig, null, 2) + "\n");
console.log(`  Generated ~/.pi/web-search.json`);

// --- keybindings.json (Pi TUI keybinding overrides) ---
const keybindings = (config.keybindings as Record<string, unknown>) || {};
if (Object.keys(keybindings).length > 0) {
  const agentDir = join(homePiDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const keybindingsPath = join(agentDir, "keybindings.json");
  writeFileSync(keybindingsPath, JSON.stringify(keybindings, null, 2) + "\n");
  console.log(`  Generated ~/.pi/agent/keybindings.json`);
}

console.log("\nInit complete. Generated config files.");
