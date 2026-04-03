/**
 * Agent template engine — Handlebars-based conditional content.
 *
 * Supports:
 *   {{#if pi_mesh}}...{{/if}}                — package conditional
 *   {{#ifAll pi_mesh pi_tmux}}...{{/ifAll}}  — compound (all must be installed)
 *   {{> pi_mesh/worker_reporting}}           — partial from package slots
 *
 * Package names use underscores in templates: pi_mesh → pi-mesh on filesystem.
 *
 * Package discovery (for conditionals):
 *   1. Filesystem: packages/, node_modules/pi-*
 *   2. .pi/settings.json "packages" array (covers deps like node_modules/bosun/packages/*)
 *
 * Partial/slot resolution (first match wins):
 *   .pi/slots/<pkg>/<name>.md                     (project override)
 *   → packages/<pkg>/slots/<name>.md              (local package)
 *   → node_modules/<pkg>/slots/<name>.md          (npm package)
 *   → <settings.json package path>/slots/<name>.md (any registered package)
 *   → .pi/slots/ from parent of each settings.json package path (project-level slots)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import Handlebars from "handlebars";

export interface TemplateContext {
  cwd: string;
}

/**
 * Normalize template package name (underscores) to filesystem name (hyphens).
 */
function normalizePackageName(name: string): string {
  return name.replace(/_/g, "-");
}

/** Parsed settings from .pi/settings.json */
interface SettingsData {
  packages: Map<string, string>;
  slotPaths: string[];
  slotRoots: string[];
  configHash?: string;
}

/** Cache for readSettings() — keyed by cwd */
const settingsCache = new Map<string, SettingsData>();

/** Whether we've already checked for stale config */
let staleCheckDone = false;

/**
 * Read .pi/settings.json and resolve package paths to absolute directories.
 * Results are memoized per cwd for the lifetime of the process.
 *
 * Returns packages map (name → abs dir), slotPaths, slotRoots, and configHash.
 */
function readSettings(cwd: string): SettingsData {
  const cached = settingsCache.get(cwd);
  if (cached) return cached;

  const empty: SettingsData = { packages: new Map(), slotPaths: [], slotRoots: [] };
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  if (!fs.existsSync(settingsPath)) {
    settingsCache.set(cwd, empty);
    return empty;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const piDir = path.join(cwd, ".pi");

    // Parse packages
    const packages = new Map<string, string>();
    if (Array.isArray(settings.packages)) {
      for (const pkg of settings.packages) {
        if (typeof pkg !== "string" || pkg.startsWith("npm:")) continue;
        const absPath = path.resolve(piDir, pkg);
        const pkgName = path.basename(absPath);
        if (pkgName && fs.existsSync(absPath)) {
          packages.set(pkgName, absPath);
        }
      }
    }

    // Parse slotPaths — resolve relative to .pi/
    const slotPaths: string[] = [];
    if (Array.isArray(settings.slotPaths)) {
      for (const sp of settings.slotPaths) {
        if (typeof sp === "string") {
          slotPaths.push(path.resolve(piDir, sp));
        }
      }
    }

    // Parse slotRoots — resolve relative to .pi/
    const slotRoots: string[] = [];
    if (Array.isArray(settings.slotRoots)) {
      for (const sr of settings.slotRoots) {
        if (typeof sr === "string") {
          slotRoots.push(path.resolve(piDir, sr));
        }
      }
    }

    const result: SettingsData = {
      packages,
      slotPaths,
      slotRoots,
      configHash: settings._configHash,
    };

    // Stale config check — run once per process
    if (!staleCheckDone) {
      staleCheckDone = true;
      checkStaleConfig(cwd, result.configHash);
    }

    settingsCache.set(cwd, result);
    return result;
  } catch {
    settingsCache.set(cwd, empty);
    return empty;
  }
}

/**
 * Check if .pi/settings.json is stale by comparing its _configHash
 * with the current config.toml hash. Logs a warning if they differ.
 */
function checkStaleConfig(cwd: string, settingsHash?: string): void {
  if (!settingsHash) return;
  const configPath = path.join(cwd, "config.toml");
  if (!fs.existsSync(configPath)) return;
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const currentHash = createHash("sha256").update(content).digest("hex");
    if (currentHash !== settingsHash) {
      console.error(
        "[pi-agents] Warning: .pi/settings.json may be stale — run 'just init' to regenerate"
      );
    }
  } catch {
    // Non-critical — skip if we can't read config.toml
  }
}



/**
 * Scan for all packages that could be referenced in templates.
 * Returns a context object with boolean flags: { pi_mesh: true, pi_agents: true, ... }
 *
 * Discovery sources (in order):
 *   1. packages/ directory (local packages)
 *   2. node_modules/pi-* (npm packages)
 *   3. .pi/settings.json packages array (covers deps in any layout)
 */
function buildContext(cwd: string): Record<string, boolean> {
  const ctx: Record<string, boolean> = {};
  const seen = new Set<string>();

  // Scan packages/ directory
  const packagesDir = path.join(cwd, "packages");
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir)) {
      const pkgJson = path.join(packagesDir, entry, "package.json");
      if (fs.existsSync(pkgJson)) {
        const key = entry.replace(/-/g, "_");
        ctx[key] = true;
        seen.add(entry);
      }
    }
  }

  // Scan node_modules/ for pi-* packages not already found locally.
  // Only pi-* prefixed packages are scanned to avoid iterating all of node_modules.
  // Non-pi packages won't get context flags unless added to packages/.
  const nmDir = path.join(cwd, "node_modules");
  if (fs.existsSync(nmDir)) {
    for (const entry of fs.readdirSync(nmDir)) {
      if (!seen.has(entry) && entry.startsWith("pi-")) {
        const pkgJson = path.join(nmDir, entry, "package.json");
        if (fs.existsSync(pkgJson)) {
          const key = entry.replace(/-/g, "_");
          ctx[key] = true;
          seen.add(entry);
        }
      }
    }
  }

  // Read .pi/settings.json for packages in non-standard locations
  // (e.g. node_modules/bosun/packages/pi-bosun when bosun is a dependency).
  const settings = readSettings(cwd);
  for (const [pkgName] of settings.packages) {
    if (!seen.has(pkgName)) {
      const key = pkgName.replace(/-/g, "_");
      ctx[key] = true;
      seen.add(pkgName);
    }
  }

  return ctx;
}

