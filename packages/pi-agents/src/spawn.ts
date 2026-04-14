/**
 * Core agent spawning logic.
 *
 * Resolves agent definitions, builds pi commands, and spawns
 * agents in backend-managed windows/sessions. No Pi ExtensionAPI dependency —
 * can be called from daemon workflows, scripts, or any Node/Bun process.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, type AgentsConfig } from "./config.js";
import { discoverAgents, type AgentDef } from "./agents.js";
import { buildLaunchSpec } from "./launch.js";
import { buildAgentEnv } from "./env.js";
import {
  BackendError,
  createBackendContract,
  type ProcessBackend,
  type SpawnDetachedResult,
} from "./backend.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnAgentOptions {
  /** Agent persona name (e.g., "lite", "verify"). Loads from .pi/agents/{agent}.md */
  agent: string;
  /** Initial task/prompt for the agent. */
  task?: string;
  /** Window/peer name (default: agent name). */
  name?: string;
  /** Create agent in a new tmux session. true for auto-named, string for explicit name. */
  session?: boolean | string;
  /** Working directory where agent config and definitions are found. */
  cwd: string;
  /** Override the parent agent name recorded in spawn-tree (default: PI_AGENT_NAME or PI_AGENT env). */
  parentAgent?: string;
  /** Pre-loaded config. If omitted, loaded from cwd. */
  config?: AgentsConfig;
  /** Optional backend contract override (tests/harness). */
  backendContract?: ProcessBackend;
}

export interface SpawnAgentResult {
  /** Whether the spawn succeeded. */
  success: boolean;
  /** Runtime display name used for the spawned agent target. */
  windowName: string;
  /** Session name used by the selected backend (when session-scoped). */
  sessionName?: string;
  /** Resolved model string (after tier mapping). */
  model?: string;
  /** Extensions that were listed but not found on disk. */
  skippedExtensions: string[];
  /** Error message if success is false. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shell-escape a string by wrapping in single quotes. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Resolve the monorepo packages/ directory from this file's location.
 * src/spawn.ts lives at {root}/packages/pi-agents/src/spawn.ts,
 * so going up 2 levels reaches {root}/packages/.
 */
function getOwnPackagesDir(): { dir: string; valid: boolean } {
  const dir = path.resolve(import.meta.dirname, "..", "..");
  const valid = fs.existsSync(path.join(dir, "pi-agents", "package.json"));
  return { dir, valid };
}

function npmPackageName(spec: string): string | null {
  if (!spec.startsWith("npm:")) return null;
  const body = spec.slice(4).trim();
  if (!body) return null;

  if (body.startsWith("@")) {
    const slash = body.indexOf("/");
    if (slash === -1) return body;
    const versionAt = body.indexOf("@", slash + 1);
    return versionAt === -1 ? body : body.slice(0, versionAt);
  }

  const versionAt = body.lastIndexOf("@");
  return versionAt === -1 ? body : body.slice(0, versionAt);
}

function readConfiguredPackageSources(cwd: string): Map<string, string> {
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  const configured = new Map<string, string>();
  if (!fs.existsSync(settingsPath)) return configured;

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as { packages?: unknown[] };
    const piDir = path.join(cwd, ".pi");

    for (const entry of Array.isArray(settings.packages) ? settings.packages : []) {
      if (typeof entry !== "string") continue;

      if (entry.startsWith("npm:")) {
        const name = npmPackageName(entry);
        if (name && !configured.has(name)) configured.set(name, entry);
        continue;
      }

      const absPath = path.resolve(piDir, entry);
      const packageName = path.basename(absPath);
      if (!packageName || configured.has(packageName)) continue;
      if (fs.existsSync(path.join(absPath, "package.json"))) {
        configured.set(packageName, absPath);
      }
    }
  } catch {
    return configured;
  }

  return configured;
}

/**
 * Resolve extension paths for the pi command.
 * Returns [extensionFlags, skippedExtensions].
 */
function resolveExtensions(
  extList: string[],
  cwd: string,
): { flags: string[]; skipped: string[] } {
  const { dir: ownPackagesDir, valid: ownPackagesValid } = getOwnPackagesDir();
  const configuredPackageSources = readConfiguredPackageSources(cwd);
  const flags: string[] = [];
  const skipped: string[] = [];

  for (const ext of extList.filter(Boolean)) {
    const localPath = path.join(cwd, "packages", ext);
    const nmPath = path.join(cwd, "node_modules", ext);
    const ownSiblingPath = path.join(ownPackagesDir, ext);
    const configuredSource = configuredPackageSources.get(ext);

    if (fs.existsSync(path.join(localPath, "package.json"))) {
      flags.push("-e", localPath);
    } else if (fs.existsSync(path.join(nmPath, "package.json"))) {
      flags.push("-e", nmPath);
    } else if (ownPackagesValid && fs.existsSync(path.join(ownSiblingPath, "package.json"))) {
      flags.push("-e", ownSiblingPath);
    } else if (configuredSource) {
      flags.push("-e", configuredSource);
    } else {
      skipped.push(ext);
    }
  }

  return { flags, skipped };
}

/**
 * Build the normalized extension list from an agent definition,
 * ensuring pi-agents and pi-sandbox are always included.
 */
function buildExtensionList(agent: AgentDef): string[] {
  const extList: string[] = agent.extensions
    ? Array.isArray(agent.extensions)
      ? [...agent.extensions]
      : agent.extensions.split(",").map((s) => s.trim())
    : [];

  for (const required of ["pi-agents", "pi-sandbox"]) {
    if (!extList.includes(required)) {
      extList.push(required);
    }
  }

  return extList;
}

