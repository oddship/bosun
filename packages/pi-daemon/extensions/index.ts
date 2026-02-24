/**
 * pi-daemon extension for Pi.
 *
 * Provides:
 * - `daemon()` tool for agents to check status, trigger rules, view logs
 * - `/daemon` command for quick status check
 * Note: Daemon is started by `just start` (justfile), not from inside Pi.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";


export default function (pi: ExtensionAPI) {
  // Resolve paths from daemon.json config
  function getStateDir(cwd: string): string {
    const configPath = join(cwd, ".pi", "daemon.json");
    if (existsSync(configPath)) {
      try {
        const raw = JSON.parse(readFileSync(configPath, "utf-8"));
        if (typeof raw.state_dir === "string") return join(cwd, raw.state_dir);
      } catch {}
    }
    return join(cwd, ".bosun-daemon");
  }

  function getStatusFile(cwd: string): string {
    return join(getStateDir(cwd), "status.json");
  }

  function getControlDir(cwd: string): string {
    return join(getStateDir(cwd), "control");
  }

  function getResponsesDir(cwd: string): string {
    return join(getStateDir(cwd), "responses");
  }

  function isDaemonRunning(cwd: string): boolean {
    const statusFile = getStatusFile(cwd);
    if (!existsSync(statusFile)) return false;
    try {
      const status = JSON.parse(readFileSync(statusFile, "utf-8"));
      const heartbeat = new Date(status.heartbeat).getTime();
      const now = Date.now();
      return status.running && now - heartbeat < 120_000; // 2 min tolerance
    } catch {
      return false;
    }
  }

  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function sendCommand(
    cwd: string,
    command: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    const id = generateId();
    const controlDir = getControlDir(cwd);
    const responsesDir = getResponsesDir(cwd);
    const commandFile = join(controlDir, `${id}.json`);
    const responseFile = join(responsesDir, `${id}.json`);

    mkdirSync(controlDir, { recursive: true });
    mkdirSync(responsesDir, { recursive: true });

    writeFileSync(commandFile, JSON.stringify(command, null, 2));

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (existsSync(responseFile)) {
        const response = JSON.parse(readFileSync(responseFile, "utf-8"));
        try {
          unlinkSync(responseFile);
        } catch {}
        return response;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    try {
      unlinkSync(commandFile);
    } catch {}
    throw new Error("Daemon response timeout");
  }

  // --- Daemon auto-start note ---
  // Daemon is started by `just start` / `_ensure-daemon` recipe in the justfile,
  // not from inside Pi. This avoids silent spawn failures and lifecycle issues
  // (daemon in a separate tmux session that outlives individual Pi sessions).

  // --- daemon() tool ---

  pi.registerTool({
    name: "daemon",
    label: "Daemon",
    description:
      "Interact with the background daemon. Actions: status, trigger (run a handler), logs (view recent logs), reload (clear handler cache), stop.",
    parameters: Type.Object({
      action: StringEnum(["status", "trigger", "logs", "reload", "stop"] as const, {
        description: "Action to perform",
      }),
      handler: Type.Optional(
        Type.String({ description: "Handler name (for trigger action)" }),
      ),
      lines: Type.Optional(
        Type.Number({ description: "Number of log lines (default 50)" }),
      ),
      context: Type.Optional(
        Type.Object({}, { additionalProperties: true, description: "Context for trigger" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const running = isDaemonRunning(ctx.cwd);

      // Status works even when not running
      if (params.action === "status") {
        if (!running) {
          return {
            content: [
              {
                type: "text",
                text: "Daemon is not running.\n\nIt auto-starts when Pi launches inside tmux (if enabled in .pi/daemon.json).\nYou can also start it manually: bun node_modules/pi-daemon/src/index.ts",
              },
            ],
          };
        }

        try {
          const response = (await sendCommand(ctx.cwd, {
            action: "status",
          })) as Record<string, unknown>;
          if (response.success && response.status) {
            const s = response.status as Record<string, unknown>;
            const queue = s.queue as Record<string, unknown> | undefined;
            const stats = s.stats as Record<string, number> | undefined;
            const watchers = s.watchers as Array<Record<string, unknown>> | undefined;

            let text = "Daemon Status: RUNNING\n";
            text += `PID: ${s.pid}\n`;
            text += `Heartbeat: ${s.heartbeat}\n\n`;

            if (queue) {
              text += `Queue: ${queue.queued || 0} waiting`;
              if (queue.current_task) text += `, running: ${queue.current_task}`;
              text += "\n";
              text += `Today: ${queue.completed_today || 0} completed, ${queue.failed_today || 0} failed\n\n`;
            }

            if (watchers) {
              text += `Watchers (${watchers.length}):\n`;
              for (const w of watchers) {
                text += `  ${w.enabled ? "[ON]" : "[OFF]"} ${w.name}: ${w.pattern}\n`;
              }
              text += "\n";
            }

            if (stats) {
              text += `Stats:\n`;
              text += `  Handlers run: ${stats.handlers_run || 0}\n`;
              text += `  Errors: ${stats.errors || 0}\n`;
            }

            return { content: [{ type: "text", text }] };
          }
        } catch {
          // Fallback to reading status file
        }

        // Fallback
        const statusFile = getStatusFile(ctx.cwd);
        if (existsSync(statusFile)) {
          const raw = readFileSync(statusFile, "utf-8");
          return { content: [{ type: "text", text: `Daemon status (raw):\n${raw}` }] };
        }

        return { content: [{ type: "text", text: "Daemon status file not found." }] };
      }

      // All other actions require daemon to be running
      if (!running) {
        return {
          content: [
            {
              type: "text",
              text: "Daemon is not running. It auto-starts when Pi launches inside tmux.",
            },
          ],
        };
      }

      try {
        switch (params.action) {
          case "trigger": {
            if (!params.handler) {
              return {
                content: [
                  { type: "text", text: "Error: handler name required for trigger action" },
                ],
              };
            }
            const response = await sendCommand(ctx.cwd, {
              action: "trigger",
              handler: params.handler,
              context: params.context || {},
            });
            return {
              content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
          }

          case "logs": {
            const lines = Math.min(Math.max(params.lines || 50, 1), 1000);
            const response = (await sendCommand(ctx.cwd, {
              action: "logs",
              lines,
            })) as { success: boolean; logs?: string[] };

            if (response.success && response.logs) {
              return {
                content: [
                  { type: "text", text: response.logs.join("\n") || "(no logs)" },
                ],
              };
            }
            return { content: [{ type: "text", text: "Failed to get logs" }] };
          }

          case "reload": {
            const response = await sendCommand(ctx.cwd, { action: "reload" });
            return {
              content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
          }

          case "stop": {
            await sendCommand(ctx.cwd, { action: "stop" });
            return {
              content: [{ type: "text", text: "Daemon stop requested." }],
            };
          }

          default:
            return {
              content: [{ type: "text", text: `Unknown action: ${params.action}` }],
            };
        }
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
        };
      }
    },
  });

  // --- /daemon command ---

  pi.registerCommand("daemon", {
    description: "Check daemon status",
    handler: async (_args, ctx) => {
      if (isDaemonRunning(ctx.cwd)) {
        const statusFile = getStatusFile(ctx.cwd);
        try {
          const raw = JSON.parse(readFileSync(statusFile, "utf-8"));
          ctx.ui.notify(`Daemon running (PID ${raw.pid})`, "info");
        } catch {
          ctx.ui.notify("Daemon running", "info");
        }
      } else {
        ctx.ui.notify("Daemon is not running", "warning");
      }
    },
  });
}
