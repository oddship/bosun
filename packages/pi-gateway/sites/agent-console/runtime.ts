#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

type SiteMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  source: "browser" | "gateway" | "runtime";
};

const root = process.env.BOSUN_ROOT || process.cwd();
const stateDir = join(root, "packages", "pi-gateway", "sites", "agent-console", ".gateway");
const inboxPath = join(stateDir, "inbox.json");
const repliesPath = join(stateDir, "replies.json");

function ensureStateDir(): void {
  mkdirSync(stateDir, { recursive: true });
}

function readQueue(path: string): SiteMessage[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SiteMessage[];
  } catch {
    return [];
  }
}

function writeQueue(path: string, messages: SiteMessage[]): void {
  writeFileSync(path, `${JSON.stringify(messages, null, 2)}\n`, "utf-8");
}

function createReply(content: string): SiteMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    ts: new Date().toISOString(),
    source: "runtime",
  };
}

function formatReply(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "I received an empty message.";
  if (/hello/i.test(trimmed)) return `Hello from the agent-console runtime. You said: ${trimmed}`;
  if (/status/i.test(trimmed)) return "Agent-console runtime is up and accepting framed browser messages.";
  return `Agent-console runtime received: ${trimmed}`;
}

function processInbox(): void {
  ensureStateDir();
  const inbox = readQueue(inboxPath);
  if (inbox.length === 0) return;

  const replies = readQueue(repliesPath);
  for (const message of inbox) {
    console.log(`[agent-console-runtime] received ${message.id}: ${message.content}`);
    replies.push(createReply(formatReply(message.content)));
  }

  writeQueue(repliesPath, replies);
  writeQueue(inboxPath, []);
}

console.log("[agent-console-runtime] started");
console.log("[agent-console-runtime] structured reply framing active");

setInterval(() => {
  processInbox();
  console.log(`[agent-console-runtime] heartbeat ${new Date().toISOString()}`);
}, 2000);
