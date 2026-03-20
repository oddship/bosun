#!/usr/bin/env bun
/**
 * Quick check: does the model see and use tools in a minimal setup?
 */

import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { createReadTool } from "@mariozechner/pi-coding-agent";
import { getApiKey } from "./lib/auth.js";

const model = getModel("openai-codex", "gpt-5.1-codex-mini")!;
const apiKey = await getApiKey("openai-codex");

const readTool = createReadTool(process.cwd());

console.log("Tool definition:", JSON.stringify({ name: readTool.name, description: readTool.description }, null, 2));

const stream = streamSimple(model, {
  systemPrompt: "You are a coding assistant. Use the read tool to read files.",
  messages: [
    { role: "user", content: "Read the file package.json and tell me the name field.", timestamp: Date.now() },
  ],
  tools: [readTool] as any,
}, { apiKey });

const r = await stream.result();

console.log("\nResponse content (raw types):", r.content.map((c: any) => ({ type: c.type, name: c.name })));
// Check both possible type names
const toolCalls1 = r.content.filter((c: any) => c.type === "tool_call");
const toolCalls2 = r.content.filter((c: any) => c.type === "toolCall");
console.log("tool_call matches:", toolCalls1.length);
console.log("toolCall matches:", toolCalls2.length);
const toolCalls = [...toolCalls1, ...toolCalls2];
for (const tc of toolCalls) {
  console.log(`  ${tc.name}:`, JSON.stringify(tc, null, 2));
}
const texts = r.content.filter((c: any) => c.type === "text");
for (const t of texts) {
  console.log("Text:", t.text.slice(0, 200));
}
