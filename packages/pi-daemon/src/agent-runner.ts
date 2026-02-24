/**
 * Agent and script runner for workflows.
 *
 * Replaces the old handler system. Instead of loading TypeScript handlers,
 * spawns agents via `pi --print` or runs scripts directly.
 *
 * The agent is the brain — it has tools (read, write, bash) and does everything.
 * This module just spawns it and captures results.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { info, error, debug } from "./logger.js";
import { resolveModel } from "./models.js";
import { runValidators } from "./validators.js";
import type { WorkflowConfig } from "./workflows.js";

const PI_PATH = process.env.BOSUN_PI_PATH || "pi";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  skipped: boolean;
  validationPassed: boolean;
  attempts: number;
}

interface RunContext {
  /** Trigger paths (from file watcher). */
  paths?: string[];
  /** Date string (for scheduled workflows). */
  date?: string;
  /** Additional context from the rule engine. */
  [key: string]: unknown;
}

/**
 * Run a workflow: validate input → spawn agent/script → validate output → retry if needed.
 */
export async function runWorkflow(
  workflow: WorkflowConfig,
  context: RunContext,
): Promise<RunResult> {
  const result: RunResult = {
    exitCode: -1,
    stdout: "",
    stderr: "",
    skipped: false,
    validationPassed: false,
    attempts: 0,
  };

  // --- Input validation ---
  if (workflow.validators.input) {
    const inputValid = await runValidators(
      "input",
      join(workflow.dir, workflow.validators.input),
      { workflow, context, stdout: "", exitCode: 0 },
    );
    if (!inputValid.passed) {
      info(`[${workflow.name}] Input validation failed, skipping: ${inputValid.stderr}`);
      result.skipped = true;
      return result;
    }
    debug(`[${workflow.name}] Input validation passed`);
  }

  // --- Run with retries ---
  let lastValidatorFeedback = "";

  for (let attempt = 1; attempt <= workflow.retry.max_attempts; attempt++) {
    result.attempts = attempt;
    info(`[${workflow.name}] Running (attempt ${attempt}/${workflow.retry.max_attempts})`);

    let runResult: { exitCode: number; stdout: string; stderr: string };

    if (workflow.type === "agent") {
      runResult = await spawnAgent(workflow, context, lastValidatorFeedback);
    } else {
      runResult = await runScript(workflow, context);
    }

    result.exitCode = runResult.exitCode;
    result.stdout = runResult.stdout;
    result.stderr = runResult.stderr;

    if (runResult.exitCode !== 0) {
      error(`[${workflow.name}] Exited with code ${runResult.exitCode}`);
      if (attempt < workflow.retry.max_attempts) {
        lastValidatorFeedback = `Process exited with code ${runResult.exitCode}: ${runResult.stderr}`;
        continue;
      }
      return result;
    }

    // --- Output validation ---
    if (workflow.validators.output) {
      const outputValid = await runValidators(
        "output",
        join(workflow.dir, workflow.validators.output),
        { workflow, context, stdout: runResult.stdout, exitCode: runResult.exitCode },
      );

      if (!outputValid.passed) {
        error(`[${workflow.name}] Output validation failed: ${outputValid.stderr}`);
        if (attempt < workflow.retry.max_attempts && workflow.retry.feedback) {
          lastValidatorFeedback = outputValid.stderr;
          info(`[${workflow.name}] Will retry with validator feedback`);
          continue;
        }
        return result;
      }
      debug(`[${workflow.name}] Output validation passed`);
    }

    // Success
    result.validationPassed = true;
    info(`[${workflow.name}] Completed successfully`);
    return result;
  }

  return result;
}

/**
 * Spawn a pi agent in --print mode.
 */
async function spawnAgent(
  workflow: WorkflowConfig,
  context: RunContext,
  validatorFeedback: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const model = resolveModel(workflow.agent?.model);
  const args: string[] = ["--print", "--model", model];

  // Agent system prompt
  if (workflow.agent?.systemPromptFile && existsSync(workflow.agent.systemPromptFile)) {
    args.push("--append-system-prompt", workflow.agent.systemPromptFile);
  }

  // Build task prompt
  let prompt = workflow.agent?.prompt || "Run the workflow task.";

  // Append validator feedback for retries
  if (validatorFeedback) {
    prompt += `\n\n[Previous attempt failed validation]\nValidator feedback: ${validatorFeedback}\nPlease fix the issue and try again.`;
  }

  args.push(prompt);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PI_AGENT: workflow.name,
    PI_AGENT_NAME: workflow.name,
    BOSUN_DAEMON: "1",
    WORKFLOW_NAME: workflow.name,
    WORKFLOW_DIR: workflow.dir,
  };

  // Add trigger context
  if (context.date) env.WORKFLOW_DATE = context.date;
  if (context.paths?.length) env.WORKFLOW_PATHS = context.paths.join(",");

  const timeoutMs = workflow.timeout_minutes * 60 * 1000;

  return spawnProcess(PI_PATH, args, {
    cwd: process.cwd(),
    env,
    timeoutMs,
  });
}

/**
 * Run a script workflow.
 */
async function runScript(
  workflow: WorkflowConfig,
  context: RunContext,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!workflow.script?.command) {
    return { exitCode: 1, stdout: "", stderr: "No script command configured" };
  }

  const command = resolve(workflow.dir, workflow.script.command);
  if (!existsSync(command)) {
    return { exitCode: 1, stdout: "", stderr: `Script not found: ${command}` };
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BOSUN_DAEMON: "1",
    WORKFLOW_NAME: workflow.name,
    WORKFLOW_DIR: workflow.dir,
  };

  if (context.date) env.WORKFLOW_DATE = context.date;
  if (context.paths?.length) env.WORKFLOW_PATHS = context.paths.join(",");

  const timeoutMs = workflow.timeout_minutes * 60 * 1000;

  return spawnProcess("bun", [command], {
    cwd: process.cwd(),
    env,
    timeoutMs,
  });
}

/**
 * Spawn a process and capture output.
 */
function spawnProcess(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
      resolve({ exitCode: 124, stdout, stderr: stderr + "\nTimeout exceeded" });
    }, opts.timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ exitCode: 127, stdout, stderr: err.message });
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
