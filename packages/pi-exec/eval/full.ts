#!/usr/bin/env bun
/**
 * pi-exec full eval — multi-model sweep with multiple runs per task.
 *
 * Usage:
 *   bun run packages/pi-exec/eval/full.ts
 *   bun run packages/pi-exec/eval/full.ts --models gpt-5.1-codex-mini,gpt-5.4-mini
 *   bun run packages/pi-exec/eval/full.ts --runs 3
 *   bun run packages/pi-exec/eval/full.ts --task fix-bug --verbose
 *   bun run packages/pi-exec/eval/full.ts --output eval/results/run-001.json
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { getApiKey } from "./lib/auth.js";
import { runTask } from "./lib/runner.js";
import { checkAssertions } from "./lib/assertions.js";
import type { TaskDefinition, TaskResult } from "./lib/types.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const modelIds = (getArg("models") ?? "gpt-5.1-codex-mini").split(",");
const numRuns = parseInt(getArg("runs") ?? "3", 10);
const taskFilter = getArg("task");
const outputPath = getArg("output");
const verbose = hasFlag("verbose");
const maxCostPerTask = parseFloat(getArg("max-cost") ?? "0.50");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const evalDir = resolve(import.meta.dirname!, ".");
const tasksDir = join(evalDir, "tasks");

// Resolve models
const models: { id: string; model: Model<any> }[] = [];
for (const id of modelIds) {
  const model = getModel("openai-codex", id);
  if (!model) {
    console.error(`Model not found: openai-codex/${id}`);
    const { getModels } = await import("@mariozechner/pi-ai");
    console.error("Available codex models:");
    for (const m of getModels("openai-codex")) {
      console.error(`  ${m.id} ($${m.cost.input}/$${m.cost.output})`);
    }
    process.exit(1);
  }
  models.push({ id, model });
}

// Load API key
let apiKey: string;
try {
  apiKey = await getApiKey("openai-codex");
} catch (err) {
  console.error(String(err));
  process.exit(1);
}

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

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("═".repeat(80));
console.log("pi-exec Full Eval");
console.log("═".repeat(80));
console.log(`Models:    ${modelIds.join(", ")}`);
console.log(`Tasks:     ${taskDirs.length}`);
console.log(`Runs:      ${numRuns} per task per model`);
console.log(`Max cost:  $${maxCostPerTask.toFixed(2)} per task`);
console.log(`Total:     ${taskDirs.length * modelIds.length * numRuns} task runs`);
console.log("═".repeat(80));
console.log();

const allResults: TaskResult[] = [];
let totalCost = 0;

for (const { id: modelId, model } of models) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Model: ${modelId} ($${model.cost.input}/$${model.cost.output})`);
  console.log("─".repeat(60));

  for (const taskDir of taskDirs) {
    const taskDef: TaskDefinition = JSON.parse(
      readFileSync(join(taskDir, "task.json"), "utf-8"),
    );
    const taskName = taskDef.name;

    for (let run = 1; run <= numRuns; run++) {
      const label = `${taskName} [run ${run}/${numRuns}]`;
      process.stdout.write(`  ▶ ${label.padEnd(45)} `);

      try {
        const runResult = await runTask(taskDir, {
          model,
          apiKey,
          maxCostUsd: maxCostPerTask,
          phaseBudget: 30_000,
          verbose,
        });

        const assertionResults = taskDef.assertions
          ? checkAssertions(taskDef.assertions, runResult.result.state, runResult.workDir)
          : [];

        const passed = runResult.result.status === "completed" &&
          assertionResults.every((a) => a.passed);
        const cost = runResult.result.metrics?.totalCost ?? 0;
        totalCost += cost;

        const result: TaskResult = {
          taskName,
          model: modelId,
          passed,
          assertionResults,
          cost,
          tokens: runResult.result.metrics?.totalTokens ?? 0,
          durationMs: runResult.durationMs,
          status: runResult.result.status,
          error: runResult.result.error,
        };
        allResults.push(result);

        const icon = passed ? "✅" : "❌";
        console.log(`${icon} ${runResult.result.status.padEnd(14)} $${cost.toFixed(4)} ${runResult.durationMs}ms`);

        if (!passed) {
          for (const a of assertionResults.filter((a) => !a.passed)) {
            console.log(`     └─ FAIL: ${a.assertion.description ?? a.assertion.path}`);
          }
          if (runResult.result.error) {
            console.log(`     └─ ${runResult.result.error.slice(0, 120)}`);
          }
        }
      } catch (err) {
        console.log(`❌ ERROR: ${String(err).slice(0, 100)}`);
        allResults.push({
          taskName,
          model: modelId,
          passed: false,
          assertionResults: [],
          cost: 0,
          tokens: 0,
          durationMs: 0,
          status: "error",
          error: String(err),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("\n" + "═".repeat(80));
console.log("RESULTS SUMMARY");
console.log("═".repeat(80));

for (const modelId of modelIds) {
  const modelResults = allResults.filter((r) => r.model === modelId);
  const byTask = groupBy(modelResults, (r) => r.taskName);

  console.log(`\n## ${modelId}`);
  console.log("─".repeat(60));
  console.log(
    `  ${"Task".padEnd(30)} ${"Pass Rate".padEnd(12)} ${"Avg Cost".padEnd(12)} ${"Avg Time".padEnd(12)}`,
  );
  console.log("  " + "─".repeat(56));

  let modelPassed = 0;
  let modelTotal = 0;

  for (const [taskName, runs] of Object.entries(byTask)) {
    const passed = runs.filter((r) => r.passed).length;
    const total = runs.length;
    modelPassed += passed;
    modelTotal += total;
    const avgCost = runs.reduce((s, r) => s + r.cost, 0) / total;
    const avgTime = Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / total);
    const rate = `${passed}/${total}`;

    console.log(
      `  ${taskName.padEnd(30)} ${rate.padEnd(12)} $${avgCost.toFixed(4).padEnd(11)} ${avgTime}ms`,
    );
  }

  const overallRate = modelTotal > 0 ? ((modelPassed / modelTotal) * 100).toFixed(1) : "0.0";
  const modelCost = modelResults.reduce((s, r) => s + r.cost, 0);
  console.log("  " + "─".repeat(56));
  console.log(`  Overall: ${modelPassed}/${modelTotal} (${overallRate}%) | Total cost: $${modelCost.toFixed(4)}`);
}

console.log(`\nTotal cost across all models: $${totalCost.toFixed(4)}`);
console.log("═".repeat(80));

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

if (outputPath) {
  const outDir = resolve(outputPath, "..");
  mkdirSync(outDir, { recursive: true });
  const output = {
    timestamp: new Date().toISOString(),
    models: modelIds,
    runs: numRuns,
    tasks: taskDirs.length,
    totalCost,
    results: allResults,
  };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outputPath}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}
