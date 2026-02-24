import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initQueue, setHandlerRunner, enqueueTasks, processQueue, getQueueStatus } from "../src/queue.js";
import { initRulesState } from "../src/rules.js";
import { initTriggers } from "../src/triggers.js";
import type { QueuedTask } from "../src/types.js";

describe("task queue", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-daemon-queue-"));
    initQueue(tmpDir);
    initRulesState(tmpDir);
    initTriggers(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enqueues tasks", () => {
    enqueueTasks([
      { id: "t1", rule: "r1", handler: "h1", context: {}, priority: "normal" },
      { id: "t2", rule: "r2", handler: "h2", context: {}, priority: "high" },
    ]);

    const status = getQueueStatus();
    expect(status.queued).toBe(2);
  });

  it("deduplicates by rule name", () => {
    enqueueTasks([
      { id: "t1", rule: "r1", handler: "h1", context: {}, priority: "normal" },
    ]);
    enqueueTasks([
      { id: "t2", rule: "r1", handler: "h1", context: {}, priority: "normal" },
    ]);

    const status = getQueueStatus();
    expect(status.queued).toBe(1);
  });

  it("processes tasks and calls handler", async () => {
    let handlerCalled = false;
    let handlerName = "";

    setHandlerRunner(async (handler, _ctx) => {
      handlerCalled = true;
      handlerName = handler;
    });

    enqueueTasks([
      { id: "t1", rule: "r1", handler: "my-handler", context: {}, priority: "normal" },
    ]);

    await processQueue();

    expect(handlerCalled).toBe(true);
    expect(handlerName).toBe("my-handler");

    const status = getQueueStatus();
    expect(status.queued).toBe(0);
    expect(status.completed_today).toBe(1);
  });

  it("retries failed tasks with backoff", async () => {
    let callCount = 0;

    setHandlerRunner(async () => {
      callCount++;
      if (callCount <= 2) throw new Error("transient failure");
    });

    enqueueTasks([
      { id: "t1", rule: "r1", handler: "h1", context: {}, priority: "normal" },
    ]);

    // First attempt — fails
    await processQueue();
    expect(callCount).toBe(1);

    let status = getQueueStatus();
    expect(status.queued).toBe(1); // Re-queued with backoff

    // Second attempt — still in backoff, should not run
    await processQueue();
    expect(callCount).toBe(1); // Didn't run because of backoff
  });

  it("moves permanently failed tasks to history", async () => {
    setHandlerRunner(async () => {
      throw new Error("permanent failure");
    });

    enqueueTasks([
      { id: "t1", rule: "r1", handler: "h1", context: {}, priority: "normal" },
    ]);

    // Run 3 attempts (max_attempts = 3)
    // Need to clear backoff between attempts for test
    for (let i = 0; i < 3; i++) {
      // Force clear backoff by manipulating queue file
      const queueFile = path.join(tmpDir, "queue.json");
      if (fs.existsSync(queueFile)) {
        const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
        for (const task of queue.tasks) {
          task.backoff_until = undefined;
        }
        fs.writeFileSync(queueFile, JSON.stringify(queue));
      }
      await processQueue();
    }

    const status = getQueueStatus();
    expect(status.queued).toBe(0);
    expect(status.failed_today).toBe(1);
  });

  it("sorts by priority (high first)", () => {
    enqueueTasks([
      { id: "t1", rule: "r-low", handler: "h1", context: {}, priority: "low" },
      { id: "t2", rule: "r-high", handler: "h2", context: {}, priority: "high" },
      { id: "t3", rule: "r-normal", handler: "h3", context: {}, priority: "normal" },
    ]);

    let firstHandler = "";
    setHandlerRunner(async (handler) => {
      if (!firstHandler) firstHandler = handler;
    });

    // Process first task — should be high priority
    processQueue().then(() => {
      expect(firstHandler).toBe("h2");
    });
  });
});
