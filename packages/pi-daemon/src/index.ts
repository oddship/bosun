#!/usr/bin/env bun
/**
 * pi-daemon — Background automation engine for Pi.
 *
 * Workflow-based architecture:
 * - Discovers workflows from packages, .pi/workflows, workspace/workflows
 * - Triggers: file watchers, schedules, startup, manual
 * - Pipeline: validate input → spawn agent/script → validate output → retry
 */

import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { loadDaemonConfig } from "./config.js";
import { setLogLevel, setLogFile, info, error, debug } from "./logger.js";
import { initTriggers } from "./triggers.js";
import { initRulesState, evaluateRules, catchUpRules } from "./rules.js";
import { initQueue, setHandlerRunner, enqueueTasks, processQueue } from "./queue.js";
import { setupWatchers, closeWatchers } from "./watcher.js";
import { initControl, startControl, stopControl } from "./control.js";
import { discoverWorkflows, deriveWatchers, deriveRules, type WorkflowConfig } from "./workflows.js";
import { runWorkflow as executeWorkflow } from "./agent-runner.js";
import type { DaemonStatus, RuleConfig } from "./types.js";

// --- Paths ---

const ROOT = process.cwd();

// --- Status management ---

let status: DaemonStatus = {
  running: false,
  pid: process.pid,
  started_at: new Date().toISOString(),
  heartbeat: new Date().toISOString(),
  watchers: [],
  stats: { handlers_run: 0, errors: 0 },
};

let statusFile: string;
let workflowMap = new Map<string, WorkflowConfig>();
let currentRules: RuleConfig[] = [];

function saveStatus(): void {
  status.heartbeat = new Date().toISOString();
  const tmpFile = statusFile + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(status, null, 2));
  renameSync(tmpFile, statusFile);
}

function getStatus(): DaemonStatus {
  return status;
}

// --- Heartbeat ---

async function runHeartbeat(): Promise<void> {
  try {
    const tasks = evaluateRules(currentRules);
    if (tasks.length > 0) enqueueTasks(tasks);
  } catch (err) {
    error(`Rule evaluation error: ${err}`);
    status.stats.errors++;
  }

  try {
    await processQueue();
  } catch (err) {
    error(`Queue processing error: ${err}`);
    status.stats.errors++;
  }

  saveStatus();
}

// --- Shutdown ---

function shutdown(): void {
  info("Shutting down daemon...");
  closeWatchers();
  stopControl();
  status.running = false;
  saveStatus();
  process.exit(0);
}

// --- Workflow mode ---

function configureWorkflowRunner(): void {
  setHandlerRunner(async (handler, context) => {
    const workflow = workflowMap.get(handler);
    if (!workflow) {
      error(`Workflow not found: ${handler}`);
      throw new Error(`Workflow not found: ${handler}`);
    }

    status.stats.handlers_run++;
    const result = await executeWorkflow(workflow, context);

    if (result.skipped) {
      info(`[${handler}] Skipped (input validation)`);
      return;
    }

    if (!result.validationPassed && result.exitCode !== 0) {
      throw new Error(`Workflow failed after ${result.attempts} attempt(s): exit ${result.exitCode}`);
    }
  });
}

function syncWorkflowMode(options: { enqueueStartup: boolean; reason: string }): { workflows: number; watchers: number; rules: number; startupQueued: number } {
  closeWatchers();

  const workflows = discoverWorkflows(ROOT);
  workflowMap = new Map(workflows.map((wf) => [wf.name, wf]));

  const watcherConfigs = deriveWatchers(workflows);
  setupWatchers(watcherConfigs, ROOT);
  status.watchers = watcherConfigs.map((w) => ({
    name: w.name,
    pattern: w.pattern,
    enabled: true,
    last_triggered: null,
  }));

  currentRules = deriveRules(workflows).map((rule) => ({
    name: rule.name,
    handler: rule.workflow,
    trigger: rule.trigger,
    schedule: rule.schedule,
    stale_minutes: rule.stale_minutes,
  }));

  let startupQueued = 0;
  if (options.enqueueStartup) {
    const startupWorkflows = workflows.filter((wf) => wf.trigger.startup);
    startupQueued = startupWorkflows.length;
    if (startupQueued > 0) {
      info(`Running ${startupQueued} startup workflow(s)`);
      for (const wf of startupWorkflows) {
        enqueueTasks([{
          id: `${wf.name}-startup-${Date.now()}`,
          rule: wf.name,
          handler: wf.name,
          context: {},
          priority: "normal",
        }]);
      }
    }
  }

  info(`Workflow sync (${options.reason}): ${workflows.length} workflows, ${watcherConfigs.length} watchers, ${currentRules.length} rules`);
  saveStatus();

  return {
    workflows: workflows.length,
    watchers: watcherConfigs.length,
    rules: currentRules.length,
    startupQueued,
  };
}

async function reloadWorkflowMode(reason = "control"): Promise<Record<string, unknown>> {
  const summary = syncWorkflowMode({ enqueueStartup: false, reason });
  return {
    success: true,
    message: `Reloaded ${summary.workflows} workflow(s), ${summary.watchers} watcher(s), ${summary.rules} rule(s)`,
    ...summary,
  };
}

function startWorkflowMode(): RuleConfig[] {
  configureWorkflowRunner();
  const summary = syncWorkflowMode({ enqueueStartup: true, reason: "startup" });
  debug(`Startup workflow sync queued ${summary.startupQueued} startup workflow(s)`);
  return currentRules;
}

// --- Main ---

async function main(): Promise<void> {
  console.log("pi-daemon starting...");

  // Load config
  const config = loadDaemonConfig(ROOT);

  if (!config.enabled) {
    console.log("Daemon disabled in config (enabled: false)");
    process.exit(0);
  }

  // Model config loaded by agent-runner via pi-agents loadConfig()

  // Setup state directory
  const stateDir = join(ROOT, config.state_dir);
  mkdirSync(stateDir, { recursive: true });

  statusFile = join(stateDir, "status.json");
  const logFile = join(stateDir, "daemon.log");

  // Setup logging
  setLogLevel(config.log_level);
  setLogFile(logFile);

  // Initialize subsystems
  initTriggers(stateDir);
  initRulesState(stateDir);
  initQueue(stateDir);

  // Setup control interface
  initControl(stateDir, logFile, getStatus, () => reloadWorkflowMode("control"));
  startControl();

  const rules = startWorkflowMode();

  status.running = true;
  info(`Daemon started (PID: ${process.pid})`);
  info(`Root: ${ROOT}`);
  info(`State: ${stateDir}`);

  // Catch-up: re-queue interrupted or transiently-failed rules
  const catchUpTasks = catchUpRules(rules);
  if (catchUpTasks.length > 0) {
    info(`Catch-up: ${catchUpTasks.length} task(s) to resume`);
    enqueueTasks(catchUpTasks);
  }

  // Start heartbeat
  const interval = config.heartbeat_interval_seconds;
  info(`Starting heartbeat (${interval}s interval)`);

  await runHeartbeat();
  setInterval(() => runHeartbeat(), interval * 1000);

  // Handle signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  info("Daemon ready");
  saveStatus();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
