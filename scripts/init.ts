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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, isAbsolute } from "node:path";
import { parse as parseToml } from "@iarna/toml";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, "config.toml");
const bosunPkgOverride = process.env.BOSUN_PKG ? process.env.BOSUN_PKG : null;

// Detect mode: is bosun a dependency (node_modules/bosun/) or an explicitly provided package root?
const bosunDepDir = join(ROOT, "node_modules", "bosun");
const localBosunRepo = existsSync(join(ROOT, "packages", "pi-bosun", "package.json"));
const externalBosunRoot = bosunPkgOverride && existsSync(join(bosunPkgOverride, "packages", "pi-bosun", "package.json"))
  ? bosunPkgOverride
  : null;
const activeBosunRoot = localBosunRepo ? ROOT : (existsSync(join(bosunDepDir, "packages")) ? bosunDepDir : externalBosunRoot);
const isDependencyMode = !localBosunRepo && activeBosunRoot !== null;

// Resolve the bosun packages directory
const bosunPackagesDir = activeBosunRoot ? join(activeBosunRoot, "packages") : null;
const bosunPiRelativePrefix = activeBosunRoot === bosunDepDir ? "../node_modules/bosun" : activeBosunRoot;
const bosunRootRelativePrefix = activeBosunRoot === bosunDepDir ? "./node_modules/bosun" : activeBosunRoot;

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
const DEFAULT_MODEL_TIERS: Record<string, string> = {
  lite: "openai-codex/gpt-5.4-mini",
  medium: "openai-codex/gpt-5.3-codex",
  high: "openai-codex/gpt-5.4",
  oracle: "openai-codex/gpt-5.4",
};
const models = (config.models as Record<string, string>) || {};
const agents = (config.agents as Record<string, unknown>) || {};
const backend = (config.backend as Record<string, unknown>) || {};
const pi = (config.pi as Record<string, unknown>) || {};

console.log("Loaded config.toml");

const piDir = join(ROOT, ".pi");
mkdirSync(piDir, { recursive: true });

function writeJson(name: string, data: unknown): void {
  const path = join(piDir, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`  Generated .pi/${name}`);
}

interface PiProjectDefaults {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function splitProviderQualifiedModel(value: string | undefined): { provider?: string; model?: string } {
  if (!value) return {};
  const slash = value.indexOf("/");
  if (slash === -1) return { model: value };
  return {
    provider: value.slice(0, slash),
    model: value.slice(slash + 1),
  };
}

function resolveConfigPath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : join(ROOT, pathValue);
}

function inferProviderFromTier(tierOrModel: string | undefined): string | undefined {
  if (!tierOrModel) return undefined;
  const configured = splitProviderQualifiedModel(models[tierOrModel] || tierOrModel);
  if (configured.provider) return configured.provider;
  const fallback = splitProviderQualifiedModel(DEFAULT_MODEL_TIERS[tierOrModel]);
  return fallback.provider;
}

