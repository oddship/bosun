/**
 * Validator pipeline.
 *
 * Validators are Bun TypeScript files that gate workflow execution:
 * - Input validators: run before agent, exit 0 to proceed, exit 1 to skip
 * - Output validators: run after agent, exit 0 = success, exit 1 = retry
 *
 * Validators receive context via environment variables and stdin:
 * - Env: WORKFLOW_NAME, WORKFLOW_DATE, WORKFLOW_PATH, AGENT_EXIT_CODE
 * - Stdin (output only): agent's stdout
 * - Stderr: captured as feedback for retry
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { debug, error } from "./logger.js";
import type { WorkflowConfig } from "./workflows.js";

export interface ValidatorResult {
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ValidatorContext {
  workflow: WorkflowConfig;
  context: Record<string, unknown>;
  stdout: string;
  exitCode: number;
}

/**
 * Run a validator script.
 *
 * @param type - "input" or "output"
 * @param scriptPath - absolute path to the validator .ts file
 * @param ctx - context to pass to the validator
 */
export async function runValidators(
  type: "input" | "output",
  scriptPath: string,
  ctx: ValidatorContext,
): Promise<ValidatorResult> {
  if (!existsSync(scriptPath)) {
    debug(`Validator not found: ${scriptPath}, passing by default`);
    return { passed: true, stdout: "", stderr: "", exitCode: 0 };
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    WORKFLOW_NAME: ctx.workflow.name,
    WORKFLOW_DIR: ctx.workflow.dir,
    WORKFLOW_TYPE: ctx.workflow.type,
    VALIDATOR_TYPE: type,
  };

  // Add trigger context
  const triggerCtx = ctx.context;
  if (triggerCtx.date) env.WORKFLOW_DATE = String(triggerCtx.date);
  if (Array.isArray(triggerCtx.paths)) env.WORKFLOW_PATHS = triggerCtx.paths.join(",");

  // Output validators get the agent's exit code
  if (type === "output") {
    env.AGENT_EXIT_CODE = String(ctx.exitCode);
  }

  return new Promise((resolve) => {
    const proc = spawn("bun", [scriptPath], {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000, // validators should be fast
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    // For output validators, pipe agent stdout to stdin
    if (type === "output" && ctx.stdout) {
      proc.stdin.write(ctx.stdout);
    }
    proc.stdin.end();

    proc.on("error", (err) => {
      error(`Validator error (${type}): ${err.message}`);
      resolve({ passed: false, stdout, stderr: err.message, exitCode: 127 });
    });

    proc.on("exit", (code) => {
      const exitCode = code ?? 1;
      resolve({
        passed: exitCode === 0,
        stdout,
        stderr: stderr.trim(),
        exitCode,
      });
    });
  });
}
