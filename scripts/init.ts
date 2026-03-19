#!/usr/bin/env bun
/**
 * Bosun Init — Generate .pi/*.json config files from config.toml.
 *
 * Each package reads its own .pi/<name>.json. This script generates
 * them all from a single config.toml source of truth.
 *
 * Supports two modes:
 *   Local — running inside the bosun repo (packages/ at root)
 *   Dependency — bosun installed via bun add (packages at node_modules/bosun/packages/)
 *
 * Usage:
 *   bun scripts/init.ts
 *   just init
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { parse as parseToml } from "@iarna/toml";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, "config.toml");

// Detect mode: is bosun a dependency (node_modules/bosun/) or are we inside the bosun repo?
const bosunDepDir = join(ROOT, "node_modules", "bosun");
const isDependencyMode = existsSync(join(bosunDepDir, "packages")) && !existsSync(join(ROOT, "packages", "pi-bosun", "package.json"));

// Resolve the bosun packages directory
const bosunPackagesDir = isDependencyMode ? join(bosunDepDir, "packages") : null;

// Import memory defaults — resolve relative to this script's location (works in both modes)
const { DEFAULT_MEMORY_COLLECTIONS, DEFAULT_MEMORY_CONFIG } = await import(
  join(dirname(import.meta.url.replace("file://", "")), "..", "packages", "pi-memory", "src", "defaults.js")
);

if (!existsSync(CONFIG_PATH)) {
  console.error("Error: config.toml not found");
  console.error("Run: just onboard");
  process.exit(1);
}

const configContent = readFileSync(CONFIG_PATH, "utf-8");
const configHash = createHash("sha256").update(configContent).digest("hex");
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
// Auto-discover packages that have a "pi" key in package.json
import { readdirSync } from "node:fs";

/** Scan a directory for pi-packages (dirs with package.json containing "pi" key). */
function discoverPiPackages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => {
      const pkgPath = join(dir, d, "package.json");
      if (!existsSync(pkgPath)) return false;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return !!pkg.pi;
      } catch {
        return false;
      }
    })
    .sort();
}

// Local packages (in project's packages/ directory)
const packagesDir = join(ROOT, "packages");
const localPackages = discoverPiPackages(packagesDir);

// Bosun dependency packages (when bosun is installed as a dep)
const bosunPackages = bosunPackagesDir ? discoverPiPackages(bosunPackagesDir) : [];
// Filter out any that overlap with local packages (local wins)
const localNames = new Set(localPackages);
const filteredBosunPackages = bosunPackages.filter((p) => !localNames.has(p));

// npm packages — discovered from root package.json dependencies
// In dependency mode, also include bosun's own npm deps that are pi-packages
const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const npmPackages: string[] = Object.entries(rootPkg.dependencies || {})
  .filter(([name, version]) =>
    typeof version === "string" &&
    !version.startsWith("workspace:") &&
    !name.startsWith("@") && // skip scoped deps
    name !== "bosun" // skip bosun itself (it's the framework, not a pi-package)
  )
  .map(([name, version]) => `${name}@${version}`)
  .sort();

// In dependency mode, also discover npm pi-packages from bosun's dependencies
// that got hoisted to the project's node_modules/
if (isDependencyMode) {
  const bosunPkg = JSON.parse(readFileSync(join(bosunDepDir, "package.json"), "utf-8"));
  const bosunNpmDeps = Object.entries(bosunPkg.dependencies || {})
    .filter(([name, version]) =>
      typeof version === "string" &&
      !version.startsWith("workspace:") &&
      !name.startsWith("@") &&
      !npmPackages.some((p) => p.startsWith(`${name}@`)) // not already in project deps
    );
  for (const [name, version] of bosunNpmDeps) {
    // Check if it's actually a pi-package (has "pi" key)
    const nmPath = join(ROOT, "node_modules", name, "package.json");
    if (existsSync(nmPath)) {
      try {
        const pkg = JSON.parse(readFileSync(nmPath, "utf-8"));
        if (pkg.pi) {
          npmPackages.push(`${name}@${version}`);
        }
      } catch { /* skip */ }
    }
  }
  npmPackages.sort();
}

// Skills paths — resolve relative to .pi/ (where settings.json lives)
const skillsPaths: string[] = [];
// Local project skills
const localSkillsDir = join(ROOT, "skills");
if (existsSync(localSkillsDir)) {
  skillsPaths.push("../skills");
}
// Bosun dependency skills
if (isDependencyMode && existsSync(join(bosunDepDir, "skills"))) {
  skillsPaths.push("../node_modules/bosun/skills");
}

// Paths in settings.json are resolved relative to .pi/ (where the file lives),
// so we need "../packages/" or "../node_modules/bosun/packages/" to reach them.
writeJson("settings.json", {
  _configHash: configHash,
  packages: [
    ...localPackages.map((p) => `../packages/${p}`),
    ...filteredBosunPackages.map((p) => `../node_modules/bosun/packages/${p}`),
    ...npmPackages.map((p) => `npm:${p}`),
  ],
  ...(skillsPaths.length > 0 ? { skills: skillsPaths } : {}),
});

// --- agents.json ---
const models = (config.models as Record<string, string>) || {};
const agents = (config.agents as Record<string, unknown>) || {};
const backend = (config.backend as Record<string, unknown>) || {};

