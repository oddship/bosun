/**
 * Core agent spawning logic.
 *
 * Resolves agent definitions, builds pi commands, and spawns
 * agents in tmux windows/sessions. No Pi ExtensionAPI dependency —
 * can be called from daemon workflows, scripts, or any Node/Bun process.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, type AgentsConfig } from "./config.js";
import { discoverAgents, findAgentFile, loadAgent, type AgentDef } from "./agents.js";
import { resolveModel } from "./models.js";
import { buildAgentEnv } from "./env.js";
import {
  isInTmux,
  getTmuxSocket,
  getTmuxSessionSync,
  windowExists,
  sessionExists,
  newWindow,
  newSession,
} from "../../pi-tmux/core.ts";

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
}

export interface SpawnAgentResult {
  /** Whether the spawn succeeded. */
  success: boolean;
  /** The tmux window name used. */
  windowName: string;
  /** The tmux session name (if spawned as a session). */
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

/**
 * Resolve extension paths for the pi command.
 * Returns [extensionFlags, skippedExtensions].
 */
function resolveExtensions(
  extList: string[],
  cwd: string,
): { flags: string[]; skipped: string[] } {
  const { dir: ownPackagesDir, valid: ownPackagesValid } = getOwnPackagesDir();
  const flags: string[] = [];
  const skipped: string[] = [];

  for (const ext of extList.filter(Boolean)) {
    const localPath = path.join(cwd, "packages", ext);
    const nmPath = path.join(cwd, "node_modules", ext);
    const ownSiblingPath = path.join(ownPackagesDir, ext);

    if (fs.existsSync(path.join(localPath, "package.json"))) {
      flags.push("-e", localPath);
    } else if (fs.existsSync(path.join(nmPath, "package.json"))) {
      flags.push("-e", nmPath);
    } else if (ownPackagesValid && fs.existsSync(path.join(ownSiblingPath, "package.json"))) {
      flags.push("-e", ownSiblingPath);
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
 * Spawn a Pi agent in a tmux window or session.
 *
 * Resolves the agent definition, maps model tiers, builds the pi command,
 * and launches it via tmux. Can be called from anywhere — daemon workflows,
 * scripts, or Pi extensions.
 *
 * Requires the process to be running inside tmux.
 */
export async function spawnAgent(options: SpawnAgentOptions): Promise<SpawnAgentResult> {
  const { agent: agentName, task, cwd } = options;
  const windowName = options.name || agentName;

  // Must be inside tmux
  if (!isInTmux()) {
    return {
      success: false,
      windowName,
      skippedExtensions: [],
      error: "Not running inside tmux. Start with `just start` to use agent spawning.",
    };
  }

  const config = options.config || loadConfig(cwd);

  // Find agent definition
  const agentFile = findAgentFile(cwd, config.agentPaths, agentName);
  if (!agentFile) {
    const available = discoverAgents(cwd, config.agentPaths);
    return {
      success: false,
      windowName,
      skippedExtensions: [],
      error: `Agent '${agentName}' not found. Available: ${available.join(", ") || "(none)"}`,
    };
  }

  const agent = loadAgent(agentFile);
  const wantsSession = options.session !== undefined && options.session !== false;
  const targetSessionName = typeof options.session === "string"
    ? options.session
    : (wantsSession ? windowName : undefined);

  const socket = getTmuxSocket();
  const currentSession = getTmuxSessionSync({ socket });

  // Check for conflicts
  if (wantsSession && targetSessionName && sessionExists(targetSessionName, { socket })) {
    return {
      success: false,
      windowName,
      sessionName: targetSessionName,
      skippedExtensions: [],
      error: `Session '${targetSessionName}' already exists.`,
    };
  }
  if (!wantsSession && windowExists(windowName, { socket, session: currentSession })) {
    return {
      success: false,
      windowName,
      skippedExtensions: [],
      error: `Window '${windowName}' already exists.`,
    };
  }

  // Resolve model tier → actual model string
  const resolvedModel = agent.model
    ? resolveModel(agent.model, config.models)
    : undefined;

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
  // Keep window open on failure for debugging
  const command = `${rawCommand}; EXIT=$?; if [ $EXIT -ne 0 ]; then echo "=== AGENT EXITED ($EXIT) ==="; sleep 30; fi`;

  const agentEnv = buildAgentEnv({
    agent: agentName,
    name: windowName,
    parentAgent: options.parentAgent,
    emoji: agent.emoji,
  });

  // Spawn via tmux
  const result = wantsSession
    ? await newSession({
        name: targetSessionName!,
        windowName,
        command,
        socket,
        cwd,
        env: agentEnv,
      })
    : await newWindow({
        name: windowName,
        command,
        socket,
        session: currentSession,
        background: true,
        cwd,
        env: agentEnv,
      });

  if (result.code !== 0) {
    return {
      success: false,
      windowName,
      sessionName: targetSessionName,
      model: resolvedModel,
      skippedExtensions,
      error: `tmux error: ${result.stderr || result.stdout}`,
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
      session: targetSessionName || undefined,
      ts: new Date().toISOString(),
    });
    fs.appendFileSync(treeFile, entry + "\n");
  } catch {
    // Best-effort — don't fail the spawn if logging fails
  }

  return {
    success: true,
    windowName,
    sessionName: targetSessionName,
    model: resolvedModel,
    skippedExtensions,
  };
}
