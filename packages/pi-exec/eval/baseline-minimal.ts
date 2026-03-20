#!/usr/bin/env bun
/**
 * Minimal 2-round chat loop to debug tool result flow.
 */

import { streamSimple, getModel, validateToolArguments, type Message } from "@mariozechner/pi-ai";
import { createReadTool, createEditTool } from "@mariozechner/pi-coding-agent";
import { mkdtempSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getApiKey } from "./lib/auth.js";

const model = getModel("openai-codex", "gpt-5.1-codex-mini")!;
const apiKey = await getApiKey("openai-codex");

// Set up temp dir with fixture
const workDir = mkdtempSync(join(tmpdir(), "baseline-debug-"));
cpSync(join(import.meta.dirname!, "tasks/fix-bug/fixture"), workDir, { recursive: true });
console.log("workDir:", workDir);

const readTool = createReadTool(workDir);
const editTool = createEditTool(workDir);

const systemPrompt = `You are a coding assistant. Fix the off-by-one bug in src/range.ts.
The range(1, 5) function should return [1, 2, 3, 4, 5] but currently returns [1, 2, 3, 4].
Use the read tool to read the file, then the edit tool to fix it.
When done, say "TASK COMPLETE".`;

const messages: Message[] = [
  { role: "user", content: "Read src/range.ts and fix the bug.", timestamp: Date.now() },
];

for (let round = 1; round <= 5; round++) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`ROUND ${round}`);
  console.log(`Messages being sent: ${messages.length}`);
  // Log last message
  const lastMsg = messages[messages.length - 1] as any;
  console.log(`Last message role: ${lastMsg.role}`);
  if (lastMsg.role === "toolResult") {
    const contentText = lastMsg.content?.map?.((c: any) => c.text)?.join("") ?? String(lastMsg.content);
    console.log(`  toolCallId: ${lastMsg.toolCallId}`);
    console.log(`  toolName: ${lastMsg.toolName}`);
    console.log(`  content preview: ${contentText.slice(0, 200)}`);
  }

  const stream = streamSimple(model, {
    systemPrompt,
    messages,
    tools: [readTool, editTool] as any,
  }, { apiKey });

  const response = await stream.result();
  
  console.log(`\nResponse content blocks: ${response.content.length}`);
  for (const block of response.content) {
    const b = block as any;
    console.log(`  type=${b.type}`);
    if (b.type === "text") console.log(`    text: "${(b.text ?? "").slice(0, 300)}"`);
    if (b.type === "thinking") console.log(`    thinking: "${(b.text ?? b.thinking ?? JSON.stringify(b)).slice(0, 300)}"`);
    if (b.type === "toolCall") {
      console.log(`    name: ${b.name}`);
      console.log(`    id: ${b.id}`);
      console.log(`    arguments: ${JSON.stringify(b.arguments)}`);
    }
  }
  console.log(`  usage: in=${response.usage.input} cached=${response.usage.cacheRead} out=${response.usage.output}`);

  // Append assistant response
  messages.push(response as any);

  // Handle tool calls
  const toolCalls = response.content.filter((c: any) => c.type === "toolCall");
  if (toolCalls.length === 0) {
    console.log("\nNo tool calls — checking for completion text");
    break;
  }

  for (const tc of toolCalls as any[]) {
    const tool = [readTool, editTool].find(t => t.name === tc.name);
    if (!tool) {
      console.log(`  Unknown tool: ${tc.name}`);
      continue;
    }
    
    console.log(`\nExecuting ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`);
    try {
      const validatedArgs = validateToolArguments(tool as any, { id: tc.id, name: tc.name, arguments: tc.arguments });
      const result = await (tool as any).execute(tc.id, validatedArgs);
      const text = result.content?.map?.((c: any) => c.text ?? "").join("") ?? JSON.stringify(result);
      console.log(`  Result (${text.length} chars): ${text.slice(0, 200)}`);
      
      messages.push({
        role: "toolResult" as const,
        toolCallId: tc.id,
        toolName: tc.name,
        content: result.content,
        isError: false,
        timestamp: Date.now(),
      } as any);
    } catch (err) {
      console.log(`  Error: ${err}`);
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

console.log(`\nFinal message count: ${messages.length}`);
