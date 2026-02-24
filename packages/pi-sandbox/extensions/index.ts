/**
 * pi-sandbox — Tool-level sandboxing for Pi.
 *
 * Intercepts bash, write, and edit tool calls and checks them against
 * `.pi/sandbox.json` rules. Blocks operations that violate the config.
 *
 * This is a second layer of defense (tool-level) on top of process-level
 * sandboxing (bwrap). It provides fine-grained per-command restrictions
 * even when running without process-level isolation.
 *
 * Config: `.pi/sandbox.json`
 * ```json
 * {
 *   "enabled": true,
 *   "filesystem": {
 *     "denyRead": ["~/.ssh", "~/.aws"],
 *     "allowWrite": [".", "/tmp"],
 *     "denyWrite": [".env", ".env.*", "*.pem", "*.key"]
 *   }
 * }
 * ```
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { homedir } from "node:os";

interface SandboxConfig {
  enabled: boolean;
  filesystem: {
    denyRead: string[];
    allowWrite: string[];
    denyWrite: string[];
  };
}

const DEFAULTS: SandboxConfig = {
  enabled: false,
  filesystem: {
    denyRead: [],
    allowWrite: ["."],
    denyWrite: [],
  },
};

function loadSandboxConfig(cwd: string): SandboxConfig {
  const configPath = join(cwd, ".pi", "sandbox.json");
  if (!existsSync(configPath)) return { ...DEFAULTS, filesystem: { ...DEFAULTS.filesystem } };

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
      filesystem: {
        denyRead: Array.isArray(raw.filesystem?.denyRead) ? raw.filesystem.denyRead : DEFAULTS.filesystem.denyRead,
        allowWrite: Array.isArray(raw.filesystem?.allowWrite) ? raw.filesystem.allowWrite : DEFAULTS.filesystem.allowWrite,
        denyWrite: Array.isArray(raw.filesystem?.denyWrite) ? raw.filesystem.denyWrite : DEFAULTS.filesystem.denyWrite,
      },
    };
  } catch {
    return { ...DEFAULTS, filesystem: { ...DEFAULTS.filesystem } };
  }
}

/** Expand ~ to home directory. */
function expandPath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/** Check if a resolved path matches any pattern in a list. */
function matchesPattern(resolvedPath: string, cwd: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const expanded = expandPath(pattern);

    // Exact directory prefix match
    const abs = resolve(cwd, expanded);
    if (resolvedPath === abs || resolvedPath.startsWith(abs + "/")) {
      return true;
    }

    // Glob-like suffix match (*.pem, .env.*)
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1); // ".pem"
      if (resolvedPath.endsWith(ext)) return true;
    }

    if (pattern.includes(".*")) {
      // ".env.*" → check if basename starts with ".env."
      const base = pattern.replace(".*", ".");
      const rel = relative(cwd, resolvedPath);
      if (rel.startsWith(base) || resolvedPath.endsWith("/" + base) || resolvedPath.includes("/" + base)) {
        return true;
      }
    }

    // Basename match (e.g., ".env")
    const basename = resolvedPath.split("/").pop() || "";
    if (basename === pattern) return true;
  }

  return false;
}

/** Check if a path is allowed for writing. */
function isWriteAllowed(resolvedPath: string, cwd: string, config: SandboxConfig): boolean {
  // Check denyWrite first (takes precedence)
  if (matchesPattern(resolvedPath, cwd, config.filesystem.denyWrite)) {
    return false;
  }

  // Check allowWrite
  if (config.filesystem.allowWrite.length === 0) return true;
  return matchesPattern(resolvedPath, cwd, config.filesystem.allowWrite);
}

/** Check if a path is denied for reading. */
function isReadDenied(resolvedPath: string, cwd: string, config: SandboxConfig): boolean {
  return matchesPattern(resolvedPath, cwd, config.filesystem.denyRead);
}

/**
 * Extract file-path-like tokens from a bash command.
 * Catches: redirect targets (> file), command arguments, quoted paths.
 * Not perfect (bash is complex), but catches common patterns.
 */
