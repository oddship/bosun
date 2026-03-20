/**
 * spawn_agent tool implementation.
 *
 * Launches a new Pi agent in a tmux window with its own identity,
 * model, and extensions. Each spawned agent is an independent pi
 * process (optionally sandboxed via command_prefix).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, execFileSync } from "node:child_process";
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
 * Get the tmux session name for the current process.
 * Uses `tmux display-message` which resolves the session from $TMUX_PANE or
 * the attached client. This is critical when multiple sessions share a socket
 * (e.g. "bosun" and "bosun-daemon") — without targeting the correct session,
 * new-window may create windows in the wrong session.
 */
function getTmuxSession(socket: string | null): string | null {
  try {
    const pane = process.env.TMUX_PANE;
    const args: string[] = [];
    if (socket) args.push("-S", socket);
    // Use -t $TMUX_PANE to anchor the lookup to the spawner's pane.
    // Without this, display-message resolves via "current client" which is
    // ambiguous from a child process and may pick the wrong session.
    args.push("display-message");
    if (pane) args.push("-t", pane);
    args.push("-p", "#{session_name}");
    return execFileSync("tmux", args, { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
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
      const sessionName = getTmuxSession(checkSocket);
      const listArgs: string[] = [];
      if (checkSocket) listArgs.push("-S", checkSocket);
      listArgs.push("list-windows");
      if (sessionName) listArgs.push("-t", sessionName);
      listArgs.push("-F", "#{window_name}");
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

      // Always include pi-agents (handles identity injection + TUI agent name)
      // and pi-sandbox (security) even if not in the agent's extension list.
      for (const required of ["pi-agents", "pi-sandbox"]) {
        if (!extList.includes(required)) {
          extList.push(required);
        }
      }

      const skippedExts: string[] = [];
      for (const ext of extList.filter(Boolean)) {
        // Check if it's a local package (exists under packages/ or node_modules/)
        const localPath = path.join(ctx.cwd, "packages", ext);
        const nmPath = path.join(ctx.cwd, "node_modules", ext);
        if (fs.existsSync(path.join(localPath, "package.json"))) {
          extensionFlags.push("-e", localPath);
        } else if (fs.existsSync(path.join(nmPath, "package.json"))) {
          extensionFlags.push("-e", nmPath);
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

      // Build tmux arguments (reuse socket from duplicate check above)
      const socket = checkSocket;
      const tmuxBaseArgs: string[] = [];
      if (socket) {
        tmuxBaseArgs.push("-S", socket);
      }

      // Pass the spawning agent's identity so the child knows who to report to.
      // PI_AGENT_NAME is the unique instance name (e.g. "bosun-2").
      const parentName = process.env.PI_AGENT_NAME || process.env.PI_AGENT || "agent";

      const tmuxArgs = [
        ...tmuxBaseArgs,
        "new-window",
        "-d", // Don't switch to the new window
        // Target the correct session — critical when multiple sessions share
        // a socket (e.g. "bosun" + "bosun-daemon"). Without this, tmux may
        // create the window in whichever session was most recently active.
        ...(sessionName ? ["-t", `${sessionName}:`] : []),
        "-n",
        windowName,
        "-e",
        `PI_AGENT=${params.agent}`,
        "-e",
        `PI_AGENT_NAME=${windowName}`,
        "-e",
        `PI_PARENT_AGENT=${parentName}`,
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
            // Record the spawn in .pi/spawn-tree.jsonl so tools like the
            // session sidebar can display parent→child relationships.
            try {
              const treeFile = path.join(ctx.cwd, ".pi", "spawn-tree.jsonl");
              const entry = JSON.stringify({
                parent: parentName,
                child: windowName,
                agent: params.agent,
                model: resolvedModel || null,
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
            resolve({
              content: [
                {
                  type: "text",
                  text: [
                    `Spawned '${params.agent}' agent in tmux window '${windowName}'${modelInfo}.${skippedInfo}`,
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
