/**
 * spawn_agent tool implementation.
 *
 * Launches a new Pi agent in a tmux window with its own identity,
 * model, and extensions. Each spawned agent is an independent pi
 * process (optionally sandboxed via command_prefix).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AgentsConfig } from "./config.js";
import { discoverAgents, findAgentFile, loadAgent } from "./agents.js";
import {
  isInTmux,
  getTmuxSocket,
  getTmuxSessionSync,
  windowExists,
  sessionExists,
  newWindow,
  newSession,
} from "../../pi-tmux/core.ts";

/** Shell-escape a string by wrapping in single quotes. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Register the spawn_agent tool on the given ExtensionAPI.
 * Config is loaded lazily via the getter (needs ctx.cwd at execute time).
 */
export function registerSpawnAgent(
  pi: ExtensionAPI,
  getConfig: (cwd: string) => AgentsConfig,
): void {
  pi.registerTool({
    name: "spawn_agent",
    label: "Spawn Agent",
    description: [
      "Spawn a new Pi agent in a tmux window with its own identity, model, and extensions.",
      "The agent loads its persona from .pi/agents/{name}.md and runs as an independent process.",
      "Use for parallel work, delegation, or specialist tasks.",
    ].join(" "),

    parameters: Type.Object({
      agent: Type.String({
        description: "Agent name (e.g., 'lite', 'verify'). Loads from .pi/agents/{agent}.md",
      }),
      task: Type.Optional(
        Type.String({
          description: "Initial task/prompt for the agent",
        }),
      ),
      name: Type.Optional(
        Type.String({
          description: "Window/peer name (default: agent name)",
        }),
      ),
      session: Type.Optional(
        Type.Union([
          Type.Boolean({ description: "true to create a new tmux session (auto-named)" }),
          Type.String({ description: "Named tmux session to create" }),
        ], {
          description: "Create the agent in a new tmux session instead of a window. Pass true for auto-naming or a string for a specific session name.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Must be inside tmux
      if (!isInTmux()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Not running inside tmux. Start with `just start` to use agent spawning.",
            },
          ],
          isError: true,
        };
      }

      const config = getConfig(ctx.cwd);

      // Find the agent definition
      const agentFile = findAgentFile(ctx.cwd, config.agentPaths, params.agent);
      if (!agentFile) {
        const available = discoverAgents(ctx.cwd, config.agentPaths);
        return {
          content: [
            {
              type: "text",
              text: `Error: Agent '${params.agent}' not found.\nAvailable agents: ${available.join(", ") || "(none)"}`,
            },
          ],
          isError: true,
        };
      }

      const agent = loadAgent(agentFile);
      const windowName = params.name || params.agent;
      const wantsSession = params.session !== undefined && params.session !== false;
      const targetSessionName = typeof params.session === "string" ? params.session : (wantsSession ? windowName : null);

      const socket = getTmuxSocket();
      const currentSession = getTmuxSessionSync({ socket });

      // Check for conflicts
      if (wantsSession && targetSessionName && sessionExists(targetSessionName, { socket })) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Session '${targetSessionName}' already exists. Use a different name:\n  spawn_agent({ agent: "${params.agent}", session: "${targetSessionName}-2" })`,
            },
          ],
          isError: true,
        };
      }
      if (!wantsSession && windowExists(windowName, { socket, session: currentSession })) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Window '${windowName}' already exists. Use a different name:\n  spawn_agent({ agent: "${params.agent}", name: "${windowName}-2" })`,
            },
          ],
          isError: true,
        };
      }

      // Resolve model tier → actual model string
      // If the model value is a tier name in config.models, use the mapping.
      // Otherwise use the raw value (it might already be a model string).
      const resolvedModel = agent.model
        ? config.models[agent.model] ?? agent.model
        : undefined;

      // Build extension flags from agent's extensions list
      const extensionFlags: string[] = [];
      const extList: string[] = agent.extensions
        ? Array.isArray(agent.extensions)
          ? [...agent.extensions]
          : agent.extensions.split(",").map((s) => s.trim())
        : [];

      // Always include pi-agents (handles identity injection + TUI agent name)
      // and pi-sandbox (security) even if not in the agent's extension list.
      for (const required of ["pi-agents", "pi-sandbox"]) {
        if (!extList.includes(required)) {
          extList.push(required);
        }
      }

      // Resolve the monorepo packages/ directory from this file's location.
      // spawn.ts lives at {root}/packages/pi-agents/extensions/spawn.ts,
      // so going up 2 levels reaches {root}/packages/.
      // This is needed when ctx.cwd is a downstream project that doesn't
      // have pi-agents/pi-sandbox in its own packages/ or node_modules/.
      const ownPackagesDir = path.resolve(import.meta.dirname, "..", "..");
      // Sanity-check: if we can't find ourselves, the depth assumption is wrong
      // (e.g., spawn.ts was moved). Disable the fallback rather than resolve junk.
      const ownPackagesValid = fs.existsSync(
        path.join(ownPackagesDir, "pi-agents", "package.json"),
      );

      const skippedExts: string[] = [];
      for (const ext of extList.filter(Boolean)) {
        // Check if it's a local package (exists under packages/ or node_modules/)
        const localPath = path.join(ctx.cwd, "packages", ext);
        const nmPath = path.join(ctx.cwd, "node_modules", ext);
        const ownSiblingPath = path.join(ownPackagesDir, ext);
        if (fs.existsSync(path.join(localPath, "package.json"))) {
          extensionFlags.push("-e", localPath);
        } else if (fs.existsSync(path.join(nmPath, "package.json"))) {
          extensionFlags.push("-e", nmPath);
        } else if (ownPackagesValid && fs.existsSync(path.join(ownSiblingPath, "package.json"))) {
          // Found as a sibling package in the same monorepo as pi-agents
          extensionFlags.push("-e", ownSiblingPath);
        } else {
          // Extension not found locally — skip gracefully instead of
          // trying npm: which would fail if the user removed the package.
          skippedExts.push(ext);
        }
      }

      // Build the pi command arguments
      const piArgs: string[] = ["--no-extensions"];
      piArgs.push(...extensionFlags);
      if (resolvedModel) {
        piArgs.push("--models", resolvedModel);
      }
      if (params.task) {
        piArgs.push(params.task);
      }

      // Build full command with optional sandbox prefix
      const piArgsStr = piArgs.map(shellEscape).join(" ");
      const rawCommand = config.backend.command_prefix
        ? `${config.backend.command_prefix} pi ${piArgsStr}`
        : `pi ${piArgsStr}`;
      // Wrap command so failures keep the window open for debugging
      const command = `${rawCommand}; EXIT=$?; if [ $EXIT -ne 0 ]; then echo "=== AGENT EXITED ($EXIT) ==="; sleep 30; fi`;

      // Pass the spawning agent's identity so the child knows who to report to.
      // PI_AGENT_NAME is the unique instance name (e.g. "bosun-2").
      const parentName = process.env.PI_AGENT_NAME || process.env.PI_AGENT || "agent";

      const agentEnv = {
        PI_AGENT: params.agent,
        PI_AGENT_NAME: windowName,
        PI_PARENT_AGENT: parentName,
        PI_AGENT_EMOJI: agent.emoji || "🤖",
      };

      const result = wantsSession
        ? await newSession({
            name: targetSessionName!,
            windowName,
            command,
            socket,
            cwd: ctx.cwd,
            env: agentEnv,
          })
        : await newWindow({
            name: windowName,
            command,
            socket,
            session: currentSession,
            background: true,
            cwd: ctx.cwd,
            env: agentEnv,
          });

      if (result.code !== 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error spawning agent: ${result.stderr || result.stdout}`,
            },
          ],
          isError: true,
        };
      }

      // Record the spawn in .pi/spawn-tree.jsonl so tools like the
      // session sidebar can display parent→child relationships.
      try {
        const treeFile = path.join(ctx.cwd, ".pi", "spawn-tree.jsonl");
        const entry = JSON.stringify({
          parent: parentName,
          child: windowName,
          agent: params.agent,
          model: resolvedModel || null,
          session: targetSessionName || undefined,
          ts: new Date().toISOString(),
        });
        fs.appendFileSync(treeFile, entry + "\n");
      } catch {
        // Best-effort — don't fail the spawn if logging fails
      }

      const modelInfo = resolvedModel ? ` (model: ${resolvedModel})` : "";
      const skippedInfo = skippedExts.length
        ? `\nSkipped extensions (not installed): ${skippedExts.join(", ")}`
        : "";
      const location = wantsSession
        ? `session '${targetSessionName}'`
        : `tmux window '${windowName}'`;
      return {
        content: [
          {
            type: "text",
            text: [
              `Spawned '${params.agent}' agent in ${location}${modelInfo}.${skippedInfo}`,
              "",
              "The agent is running with its persona and extensions loaded.",
              "Use pi-mesh to communicate, or tmux to observe.",
            ].join("\n"),
          },
        ],
      };
    },
  });
}
