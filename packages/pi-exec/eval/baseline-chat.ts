#!/usr/bin/env bun
/**
 * Chat-loop baseline — runs the same tasks through a single growing conversation
 * (the way pi --print / normal chat works). No phase boundaries, no context reset.
 *
 * This gives an apples-to-apples comparison with pi-exec on the same model,
 * same tools, same tasks.
 *
 * Usage:
 *   bun run packages/pi-exec/eval/baseline-chat.ts --task fix-bug
 *   bun run packages/pi-exec/eval/baseline-chat.ts --task add-feature --model gpt-5.1-codex-mini
 *   bun run packages/pi-exec/eval/baseline-chat.ts              # all tasks
 */

import { readdirSync, readFileSync, existsSync, mkdtempSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { streamSimple, getModel, validateToolArguments, type Model, type Message, type AssistantMessage } from "@mariozechner/pi-ai";
import {
  createReadTool,
  createBashTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getApiKey } from "./lib/auth.js";
import { checkAssertions } from "./lib/assertions.js";
import type { TaskDefinition, Assertion } from "./lib/types.js";
import { OPTIMIZED_CHAT_PROMPT, REALISTIC_CHAT_PROMPT } from "./lib/prompts.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const taskFilter = getArg("task");
const modelId = getArg("model") ?? "gpt-5.1-codex-mini";
const maxRounds = parseInt(getArg("max-rounds") ?? "30", 10);
const outputPath = getArg("output");
const promptStyle = getArg("prompt") ?? "optimized";

const evalDir = resolve(import.meta.dirname!, ".");
const tasksDir = join(evalDir, "tasks");

const model = getModel("openai-codex", modelId);
if (!model) {
  console.error(`Model not found: openai-codex/${modelId}`);
  process.exit(1);
}

const apiKey = await getApiKey("openai-codex");

// Skip phase0-planning task — it has no plan, just a task description.
// The chat baseline gives it the same instructions; pi-exec uses Phase 0 
// which is fundamentally different (plan generation then execution).
// Including it would compare plan-generation overhead, not execution efficiency.
const SKIP_TASKS = new Set(["phase0-planning"]);

// ---------------------------------------------------------------------------
// Discover tasks
// ---------------------------------------------------------------------------

const taskDirs = readdirSync(tasksDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .filter((d) => !taskFilter || d.name === taskFilter)
  .filter((d) => !SKIP_TASKS.has(d.name))
  .map((d) => join(tasksDir, d.name))
  .filter((d) => existsSync(join(d, "task.json")));

if (taskDirs.length === 0) {
  console.error(`No tasks found${taskFilter ? ` matching "${taskFilter}"` : ""}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Chat-loop runner (single growing conversation)
// ---------------------------------------------------------------------------

interface ChatResult {
  taskName: string;
  status: "completed" | "max_rounds" | "error";
  rounds: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  durationMs: number;
  assertionsPassed: number;
  assertionsTotal: number;
  passed: boolean;
  perRound: { round: number; input: number; cached: number; output: number; total: number; cost: number }[];
  toolsCalled: string[];
}

async function runChatBaseline(taskDir: string): Promise<ChatResult> {
  const taskDef: TaskDefinition = JSON.parse(
    readFileSync(join(taskDir, "task.json"), "utf-8"),
  );

  // Setup working directory
  const workDir = mkdtempSync(join(tmpdir(), "pi-exec-baseline-"));
  const fixtureDir = join(taskDir, "fixture");
  if (existsSync(fixtureDir)) {
    cpSync(fixtureDir, workDir, { recursive: true });
  }

  // Tools — all of them, since chat loop doesn't scope tools
  const tools: AgentTool[] = [
    createReadTool(workDir),
    createBashTool(workDir),
    createEditTool(workDir),
    createWriteTool(workDir),
    createGrepTool(workDir),
    createFindTool(workDir),
    createLsTool(workDir),
  ];

  // Build the prompt — flatten the plan into a single instruction.
  // This is fair: the chat loop gets the same information as pi-exec,
  // just as a flat list of steps instead of structured phases.
  const planText = taskDef.plan
    ? taskDef.plan.map((p, i) => `${i + 1}. ${p.description}`).join("\n")
    : taskDef.task ?? "Complete the task.";

  const taskSection = `\n\n## Task\n${planText}\n\n${
    taskDef.initialState && Object.keys(taskDef.initialState).length > 0
      ? `## Context\n${JSON.stringify(taskDef.initialState, null, 2)}`
      : ""
  }`;

  const chatPrompt = promptStyle === "optimized" ? OPTIMIZED_CHAT_PROMPT : REALISTIC_CHAT_PROMPT;
  const systemPrompt = chatPrompt + taskSection;

  // Single growing conversation — the chat loop
  const messages: Message[] = [
    { role: "user", content: "Begin the task. Use the available tools to accomplish each step.", timestamp: Date.now() },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  let totalCached = 0;
  let totalTokens = 0;
  let totalCost = 0;
  const perRound: ChatResult["perRound"] = [];
  const toolsCalled: string[] = [];
  const start = Date.now();

  for (let round = 1; round <= maxRounds; round++) {
    const stream = streamSimple(model, {
      systemPrompt,
      messages,
      tools: tools as any,
    }, { apiKey, sessionId: `baseline-${taskDef.name}-${start}` });

    const response: AssistantMessage = await stream.result();

    // Track metrics
    const u = response.usage;
    totalInput += u.input;
    totalOutput += u.output;
    totalCached += u.cacheRead;
    totalTokens += u.totalTokens;
    totalCost += u.cost.total;
    perRound.push({
      round,
      input: u.input,
      cached: u.cacheRead,
      output: u.output,
      total: u.totalTokens,
      cost: u.cost.total,
    });

    // Append assistant message to conversation (THIS IS THE KEY DIFFERENCE —
    // chat loop accumulates everything, pi-exec discards per phase)
    messages.push({
      role: "assistant",
      content: response.content,
      timestamp: Date.now(),
    } as any);

    // Check for tool calls
    const toolCalls = response.content.filter(
      (c: any) => c.type === "toolCall",
    );

    if (toolCalls.length === 0) {
      // No tool calls — check if done
      const textContent = response.content
        .filter((c: any) => c.type === "text" || c.type === "thinking")
        .map((c: any) => c.text ?? "")
        .join("");

      if (textContent.includes("TASK COMPLETE") || round === maxRounds) {
        const assertionResults = taskDef.assertions
          ? checkAssertions(taskDef.assertions, taskDef.initialState ?? {}, workDir)
          : [];
        const assertionsPassed = assertionResults.filter((a) => a.passed).length;

        return {
          taskName: taskDef.name,
          status: "completed",
          rounds: round,
          inputTokens: totalInput,
          outputTokens: totalOutput,
          cacheReadTokens: totalCached,
          totalTokens,
          cost: totalCost,
          durationMs: Date.now() - start,
          assertionsPassed,
          assertionsTotal: assertionResults.length,
          passed: assertionResults.every((a) => a.passed),
          perRound,
          toolsCalled,
        };
      }

      // Text-only but not done — nudge more aggressively
      messages.push({
        role: "user",
        content: "You must use the provided tools (read, edit, write, grep, find, ls) to complete the task. Do not describe what to do — actually call the tools now.",
        timestamp: Date.now(),
      });
      continue;
    }

    // Execute tool calls and append results (they stay in conversation forever)
    for (const tc of toolCalls) {
      const tool = tools.find((t) => t.name === tc.name);
      if (!tool) {
        messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: `Error: Unknown tool "${tc.name}"` }],
          isError: true,
          timestamp: Date.now(),
        } as any);
        continue;
      }

      try {
        toolsCalled.push(tc.name);
        // Validate args same way pi-exec does (via pi-ai's validateToolArguments)
        const validatedArgs = validateToolArguments(tool as any, { id: tc.id, name: tc.name, arguments: tc.arguments });
        // AgentTool.execute(id, args, signal) — returns { content: ContentBlock[] }
        const result = await (tool as any).execute(tc.id, validatedArgs);
        messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: result.content,
          isError: false,
          timestamp: Date.now(),
        } as any);
      } catch (err) {
        messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: `Error: ${err}` }],
          isError: true,
          timestamp: Date.now(),
        } as any);
      }
    }
  }

  // Max rounds exceeded
  const assertionResults = taskDef.assertions
    ? checkAssertions(taskDef.assertions, taskDef.initialState ?? {}, workDir)
    : [];

  return {
    taskName: taskDef.name,
    status: "max_rounds",
    rounds: maxRounds,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCached,
    totalTokens,
    cost: totalCost,
    durationMs: Date.now() - start,
    assertionsPassed: assertionResults.filter((a) => a.passed).length,
    assertionsTotal: assertionResults.length,
    passed: assertionResults.every((a) => a.passed),
    perRound,
    toolsCalled,
  };
}

// ---------------------------------------------------------------------------
// Run all tasks
// ---------------------------------------------------------------------------

console.log("═".repeat(70));
console.log("CHAT-LOOP BASELINE");
console.log("═".repeat(70));
console.log(`Model: ${modelId}`);
console.log(`Tasks: ${taskDirs.length} (skipping: ${[...SKIP_TASKS].join(", ")})`);
console.log(`Max rounds: ${maxRounds}`);
console.log("═".repeat(70));

const results: ChatResult[] = [];

for (const taskDir of taskDirs) {
  const taskDef: TaskDefinition = JSON.parse(
    readFileSync(join(taskDir, "task.json"), "utf-8"),
  );
  process.stdout.write(`\n▶ ${taskDef.name.padEnd(30)} `);

  try {
    const result = await runChatBaseline(taskDir);
    results.push(result);

    const icon = result.passed ? "✅" : "❌";
    console.log(
      `${icon} ${result.status.padEnd(12)} ${result.rounds}r $${result.cost.toFixed(4)} ${result.durationMs}ms ${result.inputTokens}in/${result.cacheReadTokens}cache/${result.outputTokens}out`,
    );
    console.log(`   tools: ${result.toolsCalled.join(", ") || "(none)"}`);
    console.log(`   assertions: ${result.assertionsPassed}/${result.assertionsTotal}`);

    // Show per-round input token growth
    if (result.perRound.length > 1) {
      const growth = result.perRound.map((r) => r.input);
      console.log(`   input/round: [${growth.join(", ")}]`);
    }
  } catch (err) {
    console.log(`❌ ERROR: ${String(err).slice(0, 100)}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("\n" + "═".repeat(70));
console.log("CHAT-LOOP SUMMARY");
console.log("═".repeat(70));

const totalCost = results.reduce((s, r) => s + r.cost, 0);
const totalInput = results.reduce((s, r) => s + r.inputTokens, 0);
const totalCached = results.reduce((s, r) => s + r.cacheReadTokens, 0);
const totalOutput = results.reduce((s, r) => s + r.outputTokens, 0);
const totalRounds = results.reduce((s, r) => s + r.rounds, 0);
const passed = results.filter((r) => r.passed).length;

console.log(`Pass rate:     ${passed}/${results.length}`);
console.log(`Total cost:    $${totalCost.toFixed(4)}`);
console.log(`Total input:   ${totalInput.toLocaleString()} tokens`);
console.log(`Total cached:  ${totalCached.toLocaleString()} tokens (${((totalCached / (totalInput + totalCached)) * 100).toFixed(1)}%)`);
console.log(`Total output:  ${totalOutput.toLocaleString()} tokens`);
console.log(`Total rounds:  ${totalRounds}`);
console.log(`Avg cost/task: $${(totalCost / results.length).toFixed(4)}`);
console.log("═".repeat(70));

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

if (outputPath) {
  const outDir = resolve(outputPath, "..");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    model: modelId,
    type: "chat-baseline",
    results,
  }, null, 2));
  console.log(`\nResults written to ${outputPath}`);
}