writeJson("agents.json", {
  models: {
    lite: models.lite || "claude-haiku-4-5-20251001",
    medium: models.medium || "claude-sonnet-4-6",
    high: models.high || "claude-opus-4-6",
    oracle: models.oracle || "gpt-5.3-codex",
  },
  defaultAgent: agents.default_agent || "bosun",
  agentPaths: [
    ...(Array.isArray(agents.extra_paths) ? agents.extra_paths : []),
    ...(isDependencyMode
      ? [
          "./node_modules/bosun/packages/pi-bosun/agents",
          "./node_modules/bosun/packages/pi-q/agents",
          "./node_modules/bosun/packages/pi-chronicles/agents",
        ]
      : [
          "./packages/pi-bosun/agents",
          "./packages/pi-q/agents",
          "./packages/pi-chronicles/agents",
        ]),
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

// --- pi-auto-resume.json ---
const autoResume = (config.auto_resume as Record<string, unknown>) || {};

writeJson("pi-auto-resume.json", {
  enabled: autoResume.enabled ?? true,
  cooldownSeconds: autoResume.cooldown_seconds ?? 60,
  message:
    typeof autoResume.message === "string" && (autoResume.message as string).trim()
      ? autoResume.message
      : "Continue where you left off. If the previous task is complete or you need clarification, just ask.",
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
  rw_bind: (paths.rw_bind as string[]) || [],
  workspace: (config.workspace as Record<string, unknown>)?.path || "workspace",
});

// --- pi-mesh.json ---
const mesh = (config.mesh as Record<string, unknown>) || {};
const meshIdentitySync = (mesh.identity_sync as Record<string, unknown>) || {};

writeJson("pi-mesh.json", {
  autoRegister: mesh.auto_register ?? true,
  contextMode: mesh.context_mode || "full",
  feedRetention: mesh.feed_retention ?? 50,
  autoStatus: mesh.auto_status ?? true,
  hooksModule: "./packages/pi-agents/extensions/mesh-identity-sync.ts",
  identitySync: {
    enabled: meshIdentitySync.enabled ?? true,
    startupAlign: meshIdentitySync.startup_align ?? true,
    meshToTmux: meshIdentitySync.mesh_to_tmux ?? true,
    tmuxToMesh: meshIdentitySync.tmux_to_mesh ?? true,
    pollIntervalMs: meshIdentitySync.poll_interval_ms ?? 2000,
  },
});

// --- pi-q.json ---
const q = (config.q as Record<string, unknown>) || {};

writeJson("pi-q.json", {
  data_dir: q.data_dir || "workspace/users",
});

// --- pi-memory.json ---
const memory = (config.memory as Record<string, unknown>) || {};
const memoryCollections = (memory.collections as Record<string, unknown>) || {};

const mergedMemoryCollections = {
  ...DEFAULT_MEMORY_COLLECTIONS,
  ...Object.fromEntries(
    Object.entries(memoryCollections)
      .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
      .map(([name, value]) => {
        const collection = value as Record<string, unknown>;
        const {
          include_by_default: includeByDefaultSnake,
          includeByDefault: includeByDefaultCamel,
          ...rest
        } = collection;
        return [
          name,
          {
            ...(DEFAULT_MEMORY_COLLECTIONS[name] || {}),
            ...rest,
            includeByDefault: includeByDefaultSnake ?? includeByDefaultCamel ?? (DEFAULT_MEMORY_COLLECTIONS[name] || {}).includeByDefault,
          },
        ];
      }),
  ),
};

writeJson("pi-memory.json", {
  enabled: memory.enabled ?? DEFAULT_MEMORY_CONFIG.enabled,
  dbPath: memory.db_path || DEFAULT_MEMORY_CONFIG.dbPath,
  autoUpdateOnOpen: memory.auto_update_on_open ?? DEFAULT_MEMORY_CONFIG.autoUpdateOnOpen,
  defaultMode: memory.default_mode === "hybrid" ? "hybrid" : DEFAULT_MEMORY_CONFIG.defaultMode,
  defaultLimit: memory.default_limit || DEFAULT_MEMORY_CONFIG.defaultLimit,
  globalContext: memory.global_context,
  searchDefaults: {
    minScore: (memory.search_defaults as Record<string, unknown> | undefined)?.min_score ?? DEFAULT_MEMORY_CONFIG.searchDefaults.minScore,
    rerank: (memory.search_defaults as Record<string, unknown> | undefined)?.rerank ?? DEFAULT_MEMORY_CONFIG.searchDefaults.rerank,
  },
  formatting: {
    snippetMaxLines: (memory.formatting as Record<string, unknown> | undefined)?.snippet_max_lines || DEFAULT_MEMORY_CONFIG.formatting.snippetMaxLines,
    multiGetMaxBytes: (memory.formatting as Record<string, unknown> | undefined)?.multi_get_max_bytes || DEFAULT_MEMORY_CONFIG.formatting.multiGetMaxBytes,
    defaultGetMaxLines: (memory.formatting as Record<string, unknown> | undefined)?.default_get_max_lines || DEFAULT_MEMORY_CONFIG.formatting.defaultGetMaxLines,
  },
  collections: mergedMemoryCollections,
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
