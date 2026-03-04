/**
 * Agent template engine — Handlebars-based conditional content.
 *
 * Supports:
 *   {{#if pi_mesh}}...{{/if}}                — package conditional
 *   {{#ifAll pi_mesh pi_tmux}}...{{/ifAll}}  — compound (all must be installed)
 *   {{> pi_mesh/worker_reporting}}           — partial from package slots
 *
 * Package names use underscores in templates: pi_mesh → pi-mesh on filesystem.
 * Partials resolve from:
 *   .pi/slots/<pkg>/<name>.md (project override)
 *   → packages/<pkg>/slots/<name>.md (local)
 *   → node_modules/<pkg>/slots/<name>.md (npm)
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
 * Scan for all packages that could be referenced in templates.
 * Returns a context object with boolean flags: { pi_mesh: true, pi_agents: true, ... }
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
        }
      }
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

  const candidates = [
    path.join(cwd, ".pi", "slots", fsName, `${slotName}.md`),
    path.join(cwd, "packages", fsName, "slots", `${slotName}.md`),
    path.join(cwd, "node_modules", fsName, "slots", `${slotName}.md`),
  ];

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

    // Build context with package booleans
    const context = buildContext(ctx.cwd);

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
