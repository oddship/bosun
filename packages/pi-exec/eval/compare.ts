#!/usr/bin/env bun
/**
 * Compare pi-exec results vs chat-loop baseline.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const evalDir = resolve(import.meta.dirname!, ".");

const chatFile = process.argv.find(a => a.startsWith("--chat="))?.split("=")[1] ?? "results/chat-v3-realistic.json";
const execFile = process.argv.find(a => a.startsWith("--exec="))?.split("=")[1] ?? "results/exec-v3-realistic.json";
const chatData = JSON.parse(readFileSync(resolve(evalDir, chatFile), "utf-8"));
const execData = JSON.parse(readFileSync(resolve(evalDir, execFile), "utf-8"));

// Build lookup by task name
const chatByTask = new Map(chatData.results.map((r: any) => [r.taskName, r]));
const execByTask = new Map(execData.results.map((r: any) => [r.taskName, r]));

// Only compare tasks that exist in both
const commonTasks = [...chatByTask.keys()].filter(t => execByTask.has(t));

console.log("═".repeat(100));
console.log("pi-exec vs Chat Loop — Same Model (gpt-5.1-codex-mini), Same Tasks");
console.log("═".repeat(100));
console.log();
console.log(
  `${"Task".padEnd(25)} ${"Chat".padEnd(6)} ${"Exec".padEnd(6)} ${"Chat$".padEnd(9)} ${"Exec$".padEnd(9)} ${"Saving".padEnd(8)} ${"Chat In".padEnd(10)} ${"Exec In".padEnd(10)} ${"Chat Rnd".padEnd(9)} ${"Chat Pass".padEnd(10)} ${"Exec Pass".padEnd(10)}`,
);
console.log("─".repeat(100));

let totalChatCost = 0;
let totalExecCost = 0;
let totalChatInput = 0;
let totalExecInput = 0;
let totalChatRounds = 0;
let totalExecTokens = 0;
let chatPassed = 0;
let execPassed = 0;

for (const task of commonTasks) {
  const chat = chatByTask.get(task)!;
  const exec = execByTask.get(task)!;

  totalChatCost += chat.cost;
  totalExecCost += exec.cost;
  totalChatInput += chat.inputTokens;
  totalExecInput += exec.tokens;
  totalChatRounds += chat.rounds;
  if (chat.passed) chatPassed++;
  if (exec.passed) execPassed++;

  const saving = chat.cost > 0 ? ((1 - exec.cost / chat.cost) * 100).toFixed(0) : "n/a";
  const chatPass = chat.passed ? "✅" : "❌";
  const execPass = exec.passed ? "✅" : "❌";

  console.log(
    `${task.padEnd(25)} ${String(chat.rounds).padEnd(6)} ${"-".padEnd(6)} $${chat.cost.toFixed(4).padEnd(8)} $${exec.cost.toFixed(4).padEnd(8)} ${(saving + "%").padEnd(8)} ${String(chat.inputTokens).padEnd(10)} ${String(exec.tokens).padEnd(10)} ${String(chat.rounds).padEnd(9)} ${chatPass.padEnd(10)} ${execPass.padEnd(10)}`,
  );
}

console.log("─".repeat(100));

const costSaving = ((1 - totalExecCost / totalChatCost) * 100).toFixed(1);
const inputSaving = ((1 - totalExecInput / totalChatInput) * 100).toFixed(1);

console.log();
console.log("═".repeat(100));
console.log("TOTALS");
console.log("═".repeat(100));
console.log(`Tasks compared:     ${commonTasks.length}`);
console.log();
console.log(`                    Chat Loop       pi-exec         Difference`);
console.log(`Cost:               $${totalChatCost.toFixed(4).padEnd(14)} $${totalExecCost.toFixed(4).padEnd(14)} ${costSaving}% ${Number(costSaving) > 0 ? "cheaper" : "more expensive"}`);
console.log(`Input tokens:       ${totalChatInput.toLocaleString().padEnd(15)} ${totalExecInput.toLocaleString().padEnd(15)} ${inputSaving}% ${Number(inputSaving) > 0 ? "fewer" : "more"}`);
console.log(`Pass rate:          ${chatPassed}/${commonTasks.length} (${(chatPassed/commonTasks.length*100).toFixed(0)}%)`.padEnd(20) + `${execPassed}/${commonTasks.length} (${(execPassed/commonTasks.length*100).toFixed(0)}%)`.padEnd(20));
console.log(`Rounds (chat):      ${totalChatRounds} total, ${(totalChatRounds / commonTasks.length).toFixed(1)} avg`);
console.log(`Cache (chat):       ${chatData.results.reduce((s: number, r: any) => s + r.cacheReadTokens, 0).toLocaleString()} tokens (${((chatData.results.reduce((s: number, r: any) => s + r.cacheReadTokens, 0) / (totalChatInput + chatData.results.reduce((s: number, r: any) => s + r.cacheReadTokens, 0))) * 100).toFixed(1)}%)`);
console.log("═".repeat(100));
