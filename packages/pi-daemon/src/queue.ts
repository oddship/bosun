/**
 * Task queue with retry, backoff, and crash recovery.
 *
 * FIFO within priority bands. Sequential execution (one task at a time).
 * State checkpointed to disk for crash recovery.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { info, debug, error } from "./logger.js";
import { updateRuleState } from "./rules.js";
import { clearProcessedTriggers } from "./triggers.js";
import type { Queue, QueueEntry, QueuedTask } from "./types.js";

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 } as const;

/** Max time (ms) a task can stay "running" before considered stale. */
const STALE_RUNNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let queueFile: string;
let isProcessing = false;

/** Handler runner — set from outside to break circular dependency. */
let runHandlerFn: ((handler: string, context: Record<string, unknown>) => Promise<void>) | null =
  null;

export function initQueue(stateDir: string): void {
  queueFile = join(stateDir, "queue.json");
  mkdirSync(dirname(queueFile), { recursive: true });
}

export function setHandlerRunner(
  fn: (handler: string, context: Record<string, unknown>) => Promise<void>,
): void {
  runHandlerFn = fn;
}

// --- Persistence ---

function loadQueue(): Queue {
  if (!existsSync(queueFile)) {
    return { tasks: [], history: [], max_history: 100 };
  }
  try {
    return JSON.parse(readFileSync(queueFile, "utf-8"));
  } catch {
    return { tasks: [], history: [], max_history: 100 };
  }
}

function saveQueue(queue: Queue): void {
  const tmpFile = queueFile + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(queue, null, 2));
  renameSync(tmpFile, queueFile);
}

function sortByPriority(tasks: QueueEntry[]): void {
  tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

function moveToHistory(queue: Queue, task: QueueEntry): void {
  queue.tasks = queue.tasks.filter((t) => t.id !== task.id);
  queue.history.unshift(task);
  if (queue.history.length > queue.max_history) {
    queue.history = queue.history.slice(0, queue.max_history);
  }
}

function calculateBackoff(attempts: number): string {
  // 30s, 2m, 8m for attempts 1, 2, 3
  const delayMs = 30_000 * Math.pow(2, attempts);
  return new Date(Date.now() + delayMs).toISOString();
}

// --- Public API ---

/** Add tasks to queue (deduplicates by rule name). */
export function enqueueTasks(tasks: QueuedTask[]): void {
  if (tasks.length === 0) return;

  const queue = loadQueue();

  for (const task of tasks) {
    // Skip if same rule is already queued or running
    const existing = queue.tasks.find(
      (t) => t.rule === task.rule && (t.status === "queued" || t.status === "running"),
    );
    if (existing) {
      debug(`Task already in queue: ${task.rule}`);
      continue;
    }

    const entry: QueueEntry = {
      ...task,
      status: "queued",
      created_at: new Date().toISOString(),
      attempts: 0,
      max_attempts: 3,
    };

    queue.tasks.push(entry);
    info(`Enqueued task: ${task.rule} (priority: ${task.priority})`);
  }

  sortByPriority(queue.tasks);
  saveQueue(queue);
}

/** Process the next ready task. Called on each heartbeat. */
export async function processQueue(): Promise<void> {
  if (isProcessing) {
    debug("Queue processing already in progress");
    return;
  }

  isProcessing = true;

  try {
    const queue = loadQueue();

    // Recover stale "running" tasks from previous daemon lifecycle
    const now = new Date();
    for (const task of queue.tasks) {
      if (task.status === "running" && task.started_at) {
        const elapsed = now.getTime() - new Date(task.started_at).getTime();
        if (elapsed > STALE_RUNNING_TIMEOUT_MS) {
          const msg = `Stale running task: ${task.rule} (${Math.round(elapsed / 60_000)}m). Resetting.`;
          info(msg);
          if (task.attempts >= task.max_attempts) {
            task.status = "failed";
            task.completed_at = now.toISOString();
            task.last_error = msg;
            updateRuleState(task.rule, "failed", msg);
            moveToHistory(queue, task);
          } else {
            task.status = "queued";
            task.backoff_until = undefined;
            updateRuleState(task.rule, "failed", msg);
          }
          saveQueue(queue);
        }
      }
    }

    // Find next ready task
    const task = queue.tasks.find((t) => {
      if (t.status !== "queued") return false;
      if (t.backoff_until && now < new Date(t.backoff_until)) return false;
      return true;
    });

    if (!task) {
      debug("No tasks ready for processing");
      return;
    }

    if (!runHandlerFn) {
      error("No handler runner configured — cannot process queue");
      return;
    }

    info(`Processing task: ${task.rule} (attempt ${task.attempts + 1}/${task.max_attempts})`);

    // Mark running
    task.status = "running";
    task.started_at = new Date().toISOString();
    task.attempts++;
    saveQueue(queue);
    updateRuleState(task.rule, "running");

    try {
      await runHandlerFn(task.handler, {
        ...task.context,
        _task_id: task.id,
        _rule: task.rule,
        _handler: task.handler,
      });

      // Success
      task.status = "completed";
      task.completed_at = new Date().toISOString();
      updateRuleState(task.rule, "success");

      // Clear processed triggers
      if (Array.isArray(task.context.triggeredPaths)) {
        clearProcessedTriggers(task.context.triggeredPaths as string[]);
      }

      moveToHistory(queue, task);
      info(`Task completed: ${task.rule}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      task.last_error = errorMsg;
      error(`Task failed: ${task.rule} — ${errorMsg}`);

      if (task.attempts >= task.max_attempts) {
        task.status = "failed";
        task.completed_at = new Date().toISOString();
        updateRuleState(task.rule, "failed", errorMsg);
        moveToHistory(queue, task);
        info(`Task permanently failed after ${task.attempts} attempts: ${task.rule}`);
      } else {
        task.status = "queued";
        task.backoff_until = calculateBackoff(task.attempts);
        info(`Task will retry at ${task.backoff_until}: ${task.rule}`);
      }
    }

    saveQueue(queue);
  } finally {
    isProcessing = false;
  }
}

/** Get queue status for display. */
export function getQueueStatus(): {
  queued: number;
  running: number;
  completed_today: number;
  failed_today: number;
  current_task?: string;
} {
  const queue = loadQueue();
  const today = new Date().toDateString();

  const current = queue.tasks.find((t) => t.status === "running");

  return {
    queued: queue.tasks.filter((t) => t.status === "queued").length,
    running: current ? 1 : 0,
    completed_today: queue.history.filter(
      (t) => t.status === "completed" && t.completed_at && new Date(t.completed_at).toDateString() === today,
    ).length,
    failed_today: queue.history.filter(
      (t) => t.status === "failed" && t.completed_at && new Date(t.completed_at).toDateString() === today,
    ).length,
    current_task: current?.rule,
  };
}
