#!/usr/bin/env bun
/**
 * Debug: check what usage fields come back from Codex models.
 */

import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { getApiKey } from "./lib/auth.js";

const model = getModel("openai-codex", "gpt-5.1-codex-mini")!;
const apiKey = await getApiKey("openai-codex");

const systemPrompt = "You are a helpful assistant. ".repeat(50); // Make it long enough

// Call 1: cold
const stream1 = streamSimple(model, {
  systemPrompt,
  messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
  tools: [],
}, { sessionId: "cache-test-123", apiKey });
const r1 = await stream1.result();
console.log("Call 1 (cold):");
console.log("  usage:", JSON.stringify(r1.usage, null, 2));

// Call 2: same sessionId, same prefix — should cache
const stream2 = streamSimple(model, {
  systemPrompt,
  messages: [
    { role: "user", content: "Say hello", timestamp: Date.now() },
    { role: "assistant", content: r1.content, timestamp: Date.now() } as any,
    { role: "user", content: "Say goodbye", timestamp: Date.now() },
  ],
  tools: [],
}, { sessionId: "cache-test-123", apiKey });
const r2 = await stream2.result();
console.log("\nCall 2 (should cache):");
console.log("  usage:", JSON.stringify(r2.usage, null, 2));
