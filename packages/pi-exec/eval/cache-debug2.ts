#!/usr/bin/env bun
/**
 * Debug: intercept raw OpenAI response to check usage.input_tokens_details.
 */

import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { getApiKey } from "./lib/auth.js";

const model = getModel("openai-codex", "gpt-5.1-codex-mini")!;
const apiKey = await getApiKey("openai-codex");

// Big system prompt to ensure we're above any minimum threshold
const systemPrompt = `You are a helpful coding assistant who helps with TypeScript tasks.
${"Here is some additional context that makes this prompt longer. ".repeat(100)}`;

const sessionId = "cache-debug-" + Date.now();

console.log(`System prompt length: ~${systemPrompt.length} chars`);
console.log(`SessionId: ${sessionId}\n`);

// Call 1: cold
const s1 = streamSimple(model, {
  systemPrompt,
  messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
  tools: [],
}, { sessionId, apiKey });

const r1 = await s1.result();
console.log("Call 1 (cold):");
console.log(`  input: ${r1.usage.input}, cached: ${r1.usage.cacheRead}, output: ${r1.usage.output}, total: ${r1.usage.totalTokens}`);
console.log(`  cost: $${r1.usage.cost.total.toFixed(6)}`);

// Call 2: same sessionId, same system prompt — should cache
const s2 = streamSimple(model, {
  systemPrompt,
  messages: [
    { role: "user", content: "Say hello", timestamp: Date.now() },
    r1 as any,
    { role: "user", content: "Now say goodbye", timestamp: Date.now() },
  ],
  tools: [],
}, { sessionId, apiKey });

const r2 = await s2.result();
console.log("\nCall 2 (should cache prefix):");
console.log(`  input: ${r2.usage.input}, cached: ${r2.usage.cacheRead}, output: ${r2.usage.output}, total: ${r2.usage.totalTokens}`);
console.log(`  cost: $${r2.usage.cost.total.toFixed(6)}`);

if (r2.usage.cacheRead > 0) {
  console.log(`\n✅ Caching works! ${r2.usage.cacheRead} cached tokens.`);
} else {
  console.log(`\n❌ No caching detected. Possible reasons:`);
  console.log(`  - Codex Responses API may not support prompt_cache_key`);
  console.log(`  - Minimum prefix length not met`);
  console.log(`  - Cache not warmed yet (may need ~30s delay)`);
  
  // Try a 3rd call with a small delay
  await new Promise(r => setTimeout(r, 3000));
  const s3 = streamSimple(model, {
    systemPrompt,
    messages: [
      { role: "user", content: "Say something", timestamp: Date.now() },
    ],
    tools: [],
  }, { sessionId, apiKey });
  
  const r3 = await s3.result();
  console.log(`\nCall 3 (after 3s delay):`);
  console.log(`  input: ${r3.usage.input}, cached: ${r3.usage.cacheRead}, output: ${r3.usage.output}`);
}
