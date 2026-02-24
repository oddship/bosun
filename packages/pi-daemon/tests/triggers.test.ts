import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  initTriggers,
  addTrigger,
  hasTrigger,
  getTriggers,
  hasStaleTrigger,
  clearProcessedTriggers,
} from "../src/triggers.js";

describe("triggers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-daemon-triggers-"));
    initTriggers(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts with no pending triggers", () => {
    expect(hasTrigger("w1")).toBe(false);
    expect(getTriggers("w1")).toEqual([]);
  });

  it("adds and retrieves triggers", () => {
    addTrigger("w1", "/a/file.txt", "change");
    addTrigger("w1", "/b/file.txt", "add");

    expect(hasTrigger("w1")).toBe(true);
    const triggers = getTriggers("w1");
    expect(triggers).toHaveLength(2);
    expect(triggers[0].path).toBe("/a/file.txt");
    expect(triggers[1].path).toBe("/b/file.txt");
  });

  it("deduplicates by path", () => {
    addTrigger("w1", "/a/file.txt", "change");
    addTrigger("w1", "/a/file.txt", "change");

    expect(getTriggers("w1")).toHaveLength(1);
  });

  it("separates triggers by watcher name", () => {
    addTrigger("w1", "/a.txt", "change");
    addTrigger("w2", "/b.txt", "change");

    expect(getTriggers("w1")).toHaveLength(1);
    expect(getTriggers("w2")).toHaveLength(1);
    expect(hasTrigger("w3")).toBe(false);
  });

  it("clears processed triggers", () => {
    addTrigger("w1", "/a.txt", "change");
    addTrigger("w1", "/b.txt", "change");

    clearProcessedTriggers(["/a.txt"]);

    const remaining = getTriggers("w1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].path).toBe("/b.txt");
  });

  it("hasStaleTrigger returns false for fresh triggers", () => {
    addTrigger("w1", "/a.txt", "change");
    expect(hasStaleTrigger("w1", 5)).toBe(false);
  });

  it("hasStaleTrigger returns true for old triggers", () => {
    // Manually write an old trigger
    const triggersFile = path.join(tmpDir, "triggers.json");
    const oldTimestamp = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
    fs.writeFileSync(
      triggersFile,
      JSON.stringify({
        pending: [
          { path: "/old.txt", event: "change", timestamp: oldTimestamp, watcher: "w1" },
        ],
        last_processed: null,
      }),
    );

    expect(hasStaleTrigger("w1", 5)).toBe(true);
    expect(hasStaleTrigger("w1", 15)).toBe(false);
  });
});