function extractPathTokens(cmd: string): string[] {
  const tokens: string[] = [];
  // Match redirect targets: > file, >> file
  const redirects = cmd.matchAll(/>{1,2}\s*([^\s;|&]+)/g);
  for (const m of redirects) tokens.push(m[1]);
  // Match paths with extensions or starting with ~ / . /
  const paths = cmd.matchAll(/(?:^|\s)((?:~\/|\.\/|\/)[^\s;|&>]+|[^\s;|&>]*\.[a-zA-Z]{1,6})/g);
  for (const m of paths) tokens.push(m[1]);
  // Deduplicate
  return [...new Set(tokens.map(t => t.replace(/^["']|["']$/g, "")))];
}

export default function (pi: ExtensionAPI) {
  let config: SandboxConfig | null = null;
  let configCwd: string | null = null;

  function getConfig(cwd: string): SandboxConfig {
    if (configCwd !== cwd || !config) {
      config = loadSandboxConfig(cwd);
      configCwd = cwd;
    }
    return config;
  }

  pi.on("tool_call", async (event, ctx) => {
    const cfg = getConfig(ctx.cwd);
    if (!cfg.enabled) return;

    // --- bash ---
    if (isToolCallEventType("bash", event)) {
      const cmd = event.input.command || "";

      // Extract file-like tokens from the command for pattern matching.
      // This catches redirects (> file), arguments, and common write targets.
      const tokens = extractPathTokens(cmd);

      // Check for read access to denied paths
      for (const token of tokens) {
        const resolved = resolve(ctx.cwd, expandPath(token));
        if (isReadDenied(resolved, ctx.cwd, cfg)) {
          return { block: true, reason: `Sandbox: access to ${token} is denied` };
        }
      }

      // Also check raw denied patterns against command string (catches piped/nested commands)
      for (const denied of cfg.filesystem.denyRead) {
        const expanded = expandPath(denied);
        if (cmd.includes(expanded) || cmd.includes(denied)) {
          return { block: true, reason: `Sandbox: access to ${denied} is denied` };
        }
      }

      // Check for write to denied patterns
      const isWriteCmd = /\b(>|>>|tee|mv|cp|install|rsync)\b|>[>]?/.test(cmd);
      if (isWriteCmd) {
        for (const token of tokens) {
          const resolved = resolve(ctx.cwd, expandPath(token));
          if (matchesPattern(resolved, ctx.cwd, cfg.filesystem.denyWrite)) {
            return { block: true, reason: `Sandbox: writing to ${token} is denied` };
          }
        }
      }
    }

    // --- write ---
    if (isToolCallEventType("write", event)) {
      const filePath = (event.input as Record<string, unknown>).path as string;
      if (filePath) {
        const resolved = resolve(ctx.cwd, filePath.replace(/^@/, ""));

        if (isReadDenied(resolved, ctx.cwd, cfg)) {
          return { block: true, reason: `Sandbox: access to ${filePath} is denied` };
        }

        if (!isWriteAllowed(resolved, ctx.cwd, cfg)) {
          return { block: true, reason: `Sandbox: writing to ${filePath} is not allowed` };
        }
      }
    }

    // --- edit ---
    if (isToolCallEventType("edit", event)) {
      const filePath = (event.input as Record<string, unknown>).path as string;
      if (filePath) {
        const resolved = resolve(ctx.cwd, filePath.replace(/^@/, ""));

        if (isReadDenied(resolved, ctx.cwd, cfg)) {
          return { block: true, reason: `Sandbox: access to ${filePath} is denied` };
        }

        if (!isWriteAllowed(resolved, ctx.cwd, cfg)) {
          return { block: true, reason: `Sandbox: editing ${filePath} is not allowed` };
        }
      }
    }

    // --- read ---
    if (isToolCallEventType("read", event)) {
      const filePath = event.input.path;
      if (filePath) {
        const resolved = resolve(ctx.cwd, filePath.replace(/^@/, ""));
        if (isReadDenied(resolved, ctx.cwd, cfg)) {
          return { block: true, reason: `Sandbox: reading ${filePath} is denied` };
        }
      }
    }
  });
}
