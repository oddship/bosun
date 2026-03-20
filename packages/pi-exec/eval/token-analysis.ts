#!/usr/bin/env bun
/**
 * Token analysis — run a task and show per-phase token breakdown.
 * Used to measure cache efficiency and context growth.
 *
 * Usage:
 *   bun run packages/pi-exec/eval/token-analysis.ts --task fix-bug
 *   bun run packages/pi-exec/eval/token-analysis.ts --task add-feature --model gpt-5.1-codex-mini
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { getApiKey } from "./lib/auth.js";
import { runTask } from "./lib/runner.js";

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const taskFilter = getArg("task") ?? "fix-bug";
const modelId = getArg("model") ?? "gpt-5.1-codex-mini";

const evalDir = resolve(import.meta.dirname!, ".");
const tasksDir = join(evalDir, "tasks");
const taskDir = join(tasksDir, taskFilter);

if (!existsSync(join(taskDir, "task.json"))) {
  console.error(`Task not found: ${taskFilter}`);
  process.exit(1);
}

const model = getModel("openai-codex", modelId);
if (!model) {
  console.error(`Model not found: ${modelId}`);
  process.exit(1);
}

const apiKey = await getApiKey("openai-codex");

console.log(`Task: ${taskFilter}`);
console.log(`Model: ${modelId}\n`);

const run = await runTask(taskDir, {
  model,
  apiKey,
  maxCostUsd: 0.50,
  phaseBudget: 30_000,
  verbose: true,
});

const m = run.result.metrics;
if (!m) {
  console.log("No metrics available.");
  process.exit(1);
}

console.log("\n" + "═".repeat(70));
console.log("TOKEN ANALYSIS");
console.log("═".repeat(70));

console.log(`\nStatus: ${run.result.status}`);
console.log(`Total cost: $${m.totalCost.toFixed(4)}`);
console.log(`Total time: ${m.totalDurationMs}ms\n`);

console.log(
  `${"Phase".padEnd(8)} ${"Rounds".padEnd(8)} ${"Input".padEnd(10)} ${"Cached".padEnd(10)} ${"Output".padEnd(10)} ${"Total".padEnd(10)} ${"Cost".padEnd(10)} ${"Time".padEnd(10)}`,
);
console.log("─".repeat(70));

for (const p of m.phases) {
  const cacheRate = p.inputTokens > 0
    ? ((p.cacheReadTokens / (p.inputTokens + p.cacheReadTokens)) * 100).toFixed(0)
    : "0";
  console.log(
    `${String(p.phaseIndex + 1).padEnd(8)} ${String(p.rounds).padEnd(8)} ${String(p.inputTokens).padEnd(10)} ${(String(p.cacheReadTokens) + ` (${cacheRate}%)`).padEnd(10)} ${String(p.outputTokens).padEnd(10)} ${String(p.totalTokens).padEnd(10)} $${p.cost.toFixed(4).padEnd(9)} ${p.durationMs}ms`,
  );
}

console.log("─".repeat(70));

const totalInput = m.totalInputTokens;
const totalCached = m.totalCacheReadTokens;
const totalOutput = m.totalOutputTokens;
const overallCacheRate = totalInput > 0
  ? ((totalCached / (totalInput + totalCached)) * 100).toFixed(1)
  : "0";

console.log(`\nTotals: ${totalInput} input, ${totalCached} cached (${overallCacheRate}%), ${totalOutput} output`);

// Estimate what a chat loop would cost
// Chat loop: context grows linearly. Each round N sends ~N messages worth of context.
// In pi-exec, each phase starts fresh, so context = prefix + state (bounded).
// Estimate chat loop tokens: sum of (prefix + round * avg_tool_result_size) for each round
const totalRounds = m.phases.reduce((s, p) => s + p.rounds, 0);
const avgInputPerRound = totalInput / totalRounds;
// Chat loop would send an accumulated context. Rough model: 
// round 1: 1x prefix, round 2: 1x prefix + 1 result, ..., round N: 1x prefix + (N-1) results
// Triangular sum: N * prefix + (N*(N-1)/2) * avgResult
const avgResultSize = totalOutput / totalRounds; // rough proxy for tool result sizes
const chatLoopInput = totalRounds * avgInputPerRound + (totalRounds * (totalRounds - 1) / 2) * avgResultSize;

console.log(`\nEfficiency estimate (same model):`);
console.log(`  pi-exec input tokens:   ${totalInput.toLocaleString()}`);
console.log(`  Chat loop est. input:   ${Math.round(chatLoopInput).toLocaleString()} (${(chatLoopInput / totalInput).toFixed(1)}x more)`);
console.log(`  Rounds:                 ${totalRounds}`);
console.log(`  Avg input/round:        ${Math.round(avgInputPerRound)}`);
console.log(`  Cache rate:             ${overallCacheRate}%`);
console.log("═".repeat(70));