function loadAgentFrontmatterDefaults(agentFile: string): { model?: string; thinking?: string } {
  const content = readFileSync(agentFile, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const fm = fmMatch[1];
  return {
    model: getString(fm.match(/^model:\s*(.+)$/m)?.[1]),
    thinking: getString(fm.match(/^thinking:\s*(.+)$/m)?.[1]),
  };
}

// --- settings.json ---
// Auto-discover packages that have a "pi" key in package.json

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
  const bosunPkg = JSON.parse(readFileSync(join(activeBosunRoot!, "package.json"), "utf-8"));
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
if (isDependencyMode && activeBosunRoot && existsSync(join(activeBosunRoot, "skills"))) {
  skillsPaths.push(join(activeBosunRoot, "skills"));
}

// Paths in settings.json are resolved relative to .pi/ (where the file lives),
// so we need "../packages/" or "../node_modules/bosun/packages/" to reach them.

// slotPaths — directories that may contain slots/<name>.md (only if slots/ subdir exists)
const slotPaths: string[] = [];
for (const pkg of localPackages) {
  if (existsSync(join(packagesDir, pkg, "slots"))) {
    slotPaths.push(`../packages/${pkg}`);
  }
}
if (bosunPackagesDir) {
  for (const pkg of filteredBosunPackages) {
    if (existsSync(join(bosunPackagesDir, pkg, "slots"))) {
      slotPaths.push(`${bosunPiRelativePrefix}/packages/${pkg}`);
    }
  }
}

// slotRoots — project roots that have .pi/slots/ for project-level slot overrides
const slotRoots: string[] = [];
if (isDependencyMode && activeBosunRoot && existsSync(join(activeBosunRoot, ".pi", "slots"))) {
  slotRoots.push(activeBosunRoot);
}
// The current project's .pi/slots/ is always checked first by template.ts,
// so we don't need to include it here.

// --- agents.json ---

// Auto-discover agent directories from all packages (local + bosun dep)
const discoveredAgentPaths: string[] = [];
for (const pkg of localPackages) {
  const agentsDir = join(packagesDir, pkg, "agents");
  if (existsSync(agentsDir)) {
    discoveredAgentPaths.push(`./packages/${pkg}/agents`);
  }
}
if (bosunPackagesDir) {
  for (const pkg of filteredBosunPackages) {
    const agentsDir = join(bosunPackagesDir, pkg, "agents");
    if (existsSync(agentsDir)) {
      discoveredAgentPaths.push(`${bosunRootRelativePrefix}/packages/${pkg}/agents`);
    }
  }
}

function inferPiProjectDefaults(agentPaths: string[]): PiProjectDefaults {
  const explicitProvider = getString(pi.default_provider);
  const explicitModelValue = getString(pi.default_model);
  const explicitThinking = getString(pi.default_thinking_level);
  const explicitModel = splitProviderQualifiedModel(explicitModelValue);

  let inferredProvider: string | undefined;
  let inferredModel: string | undefined;
  let inferredThinking: string | undefined;

  const defaultAgent = getString(agents.default_agent) || "bosun";
  for (const agentPath of agentPaths) {
    const candidate = join(resolveConfigPath(agentPath), `${defaultAgent}.md`);
    if (!existsSync(candidate)) continue;
    const agentDefaults = loadAgentFrontmatterDefaults(candidate);
    const resolvedModel = agentDefaults.model ? (models[agentDefaults.model] || agentDefaults.model) : undefined;
    const splitModel = splitProviderQualifiedModel(resolvedModel);
    inferredProvider = splitModel.provider || inferProviderFromTier(agentDefaults.model);
    inferredModel = splitModel.model;
    inferredThinking = agentDefaults.thinking;
    break;
  }

  return {
    defaultProvider: explicitProvider || explicitModel.provider || inferredProvider,
    defaultModel: explicitModel.model || inferredModel,
    defaultThinkingLevel: explicitThinking || inferredThinking,
  };
}

const projectPiDefaults = inferPiProjectDefaults([
  ...(Array.isArray(agents.extra_paths) ? (agents.extra_paths as string[]) : []),
  ...discoveredAgentPaths,
]);

writeJson("settings.json", {
  _configHash: configHash,
  packages: [
    ...localPackages.map((p) => `../packages/${p}`),
    ...filteredBosunPackages.map((p) => `${bosunPiRelativePrefix}/packages/${p}`),
    ...npmPackages.map((p) => `npm:${p}`),
  ],
  ...(slotPaths.length > 0 ? { slotPaths } : {}),
  ...(slotRoots.length > 0 ? { slotRoots } : {}),
  ...(skillsPaths.length > 0 ? { skills: skillsPaths } : {}),
  ...(projectPiDefaults.defaultProvider ? { defaultProvider: projectPiDefaults.defaultProvider } : {}),
  ...(projectPiDefaults.defaultModel ? { defaultModel: projectPiDefaults.defaultModel } : {}),
  ...(projectPiDefaults.defaultThinkingLevel ? { defaultThinkingLevel: projectPiDefaults.defaultThinkingLevel } : {}),
});

const configuredBackendType = backend.type === "zmux" ? "zmux" : "tmux";
const generatedBackendConfig: Record<string, unknown> = {
  type: configuredBackendType,
  command_prefix: backend.command_prefix || (isDependencyMode ? "node_modules/bosun/scripts/sandbox.sh" : "scripts/sandbox.sh"),
};

if (configuredBackendType === "zmux") {
  for (const key of [
    "binary",
    "state_dir",
    "socket_path",
    "transport",
    "ssh_host",
    "ssh_user",
    "ssh_port",
    "ssh_command",
    "ssh_bootstrap_timeout_ms",
    "tcp_host",
    "tcp_port",
    "tls_server_name",
    "tls_ca_cert",
    "tls_client_cert",
    "tls_client_key",
    "tls_transport_version",
  ]) {
    if (backend[key] !== undefined && backend[key] !== "") {
      generatedBackendConfig[key] = backend[key];
    }
  }
}

writeJson("agents.json", {
  models: {
    lite: models.lite || "openai-codex/gpt-5.4-mini",
    medium: models.medium || "openai-codex/gpt-5.3-codex",
    high: models.high || "openai-codex/gpt-5.4",
    oracle: models.oracle || "openai-codex/gpt-5.4",
  },
  defaultAgent: agents.default_agent || "bosun",
  agentPaths: [
    ...(Array.isArray(agents.extra_paths) ? agents.extra_paths : []),
    ...discoveredAgentPaths,
  ],
  backend: generatedBackendConfig,
});

// --- .pi/prompts/spawn.md (generated from agent definitions) ---
{
  // Use the same auto-discovered agent paths as agents.json
  const agentPaths = [
    ...(Array.isArray(agents.extra_paths) ? (agents.extra_paths as string[]) : []),
    ...discoveredAgentPaths,
  ];

  interface AgentInfo { name: string; emoji: string; description: string }
  const agentList: AgentInfo[] = [];

  for (const agentDir of agentPaths) {
    const absDir = resolveConfigPath(agentDir);
    if (!existsSync(absDir)) continue;
    for (const file of readdirSync(absDir)) {
      if (!file.endsWith(".md")) continue;
      const content = readFileSync(join(absDir, file), "utf-8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const emoji = fm.match(/^emoji:\s*(.+)$/m)?.[1]?.trim() || "🤖";
      const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
      if (name && description) {
        agentList.push({ name, emoji, description });
      }
    }
  }

  // Build markdown table
  const tableRows = agentList
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => `| ${a.emoji} \`${a.name}\` | ${a.description} |`)
    .join("\n");
  const agentsTable = `| Agent | Description |\n|-------|-------------|\n${tableRows}`;

  // Read spawn.md template and replace placeholder
  const spawnTemplatePath = isDependencyMode
    ? join(bosunDepDir, "packages", "pi-bosun", "prompt-templates", "spawn.md")
    : join(ROOT, "packages", "pi-bosun", "prompt-templates", "spawn.md");

  if (existsSync(spawnTemplatePath)) {
    const template = readFileSync(spawnTemplatePath, "utf-8");
    const rendered = template.replace("{{AGENTS_TABLE}}", agentsTable);
    const promptsDir = join(piDir, "prompts");
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(join(promptsDir, "spawn.md"), rendered);
    console.log("  Generated .pi/prompts/spawn.md");
  }
}

// --- prompt templates from packages ---
// Auto-discover prompt-templates/ directories in all packages and copy them
// to .pi/prompts/. spawn.md is handled specially above; all other .md files
// are copied as-is.
{
  const promptsDir = join(piDir, "prompts");
  mkdirSync(promptsDir, { recursive: true });

  const pkgDirs = [
    ...localPackages.map((p) => join(packagesDir, p)),
    ...(bosunPackagesDir ? filteredBosunPackages.map((p) => join(bosunPackagesDir, p)) : []),
  ];

  for (const pkgDir of pkgDirs) {
    const templatesDir = join(pkgDir, "prompt-templates");
    if (!existsSync(templatesDir)) continue;
    for (const file of readdirSync(templatesDir)) {
      if (!file.endsWith(".md")) continue;
      // Skip spawn.md — handled above with special rendering
      if (file === "spawn.md") continue;
      const src = join(templatesDir, file);
      const dest = join(promptsDir, file);
      writeFileSync(dest, readFileSync(src, "utf-8"));
      console.log(`  Copied .pi/prompts/${file}`);
    }
  }
}

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

// compact_thresholds is a TOML table: [auto_resume.compact_thresholds]
// e.g. "gpt-5.4" = 30
const compactThresholds = autoResume.compact_thresholds as Record<string, number> | undefined;
const compactThreshold = typeof autoResume.compact_threshold === "number" ? autoResume.compact_threshold : undefined;

writeJson("pi-auto-resume.json", {
  enabled: autoResume.enabled ?? true,
  cooldownSeconds: autoResume.cooldown_seconds ?? 60,
  message:
    typeof autoResume.message === "string" && (autoResume.message as string).trim()
      ? autoResume.message
      : "Continue where you left off. If the previous task is complete or you need clarification, just ask.",
  ...(compactThreshold !== undefined && { compactThreshold }),
  ...(compactThresholds && Object.keys(compactThresholds).length > 0 && { compactThresholds }),
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
  gpu_passthrough: sandbox.gpu_passthrough ?? true,
  docker_passthrough: sandbox.docker_passthrough ?? false,
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
  hooksModule: isDependencyMode
    ? "./node_modules/bosun/packages/pi-agents/extensions/mesh-identity-sync.ts"
    : "./packages/pi-agents/extensions/mesh-identity-sync.ts",
  identitySync: {
    enabled: meshIdentitySync.enabled ?? true,
    startupAlign: meshIdentitySync.startup_align ?? true,
    meshToTmux: meshIdentitySync.mesh_to_tmux ?? true,
    tmuxToMesh: meshIdentitySync.tmux_to_mesh ?? true,
    pollIntervalMs: meshIdentitySync.poll_interval_ms ?? 2000,
  },
});

// --- pi-img-gen.json ---
const imgGen = (config.img_gen as Record<string, unknown>) || {};

writeJson("pi-img-gen.json", {
  gemini_api_key: imgGen.gemini_api_key || (config.web_access as Record<string, unknown>)?.gemini_api_key || "",
  default_model: imgGen.default_model || "gemini-2.5-flash-image",
});

// --- pi-q.json ---
const q = (config.q as Record<string, unknown>) || {};

writeJson("pi-q.json", {
  data_dir: q.data_dir || "workspace/users",
});

// --- pi-gateway.json ---
const gateway = (config.gateway as Record<string, unknown>) || {};

writeJson("pi-gateway.json", {
  enabled: gateway.enabled ?? false,
  host: gateway.host || "127.0.0.1",
  port: gateway.port || 3100,
  autoStart: gateway.auto_start ?? true,
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
const allowHybridSearch = memory.allow_hybrid_search ?? DEFAULT_MEMORY_CONFIG.allowHybridSearch;
const defaultMemoryMode = memory.default_mode === "hybrid" ? "hybrid" : DEFAULT_MEMORY_CONFIG.defaultMode;
if (!allowHybridSearch && defaultMemoryMode === "hybrid") {
  throw new Error("Invalid memory config: default_mode='hybrid' requires allow_hybrid_search=true. Set default_mode='keyword' or enable memory.allow_hybrid_search.");
}

writeJson("pi-memory.json", {
  enabled: memory.enabled ?? DEFAULT_MEMORY_CONFIG.enabled,
  gpu: memory.gpu ?? DEFAULT_MEMORY_CONFIG.gpu,
  dbPath: memory.db_path || DEFAULT_MEMORY_CONFIG.dbPath,
  allowHybridSearch,
  defaultMode: defaultMemoryMode,
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

// --- pi-bash-readonly.json ---
const bashReadonly = (config.bash_readonly as Record<string, unknown>) || {};
const bashReadonlyConfig: Record<string, unknown> = {};
if (typeof bashReadonly.network === "boolean") bashReadonlyConfig.network = bashReadonly.network;
if (typeof bashReadonly.enabled === "boolean") bashReadonlyConfig.enabled = bashReadonly.enabled;
if (Array.isArray(bashReadonly.writable)) {
  bashReadonlyConfig.writable = (bashReadonly.writable as unknown[]).filter((p) => typeof p === "string");
}
writeJson("pi-bash-readonly.json", bashReadonlyConfig);

// --- secrets.env (env var values from config.toml [env.values]) ---
const envValues = (env.values as Record<string, string>) || {};
if (Object.keys(envValues).length > 0) {
  const lines = ["# Generated by `just init` from config.toml [env.values]", "# Do not edit — changes will be overwritten.", ""];
  for (const [key, value] of Object.entries(envValues)) {
    lines.push(`${key}=${JSON.stringify(value)}`);
  }
  lines.push("");
  writeFileSync(join(ROOT, "secrets.env"), lines.join("\n"));
  console.log(`  Generated secrets.env`);
}

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
