#!/usr/bin/env bun
/**
 * pi-exec smoke tests — run a few tasks against real Codex models.
 *
 * Usage:
 *   bun run packages/pi-exec/eval/smoke.ts
 *   bun run packages/pi-exec/eval/smoke.ts --model gpt-5.4
 *   bun run packages/pi-exec/eval/smoke.ts --task fix-bug
 *   bun run packages/pi-exec/eval/smoke.ts --verbose
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { getApiKey } from "./lib/auth.js";
import { runTask } from "./lib/runner.js";
import { checkAssertions } from "./lib/assertions.js";
import { printReport } from "./lib/report.js";
import type { TaskResult, TaskDefinition } from "./lib/types.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const modelId = getArg("model") ?? "gpt-5.1-codex-mini";
const taskFilter = getArg("task");
const verbose = hasFlag("verbose");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const evalDir = resolve(import.meta.dirname!, ".");
const tasksDir = join(evalDir, "tasks");

// Load model
const model = getModel("openai-codex", modelId);
if (!model) {
  console.error(`Model not found: openai-codex/${modelId}`);
  console.error("Available codex models:");
  const { getModels } = await import("@mariozechner/pi-ai");
  for (const m of getModels("openai-codex")) {
    console.error(`  ${m.id} ($${m.cost.input}/$${m.cost.output})`);
  }
  process.exit(1);
}

// Load API key (handles OAuth refresh)
let apiKey: string;
try {
  apiKey = await getApiKey("openai-codex");
} catch (err) {
  console.error(String(err));
  process.exit(1);
}

console.log(`Model: ${model.id} (${model.name})`);
console.log(`Cost: $${model.cost.input}/M in, $${model.cost.output}/M out`);
console.log(`Max cost per task: $0.50`);
console.log();

// ---------------------------------------------------------------------------
// Discover tasks
// ---------------------------------------------------------------------------

const taskDirs = readdirSync(tasksDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .filter((d) => !taskFilter || d.name === taskFilter)
  .map((d) => join(tasksDir, d.name))
  .filter((d) => existsSync(join(d, "task.json")));

if (taskDirs.length === 0) {
  console.error(`No tasks found${taskFilter ? ` matching "${taskFilter}"` : ""}`);
  process.exit(1);
}

console.log(`Tasks: ${taskDirs.length}`);
console.log();

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const results: TaskResult[] = [];

for (const taskDir of taskDirs) {
  const taskDef: TaskDefinition = JSON.parse(
    readFileSync(join(taskDir, "task.json"), "utf-8"),
  );
  const taskName = taskDef.name;

  console.log(`▶ ${taskName}`);

  try {
    const run = await runTask(taskDir, {
      model,
      apiKey,
      maxCostUsd: 0.50,
      phaseBudget: 30_000,
      verbose,
    });

    // Check assertions
    const assertionResults = taskDef.assertions
      ? checkAssertions(taskDef.assertions, run.result.state, run.workDir)
      : [];

    const passed = run.result.status === "completed" &&
      assertionResults.every((a) => a.passed);

    results.push({
      taskName,
      model: model.id,
      passed,
      assertionResults,
      cost: run.result.metrics?.totalCost ?? 0,
      tokens: run.result.metrics?.totalTokens ?? 0,
      durationMs: run.durationMs,
      status: run.result.status,
      error: run.result.error,
    });

    const icon = passed ? "✅" : "❌";
    const cost = run.result.metrics?.totalCost ?? 0;
    console.log(`  ${icon} ${run.result.status} | $${cost.toFixed(4)} | ${run.durationMs}ms`);
  } catch (err) {
    console.log(`  ❌ ERROR: ${err}`);
    results.push({
      taskName,
      model: model.id,
      passed: false,
      assertionResults: [],
      cost: 0,
      tokens: 0,
      durationMs: 0,
      status: "error",
      error: String(err),
    });
  }
  console.log();
}

printReport(results);
