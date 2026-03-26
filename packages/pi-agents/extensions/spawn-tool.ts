/**
 * spawn_agent Pi tool — thin wrapper around src/spawn.ts.
 *
 * Registers the spawn_agent tool on the Pi ExtensionAPI.
 * All resolution and spawning logic lives in the library.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AgentsConfig } from "../src/config.js";
import { spawnAgent } from "../src/spawn.js";

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
      const config = getConfig(ctx.cwd);

      const result = await spawnAgent({
        agent: params.agent,
        task: params.task,
        name: params.name,
        session: params.session,
        cwd: ctx.cwd,
        config,
      });

      if (!result.success) {
        // Provide helpful suggestions in error messages
        let errorText = `Error: ${result.error}`;
        if (result.error?.includes("already exists")) {
          const suffix = result.sessionName ? "session" : "name";
          errorText += `\n  spawn_agent({ agent: "${params.agent}", ${suffix}: "${result.windowName}-2" })`;
        }

        return {
          content: [{ type: "text", text: errorText }],
          isError: true,
        };
      }

      const modelInfo = result.model ? ` (model: ${result.model})` : "";
      const skippedInfo = result.skippedExtensions.length
        ? `\nSkipped extensions (not installed): ${result.skippedExtensions.join(", ")}`
        : "";
      const location = result.sessionName
        ? `session '${result.sessionName}'`
        : `tmux window '${result.windowName}'`;

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
