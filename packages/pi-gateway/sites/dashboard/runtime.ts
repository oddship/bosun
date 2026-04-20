#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SiteMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  source: "browser" | "gateway" | "runtime";
};

const startedAt = new Date().toISOString();
const root = process.env.BOSUN_ROOT || process.cwd();
const stateDir = join(root, "packages", "pi-gateway", "sites", "dashboard", ".gateway");
const inboxPath = join(stateDir, "inbox.json");
const outboxPath = join(stateDir, "outbox.json");

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

function respondToInbox(): void {
  ensureStateDir();
  const inbox = readQueue(inboxPath);
  if (inbox.length === 0) return;

  const outbox = readQueue(outboxPath);
  for (const message of inbox) {
    console.log(`[pi-gateway-dashboard] received message ${message.id}: ${message.content}`);
    outbox.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: `Dashboard runtime received: ${message.content}`,
      ts: new Date().toISOString(),
      source: "runtime",
    });
  }

  writeQueue(outboxPath, outbox);
  writeQueue(inboxPath, []);
}

console.log(`[pi-gateway-dashboard] runtime starting at ${startedAt}`);
console.log(`[pi-gateway-dashboard] BOSUN_ROOT=${root}`);
console.log("[pi-gateway-dashboard] bootstrap dashboard runtime active");
console.log("[pi-gateway-dashboard] runtime message bridge active");

setInterval(() => {
  respondToInbox();
  console.log(`[pi-gateway-dashboard] heartbeat ${new Date().toISOString()}`);
}, 2000);
