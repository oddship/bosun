#!/usr/bin/env bun
/**
 * pi-daemon — Background automation engine for Pi.
 *
 * Workflow-first architecture:
 * - Discovers workflows from packages, .pi/workflows, workspace/workflows
 * - Triggers: file watchers, schedules, startup, manual
 * - Pipeline: validate input → spawn agent/script → validate output → retry
 *
 * Supports two modes:
 * - "workflows" (default): discovers workflow directories
 * - "legacy": loads TypeScript handlers from handlers_dir (backward compat)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadDaemonConfig } from "./config.js";
import { loadModelConfig } from "./models.js";
import { setLogLevel, setLogFile, info, error, debug } from "./logger.js";
import { initTriggers } from "./triggers.js";
import { initRulesState, evaluateRules, catchUpRules } from "./rules.js";
import { initQueue, setHandlerRunner, enqueueTasks, processQueue } from "./queue.js";
import { initHandlers, runHandler } from "./handlers.js";
import { setupWatchers, closeWatchers } from "./watcher.js";
import { initControl, startControl, stopControl } from "./control.js";
import { discoverWorkflows, deriveWatchers, type WorkflowConfig } from "./workflows.js";
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

async function runHeartbeat(rules: RuleConfig[]): Promise<void> {
  try {
    const tasks = evaluateRules(rules);
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

function startWorkflowMode(config: ReturnType<typeof loadDaemonConfig>, stateDir: string): RuleConfig[] {
  // Discover workflows
  const workflows = discoverWorkflows(ROOT);
  const workflowMap = new Map<string, WorkflowConfig>();
  for (const wf of workflows) {
    workflowMap.set(wf.name, wf);
  }

  // Wire workflow runner into queue
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

  // Derive watchers from workflow configs
  const watcherConfigs = deriveWatchers(workflows);
  setupWatchers(watcherConfigs, ROOT);
  status.watchers = watcherConfigs.map((w) => ({
    name: w.name,
    pattern: w.pattern,
    enabled: true,
    last_triggered: null,
  }));

  // Derive rules from workflow configs
  const rules: RuleConfig[] = workflows
    .filter((wf) => wf.trigger.schedule || wf.trigger.watcher)
    .map((wf) => ({
      name: wf.name,
      handler: wf.name, // handler name = workflow name
      trigger: wf.trigger.watcher ? `wf-${wf.name}` : undefined,
      schedule: wf.trigger.schedule,
    }));

  info(`Workflows: ${workflows.length}`);
  info(`Watchers: ${watcherConfigs.length}`);
  info(`Rules: ${rules.length}`);

  // Run startup workflows
  const startupWorkflows = workflows.filter((wf) => wf.trigger.startup);
  if (startupWorkflows.length > 0) {
    info(`Running ${startupWorkflows.length} startup workflow(s)`);
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

  return rules;
}

// --- Legacy mode ---

function startLegacyMode(config: ReturnType<typeof loadDaemonConfig>): RuleConfig[] {
  info("Running in legacy mode (handlers_dir)");
  initHandlers(config.handlers_dir, ROOT);

  setHandlerRunner(async (handler, context) => {
    status.stats.handlers_run++;
    await runHandler(handler, context);
  });

  setupWatchers(config.watchers, ROOT);
  status.watchers = config.watchers.map((w) => ({
    name: w.name,
    pattern: w.pattern,
    enabled: true,
    last_triggered: null,
  }));

  return config.rules;
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

  // Load model config
  loadModelConfig(ROOT);

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
  initControl(stateDir, logFile, getStatus);
  startControl();

  // Choose mode: workflow-first or legacy
  // Legacy mode activates when handlers_dir exists and no workflows are found
  let rules: RuleConfig[];

  // Check for workflow directories in any of the three discovery locations
  let hasWorkflows =
    existsSync(join(ROOT, ".pi", "workflows")) ||
    existsSync(join(ROOT, "workspace", "workflows"));

  // Also check packages/*/workflows/
  if (!hasWorkflows && existsSync(join(ROOT, "packages"))) {
    try {
      const pkgs = readdirSync(join(ROOT, "packages"));
      hasWorkflows = pkgs.some(pkg =>
        existsSync(join(ROOT, "packages", pkg, "workflows"))
      );
    } catch {}
  }

  if (hasWorkflows || !config.handlers_dir) {
    rules = startWorkflowMode(config, stateDir);
  } else {
    rules = startLegacyMode(config);
  }

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

  await runHeartbeat(rules);
  setInterval(() => runHeartbeat(rules), interval * 1000);

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
