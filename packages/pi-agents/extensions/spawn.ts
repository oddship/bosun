/**
 * spawn_agent tool implementation.
 *
 * Launches a new Pi agent in a tmux window with its own identity,
 * model, and extensions. Each spawned agent is an independent pi
 * process (optionally sandboxed via command_prefix).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AgentsConfig } from "./config.js";
import { discoverAgents, findAgentFile, loadAgent } from "./agents.js";

/** Shell-escape a string by wrapping in single quotes. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Extract the tmux socket path from config or $TMUX env var.
 * $TMUX format: "/path/to/socket,pid,index"
 */
function getTmuxSocket(config: AgentsConfig, cwd: string): string | null {
  if (config.backend.socket) {
    // Resolve relative socket paths against cwd
    const sock = config.backend.socket;
    return sock.startsWith("/") ? sock : `${cwd}/${sock}`;
  }

  const tmuxEnv = process.env.TMUX;
  if (tmuxEnv) {
    const parts = tmuxEnv.split(",");
    if (parts[0]) return parts[0];
  }

  return null;
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
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Must be inside tmux
      if (!process.env.TMUX) {
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

      // Check for duplicate tmux window names
      const checkSocket = getTmuxSocket(config, ctx.cwd);
      const listArgs = checkSocket ? ["-S", checkSocket, "list-windows", "-F", "#{window_name}"] : ["list-windows", "-F", "#{window_name}"];
      try {
        const { execFileSync } = await import("node:child_process");
        const existing = execFileSync("tmux", listArgs, { encoding: "utf-8" }).trim().split("\n");
        if (existing.includes(windowName)) {
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
      } catch {
        // tmux list failed — proceed anyway
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

      // Always include pi-sandbox for security (if not already listed)
      if (!extList.includes("pi-sandbox")) {
        extList.push("pi-sandbox");
      }

      for (const ext of extList.filter(Boolean)) {
        // Check if it's a local package (exists under packages/ or node_modules/)
        const localPath = path.join(ctx.cwd, "packages", ext);
        const nmPath = path.join(ctx.cwd, "node_modules", ext);
        if (fs.existsSync(localPath)) {
          extensionFlags.push("-e", localPath);
        } else if (fs.existsSync(nmPath)) {
          extensionFlags.push("-e", nmPath);
        } else {
          extensionFlags.push("-e", `npm:${ext}`);
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

      // Build tmux arguments
      const socket = getTmuxSocket(config, ctx.cwd);
      const tmuxBaseArgs: string[] = [];
      if (socket) {
        tmuxBaseArgs.push("-S", socket);
      }

      const tmuxArgs = [
        ...tmuxBaseArgs,
        "new-window",
        "-d", // Don't switch to the new window
        "-n",
        windowName,
        "-e",
        `PI_AGENT=${params.agent}`,
        "-e",
        `PI_AGENT_NAME=${windowName}`,
        command,
      ];

      return new Promise((resolve) => {
        const proc = spawn("tmux", tmuxArgs, {
          cwd: ctx.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        proc.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });

        proc.on("close", (code) => {
          if (code !== 0) {
            resolve({
              content: [
                {
                  type: "text",
                  text: `Error spawning agent: ${stderr || stdout}`,
                },
              ],
              isError: true,
            });
          } else {
            const modelInfo = resolvedModel ? ` (model: ${resolvedModel})` : "";
            resolve({
              content: [
                {
                  type: "text",
                  text: [
                    `Spawned '${params.agent}' agent in tmux window '${windowName}'${modelInfo}.`,
                    "",
                    "The agent is running with its persona and extensions loaded.",
                    "Use pi-mesh to communicate, or tmux to observe.",
                  ].join("\n"),
                },
              ],
            });
          }
        });
      });
    },
  });
}
