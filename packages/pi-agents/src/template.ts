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

/**
 * Read .pi/settings.json and resolve package paths to absolute directories.
 * Returns a map of package name → absolute directory path.
 * Handles relative paths (prefixed with ../) and npm: references.
 */
function readSettingsPackages(cwd: string): Map<string, string> {
  const result = new Map<string, string>();
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  if (!fs.existsSync(settingsPath)) return result;

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const packages = settings.packages;
    if (!Array.isArray(packages)) return result;

    const piDir = path.join(cwd, ".pi");
    for (const pkg of packages) {
      if (typeof pkg !== "string") continue;
      // Skip npm: references — they're resolved by pi's package loader, not filesystem
      if (pkg.startsWith("npm:")) continue;
      // Resolve relative to .pi/ directory (settings.json lives there)
      const absPath = path.resolve(piDir, pkg);
      const pkgName = path.basename(absPath);
      if (pkgName && fs.existsSync(absPath)) {
        result.set(pkgName, absPath);
      }
    }
  } catch {
    // Ignore parse errors — fall back to filesystem scanning
  }

  return result;
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
  const settingsPkgs = readSettingsPackages(cwd);
  for (const [pkgName] of settingsPkgs) {
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

  // Dynamic candidates from settings.json — resolves slots in any layout.
  // For each package in settings.json, add its slots/ dir as a candidate.
  // Also check .pi/slots/ relative to each package's parent root for
  // project-level slot overrides from dependency repos.
  const settingsPkgs = readSettingsPackages(cwd);
  const pkgDir = settingsPkgs.get(fsName);
  if (pkgDir) {
    candidates.push(path.join(pkgDir, "slots", `${slotName}.md`));
  }
  // Check .pi/slots/ in the root of each unique parent directory tree.
  // This finds project-level slot overrides in dependency repos
  // (e.g. node_modules/bosun/.pi/slots/pi-mesh/worker_reporting.md).
  const checkedRoots = new Set<string>();
  for (const [, dir] of settingsPkgs) {
    // Walk up from package dir to find a .pi/slots/ directory
    const parentDir = path.dirname(dir);
    const rootDir = path.dirname(parentDir);
    if (checkedRoots.has(rootDir)) continue;
    checkedRoots.add(rootDir);
    candidates.push(path.join(rootDir, ".pi", "slots", fsName, `${slotName}.md`));
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
