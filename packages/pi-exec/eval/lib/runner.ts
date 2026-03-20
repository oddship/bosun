/**
 * Task runner — creates a sandboxed working directory, sets up tools,
 * runs the executor, and collects results.
 */

import { mkdtempSync, cpSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getModel, type Model } from "@mariozechner/pi-ai";
import {
  createReadTool,
  createBashTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";
import { createExecutor, type RunResult, type PhaseEvent, type ToolRegistry } from "pi-exec";
import type { TaskDefinition } from "./types.js";
import { REALISTIC_SYSTEM_PROMPT } from "./prompts.js";

export interface RunConfig {
  model: Model<any>;
  apiKey: string;
  maxCostUsd?: number;
  phaseBudget?: number;
  verbose?: boolean;
}

export interface TaskRunResult {
  taskName: string;
  model: string;
  result: RunResult;
  durationMs: number;
  events: PhaseEvent[];
  /** Temp working directory where the task ran. */
  workDir: string;
}

/**
 * Run a single task using the executor.
 */
export async function runTask(
  taskDir: string,
  config: RunConfig,
): Promise<TaskRunResult> {
  const taskDef = loadTask(taskDir);

  // Create temp working directory with fixture files
  const workDir = mkdtempSync(join(tmpdir(), "pi-exec-eval-"));
  const fixtureDir = join(taskDir, "fixture");
  if (existsSync(fixtureDir)) {
    cpSync(fixtureDir, workDir, { recursive: true });
  }

  // Create tools scoped to the working directory
  const allTools: ToolRegistry = {
    read: createReadTool(workDir),
    bash: createBashTool(workDir),
    edit: createEditTool(workDir),
    write: createWriteTool(workDir),
    grep: createGrepTool(workDir),
    find: createFindTool(workDir),
    ls: createLsTool(workDir),
  };

  // Collect phase events
  const events: PhaseEvent[] = [];

  const start = Date.now();

  const executor = createExecutor({
    model: config.model,
    apiKey: config.apiKey,
    systemPrompt: taskDef.systemPrompt ?? REALISTIC_SYSTEM_PROMPT,
    tools: allTools,
    maxCostUsd: config.maxCostUsd ?? 0.50,
    phaseBudget: config.phaseBudget ?? 30_000,
    onPhase: (event) => {
      events.push(event);
      if (config.verbose) {
        logEvent(event, taskDef.name);
      }
    },
  });

  const result = await executor.run(
    taskDef.plan
      ? { plan: taskDef.plan, initialState: taskDef.initialState ?? {} }
      : { task: taskDef.task!, initialState: taskDef.initialState ?? {} },
  );

  const durationMs = Date.now() - start;

  return {
    taskName: taskDef.name,
    model: config.model.id,
    result,
    durationMs,
    events,
    workDir,
  };
}

function loadTask(taskDir: string): TaskDefinition {
  const taskPath = join(taskDir, "task.json");
  if (!existsSync(taskPath)) {
    throw new Error(`No task.json found in ${taskDir}`);
  }
  return JSON.parse(readFileSync(taskPath, "utf-8"));
}

function logEvent(event: PhaseEvent, taskName: string): void {
  const prefix = `[${taskName}]`;
  switch (event.type) {
    case "phase_start":
      console.log(`${prefix} Phase ${event.phaseIndex + 1}: ${event.phase.description}`);
      break;
    case "phase_end":
      console.log(`${prefix}   → ${event.summary} (${event.metrics?.durationMs}ms)`);
      break;
    case "round_start":
      process.stdout.write(`\n${prefix}   round ${event.round}: `);
      break;
    case "tool_execute_start":
      process.stdout.write(`${event.toolName} `);
      break;
    case "tool_execute_end":
      process.stdout.write(`✓ `);
      break;
    case "force_done":
      console.log(`${prefix}   ⚠️  Force done: ${event.summary}`);
      break;
    case "budget_warning":
      console.log(`${prefix}   ⚠️  Budget warning`);
      break;
    default:
      break;
  }
}