/**
 * Resolve a partial file path. Priority: project override > local package > node_modules.
 * Returns file content or empty string if not found.
 */
function resolvePartial(name: string, cwd: string): string {
  // name is like "pi_mesh/worker_reporting"
  const parts = name.split("/");
  if (parts.length !== 2) return "";

  const [pkgKey, slotName] = parts;
  const fsName = normalizePackageName(pkgKey);

  // Static candidates (always checked)
  const candidates = [
    path.join(cwd, ".pi", "slots", fsName, `${slotName}.md`),
    path.join(cwd, "packages", fsName, "slots", `${slotName}.md`),
    path.join(cwd, "node_modules", fsName, "slots", `${slotName}.md`),
  ];

  // Dynamic candidates from settings.json slotPaths and slotRoots.
  const settings = readSettings(cwd);

  // slotPaths — package directories that have a slots/ subdirectory
  for (const slotPath of settings.slotPaths) {
    if (path.basename(slotPath) === fsName) {
      candidates.push(path.join(slotPath, "slots", `${slotName}.md`));
    }
  }

  // slotRoots — project roots with .pi/slots/ for dependency-level overrides
  for (const slotRoot of settings.slotRoots) {
    candidates.push(path.join(slotRoot, ".pi", "slots", fsName, `${slotName}.md`));
  }

  // Fallback: if slotPaths/slotRoots are not in settings.json (old config),
  // use package paths from settings.json directly
  if (settings.slotPaths.length === 0 && settings.slotRoots.length === 0) {
    const pkgDir = settings.packages.get(fsName);
    if (pkgDir) {
      candidates.push(path.join(pkgDir, "slots", `${slotName}.md`));
    }
    const checkedRoots = new Set<string>();
    for (const [, dir] of settings.packages) {
      const parentDir = path.dirname(dir);
      const rootDir = path.dirname(parentDir);
      if (checkedRoots.has(rootDir)) continue;
      checkedRoots.add(rootDir);
      candidates.push(path.join(rootDir, ".pi", "slots", fsName, `${slotName}.md`));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf-8").trimEnd();
    }
  }

  return "";
}

/**
 * Scan body for all {{> partial/name}} references and pre-register them.
 * Handlebars resolves partials at compile time, so they must be registered first.
 */
function discoverAndRegisterPartials(
  body: string,
  cwd: string,
  hbs: typeof Handlebars
): void {
  const partialPattern = /\{\{>\s*([\w/]+)\s*\}\}/g;
  let match;

  while ((match = partialPattern.exec(body)) !== null) {
    const name = match[1];
    if (!name) continue;
    const content = resolvePartial(name, cwd);
    hbs.registerPartial(name, content);
  }
}

/**
 * Collapse excessive blank lines (3+ → 2) left by removed blocks.
 */
function collapseBlankLines(body: string): string {
  return body.replace(/\n{3,}/g, "\n\n");
}

/**
 * Process Handlebars template tags in agent body markdown.
 * Resolves conditionals and partials based on installed packages.
 */
export function processTemplate(body: string, ctx: TemplateContext): string {
  // Quick check — skip processing if no template tags present
  if (!body.includes("{{")) return body;

  try {
    // Create isolated Handlebars instance so we don't pollute global state
    const hbs = Handlebars.create();

    // Register ifAll helper — compound conditional (all packages must be installed).
    // Handlebars resolves arguments against context before passing to helpers,
    // so {{#ifAll pi_mesh pi_agents}} receives the boolean context values (true/true),
    // not the string names. We check truthiness directly — the context already has
    // the package-installed flags.
    hbs.registerHelper("ifAll", function (this: unknown, ...args: unknown[]) {
      const options = args.pop() as Handlebars.HelperOptions;
      const allTruthy = args.every((arg) => !!arg);
      return allTruthy ? options.fn(this) : options.inverse(this);
    });

    // Build context with package booleans + agent identity.
    // Widen type: buildContext returns booleans, but we add string values below.
    const context: Record<string, boolean | string> = buildContext(ctx.cwd);

    // Expose agent name so slots can reference {{agent_name}} instead of
    // hardcoding a specific orchestrator name.  PI_AGENT_NAME is the unique
    // instance name (e.g. "bosun-2"), PI_AGENT is the template name (e.g. "bosun").
    context.agent_name = process.env.PI_AGENT_NAME || process.env.PI_AGENT || "agent";

    // Expose parent agent name so child agents can reference {{parent_agent}}
    // to know who spawned them.  Set by spawn_agent via PI_PARENT_AGENT env var.
    // Empty string when running as a top-level agent (not spawned).
    context.parent_agent = process.env.PI_PARENT_AGENT || "";

    // Pre-register all partials referenced in the body
    discoverAndRegisterPartials(body, ctx.cwd, hbs);

    // Compile and execute
    const template = hbs.compile(body, { noEscape: true });
    const result = template(context);

    return collapseBlankLines(result).trimEnd();
  } catch (err) {
    // If template processing fails, return original body unchanged
    // This prevents broken templates from breaking agent startup
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pi-agents] Template processing error: ${msg}`);
    return body;
  }
}