// ---------------------------------------------------------------------------
// Core spawn function
// ---------------------------------------------------------------------------

/**
 * Spawn a Pi agent via the selected backend contract (tmux or zmux).
 */
export async function spawnAgent(options: SpawnAgentOptions): Promise<SpawnAgentResult> {
  const { agent: agentName, task, cwd } = options;
  const windowName = options.name || agentName;
  const config = options.config || loadConfig(cwd);

  let backend: ProcessBackend;
  try {
    backend = options.backendContract || createBackendContract({
      cwd,
      backend: config.backend,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      windowName,
      skippedExtensions: [],
      error: message,
    };
  }

  if (backend.type === "tmux" && !backend.isInteractiveContext()) {
    return {
      success: false,
      windowName,
      skippedExtensions: [],
      error: "Not running inside tmux. Start with `just start` to use tmux-backed agent spawning.",
    };
  }

  let agent: AgentDef;
  let resolvedModel: string | undefined;
  try {
    const launchSpec = buildLaunchSpec(cwd, { config, agentName });
    agent = launchSpec.agent;
    resolvedModel = launchSpec.model;
  } catch {
    const available = discoverAgents(cwd, config.agentPaths);
    return {
      success: false,
      windowName,
      skippedExtensions: [],
      error: `Agent '${agentName}' not found. Available: ${available.join(", ") || "(none)"}`,
    };
  }

  const wantsSession = options.session !== undefined && options.session !== false;
  const explicitSessionName = typeof options.session === "string"
    ? options.session
    : (wantsSession ? windowName : undefined);

  const implicitSession = backend.currentSessionName()
    || process.env.PI_BACKEND_SESSION
    || process.env.PI_AGENT_NAME
    || "bosun";
  const targetSessionName = explicitSessionName || implicitSession;

  try {
    if (wantsSession && await backend.hasSession(targetSessionName)) {
      return {
        success: false,
        windowName,
        sessionName: targetSessionName,
        skippedExtensions: [],
        error: `Session '${targetSessionName}' already exists.`,
      };
    }

    if (!wantsSession && await backend.hasWindow(windowName, { sessionName: targetSessionName })) {
      return {
        success: false,
        windowName,
        skippedExtensions: [],
        error: `Window '${windowName}' already exists.`,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      windowName,
      skippedExtensions: [],
      error: message,
    };
  }

  // Build extension flags
  const extList = buildExtensionList(agent);
  const { flags: extensionFlags, skipped: skippedExtensions } = resolveExtensions(extList, cwd);

  // Build the pi command
  const piArgs: string[] = ["--no-extensions", ...extensionFlags];
  if (resolvedModel) {
    piArgs.push("--models", resolvedModel);
  }
  if (agent.thinking) {
    piArgs.push("--thinking", agent.thinking);
  }
  if (task) {
    piArgs.push(task);
  }

  const piArgsStr = piArgs.map(shellEscape).join(" ");
  const rawCommand = config.backend.command_prefix
    ? `${config.backend.command_prefix} pi ${piArgsStr}`
    : `pi ${piArgsStr}`;
  const command = `${rawCommand}; EXIT=$?; if [ $EXIT -ne 0 ]; then echo "=== AGENT EXITED ($EXIT) ==="; sleep 30; fi`;

  const agentEnv = buildAgentEnv({
    agent: agentName,
    name: windowName,
    parentAgent: options.parentAgent,
    emoji: agent.emoji,
  });

  agentEnv.PI_RUNTIME_BACKEND = backend.type;
  agentEnv.PI_BACKEND_SESSION = targetSessionName;
  agentEnv.PI_BACKEND_TARGET = windowName;

  let spawned: SpawnDetachedResult;
  try {
    spawned = await backend.spawnDetached({
      createSession: wantsSession,
      sessionName: targetSessionName,
      windowName,
      paneName: windowName,
      command,
      cwd,
      env: agentEnv,
      metadata: {
        [`bosun.spawn.${windowName}.agent`]: agentName,
        [`bosun.spawn.${windowName}.session`]: targetSessionName,
      },
    });

    if (spawned.paneId) {
      try {
        await backend.writeMetadata(`bosun.identity.${windowName}.target`, spawned.paneId);
      } catch {
        // Best-effort metadata sync.
      }
    }
  } catch (error) {
    const backendError = error instanceof BackendError ? error : null;
    const message = backendError
      ? `${backend.type} error [${backendError.code}${backendError.backendCode ? `:${backendError.backendCode}` : ""}]: ${backendError.message}`
      : (error instanceof Error ? error.message : String(error));

    return {
      success: false,
      windowName,
      sessionName: targetSessionName,
      model: resolvedModel,
      skippedExtensions,
      error: message,
    };
  }

  // Record spawn in spawn-tree.jsonl (best-effort)
  try {
    const treeFile = path.join(cwd, ".pi", "spawn-tree.jsonl");
    const entry = JSON.stringify({
      parent: agentEnv.PI_PARENT_AGENT,
      child: windowName,
      agent: agentName,
      model: resolvedModel || null,
      backend: backend.type,
      session: targetSessionName,
      target: spawned.paneId || spawned.target,
      ts: new Date().toISOString(),
    });
    fs.appendFileSync(treeFile, entry + "\n");
  } catch {
    // Best-effort — don't fail the spawn if logging fails.
  }

  return {
    success: true,
    windowName,
    sessionName: targetSessionName,
    model: resolvedModel,
    skippedExtensions,
  };
}
