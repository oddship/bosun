/**
 * Filesystem-based control interface.
 *
 * Agents write JSON commands to state_dir/control/.
 * The daemon watches for new files, processes commands,
 * and writes responses to state_dir/responses/.
 */

import { watch, type FSWatcher } from "chokidar";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { info, error } from "./logger.js";
import { getQueueStatus, enqueueTasks, isQueued } from "./queue.js";
import type { DaemonStatus } from "./types.js";

let controlDir: string;
let responsesDir: string;
let logFilePath: string;
let statusGetter: (() => DaemonStatus) | null = null;
let controlWatcher: FSWatcher | null = null;

export function initControl(
  stateDir: string,
  logFile: string,
  getStatus: () => DaemonStatus,
): void {
  controlDir = join(stateDir, "control");
  responsesDir = join(stateDir, "responses");
  logFilePath = logFile;
  statusGetter = getStatus;

  mkdirSync(controlDir, { recursive: true });
  mkdirSync(responsesDir, { recursive: true });
}

export function startControl(): void {
  controlWatcher = watch(controlDir, { ignoreInitial: true });

  controlWatcher.on("add", async (path) => {
    try {
      const content = readFileSync(path, "utf-8");
      const command = JSON.parse(content);
      const id = basename(path, ".json");

      info(`Received command: ${command.action} (${id})`);

      const response = await handleCommand(command);
      writeFileSync(join(responsesDir, `${id}.json`), JSON.stringify(response, null, 2));

      // Clean up command file
      try {
        unlinkSync(path);
      } catch {}
    } catch (err) {
      error(`Failed to process command: ${err}`);
    }
  });
}

export function stopControl(): void {
  controlWatcher?.close();
  controlWatcher = null;
}

async function handleCommand(
  command: { action: string; [key: string]: unknown },
): Promise<Record<string, unknown>> {
  switch (command.action) {
    case "status": {
      const status = statusGetter?.();
      if (!status) return { success: false, error: "Status not available" };
      const queue = getQueueStatus();
      return { success: true, status: { ...status, queue } };
    }

    case "trigger": {
      if (typeof command.handler !== "string") {
        return { success: false, error: "handler (workflow name) required" };
      }
      // Fire-and-forget: enqueues the workflow for async processing
      const name = command.handler;
      if (isQueued(name)) {
        return { success: true, message: `${name} already queued — skipped` };
      }
      enqueueTasks([{
        id: `${name}-manual-${Date.now()}`,
        rule: name,
        handler: name,
        context: (command.context as Record<string, unknown>) || {},
        priority: "normal",
      }]);
      return { success: true, message: `Enqueued ${name}` };
    }

    case "logs": {
      const lines = typeof command.lines === "number" ? command.lines : 50;
      try {
        const content = readFileSync(logFilePath, "utf-8");
        const logLines = content.split("\n").slice(-lines);
        return { success: true, logs: logLines };
      } catch {
        return { success: true, logs: [] };
      }
    }

    case "reload": {
      // No-op — workflows are discovered fresh on each run
      return { success: true, message: "Reload acknowledged (workflows are stateless)" };
    }

    case "stop": {
      info("Received stop command");
      process.emit("SIGTERM");
      return { success: true, message: "Stopping" };
    }

    default:
      return { success: false, error: `Unknown action: ${command.action}` };
  }
}
