import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initRulesState, evaluateRules, updateRuleState, loadRulesState, catchUpRules } from "../src/rules.js";
import { initTriggers, addTrigger } from "../src/triggers.js";
import type { RuleConfig } from "../src/types.js";

describe("rules engine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-daemon-rules-"));
    initRulesState(tmpDir);
    initTriggers(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("evaluateRules", () => {
    it("returns empty array when no rules match", () => {
      const rules: RuleConfig[] = [
        { name: "r1", trigger: "w1", handler: "h1" },
      ];
      const tasks = evaluateRules(rules);
      expect(tasks).toEqual([]);
    });

    it("matches trigger rule when trigger exists", () => {
      addTrigger("w1", "/some/file.txt", "change");

      const rules: RuleConfig[] = [
        { name: "r1", trigger: "w1", handler: "h1" },
      ];
      const tasks = evaluateRules(rules);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].rule).toBe("r1");
      expect(tasks[0].handler).toBe("h1");
      expect(tasks[0].context).toHaveProperty("paths");
    });

    it("skips rules that are already running", () => {
      addTrigger("w1", "/some/file.txt", "change");
      updateRuleState("r1", "running");

      const rules: RuleConfig[] = [
        { name: "r1", trigger: "w1", handler: "h1" },
      ];
      const tasks = evaluateRules(rules);
      expect(tasks).toEqual([]);
    });

    it("matches schedule rule (hourly) when never run", () => {
      const rules: RuleConfig[] = [
        { name: "r1", schedule: "hourly", handler: "h1" },
      ];
      const tasks = evaluateRules(rules);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].rule).toBe("r1");
    });

    it("skips hourly rule if run recently", () => {
      updateRuleState("r1", "success");

      const rules: RuleConfig[] = [
        { name: "r1", schedule: "hourly", handler: "h1" },
      ];
      const tasks = evaluateRules(rules);
      expect(tasks).toEqual([]);
    });

    it("respects stale_minutes for trigger rules", () => {
      // Add a trigger that just happened (not stale yet)
      addTrigger("w1", "/some/file.txt", "change");

      const rules: RuleConfig[] = [
        { name: "r1", trigger: "w1", handler: "h1", stale_minutes: 5 },
      ];
      const tasks = evaluateRules(rules);
      // Trigger is fresh, not stale — should NOT match
      expect(tasks).toEqual([]);
    });
  });

  describe("updateRuleState", () => {
    it("persists rule state", () => {
      updateRuleState("r1", "success");
      const state = loadRulesState();
      expect(state.r1).toBeDefined();
      expect(state.r1.last_result).toBe("success");
      expect(state.r1.last_run).toBeTruthy();
    });

    it("stores error message on failure", () => {
      updateRuleState("r1", "failed", "something went wrong");
      const state = loadRulesState();
      expect(state.r1.last_result).toBe("failed");
      expect(state.r1.last_error).toBe("something went wrong");
    });
  });

  describe("catchUpRules", () => {
    it("re-queues interrupted rules", () => {
      updateRuleState("r1", "running");

      const rules: RuleConfig[] = [
        { name: "r1", schedule: "hourly", handler: "h1" },
      ];
      const tasks = catchUpRules(rules);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].priority).toBe("high");
    });

    it("retries transient failures", () => {
      updateRuleState("r1", "failed", "ETIMEDOUT: connection timed out");

      const rules: RuleConfig[] = [
        { name: "r1", schedule: "hourly", handler: "h1" },
      ];
      const tasks = catchUpRules(rules);
      expect(tasks).toHaveLength(1);
    });

    it("does not retry permanent failures", () => {
      updateRuleState("r1", "failed", "Handler not found");

      const rules: RuleConfig[] = [
        { name: "r1", schedule: "hourly", handler: "h1" },
      ];
      const tasks = catchUpRules(rules);
      expect(tasks).toEqual([]);
    });
  });
});
