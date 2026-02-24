/**
 * Config-driven rules engine.
 *
 * pi-daemon evaluates rules purely from daemon.json config:
 *
 * - trigger rules: fire when a watcher has pending triggers
 *   (optionally with stale_minutes debounce)
 * - schedule rules: fire on "hourly" or "daily:HH" cadence
 *
 * The rules engine runs on heartbeat, checks conditions, and
 * returns tasks to enqueue.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { info, debug, error } from "./logger.js";
import { hasTrigger, hasStaleTrigger, getTriggers } from "./triggers.js";
import type { RuleConfig, RulesState, RuleRunRecord, QueuedTask } from "./types.js";

let rulesStateFile: string;

export function initRulesState(stateDir: string): void {
  rulesStateFile = join(stateDir, "rules-state.json");
  mkdirSync(dirname(rulesStateFile), { recursive: true });
}

export function loadRulesState(): RulesState {
  if (!existsSync(rulesStateFile)) return {};
  try {
    return JSON.parse(readFileSync(rulesStateFile, "utf-8"));
  } catch {
    return {};
  }
}

function saveRulesState(state: RulesState): void {
  const tmpFile = rulesStateFile + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  renameSync(tmpFile, rulesStateFile);
}

export function updateRuleState(
  ruleName: string,
  result: "success" | "failed" | "running",
  errorMsg?: string,
): void {
  const state = loadRulesState();
  state[ruleName] = {
    last_run: new Date().toISOString(),
    last_result: result,
    ...(errorMsg && { last_error: errorMsg }),
  };
  saveRulesState(state);
}

// --- Condition evaluation ---

function checkTriggerCondition(rule: RuleConfig): boolean {
  if (!rule.trigger) return false;

  if (rule.stale_minutes != null) {
    return hasStaleTrigger(rule.trigger, rule.stale_minutes);
  }

  return hasTrigger(rule.trigger);
}

function checkScheduleCondition(rule: RuleConfig, state: RulesState): boolean {
  if (!rule.schedule) return false;

  const now = new Date();
  const record = state[rule.name];
  const lastRun = record?.last_run ? new Date(record.last_run) : null;

  if (rule.schedule === "hourly") {
    if (!lastRun) return true;
    const msSinceLast = now.getTime() - lastRun.getTime();
    return msSinceLast >= 3_600_000; // 1 hour
  }

  // "daily:HH" format (e.g., "daily:02" = 2 AM)
  const dailyMatch = rule.schedule.match(/^daily:(\d{1,2})$/);
  if (dailyMatch) {
    const targetHour = parseInt(dailyMatch[1], 10);
    if (now.getHours() < targetHour) return false;

    if (!lastRun) return true;
    // Check if last run was on a different day
    return lastRun.toDateString() !== now.toDateString();
  }

  debug(`Unknown schedule format: ${rule.schedule}`);
  return false;
}

// --- Rule evaluation ---

/** Build context for a trigger-based rule. */
function buildTriggerContext(rule: RuleConfig): Record<string, unknown> {
  if (!rule.trigger) return {};
  const triggers = getTriggers(rule.trigger);
  return {
    paths: triggers.map((t) => t.path),
    triggeredPaths: triggers.map((t) => t.path),
  };
}

/**
 * Evaluate all rules and return tasks to enqueue.
 * Called on each heartbeat.
 */
export function evaluateRules(rules: RuleConfig[]): QueuedTask[] {
  const state = loadRulesState();
  const tasks: QueuedTask[] = [];

  for (const rule of rules) {
    // Skip rules already running
    if (state[rule.name]?.last_result === "running") {
      debug(`Rule already running: ${rule.name}`);
      continue;
    }

    let matches = false;
    let context: Record<string, unknown> = {};

    if (rule.trigger) {
      matches = checkTriggerCondition(rule);
      if (matches) {
        context = buildTriggerContext(rule);
      }
    } else if (rule.schedule) {
      matches = checkScheduleCondition(rule, state);
    }

    if (matches) {
      info(`Rule matched: ${rule.name}`);
      tasks.push({
        id: `${rule.name}-${Date.now()}`,
        rule: rule.name,
        handler: rule.handler,
        context,
        priority: "normal",
      });
    }
  }

  return tasks;
}

/**
 * Catch-up evaluation on startup: re-queue interrupted or transiently-failed rules.
 */
export function catchUpRules(rules: RuleConfig[]): QueuedTask[] {
  const state = loadRulesState();
  const tasks: QueuedTask[] = [];

  for (const rule of rules) {
    const record = state[rule.name];
    if (!record) continue;

    // Resume interrupted tasks
    if (record.last_result === "running") {
      info(`Catch-up: resuming interrupted rule ${rule.name}`);
      tasks.push({
        id: `${rule.name}-catchup-${Date.now()}`,
        rule: rule.name,
        handler: rule.handler,
        context: {},
        priority: "high",
      });
    }

    // Retry transient failures
    if (record.last_result === "failed" && record.last_error) {
      const isTransient =
        record.last_error.includes("timeout") ||
        record.last_error.includes("ETIMEDOUT") ||
        record.last_error.includes("ECONNRESET") ||
        record.last_error.includes("spawn");

      if (isTransient) {
        info(`Catch-up: retrying failed rule ${rule.name} (transient error)`);
        tasks.push({
          id: `${rule.name}-catchup-${Date.now()}`,
          rule: rule.name,
          handler: rule.handler,
          context: {},
          priority: "normal",
        });
      }
    }
  }

  return tasks;
}
