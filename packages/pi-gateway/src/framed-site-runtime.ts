#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type SiteMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  source: "browser" | "gateway" | "runtime";
};

const SITE_NAME = process.env.PI_SITE_NAME || "site";
const INBOX_PATH = process.env.PI_SITE_INBOX_FILE;
const REPLIES_PATH = process.env.PI_SITE_REPLIES_FILE;
const STATE_DIR = process.env.PI_SITE_STATE_DIR;
const REPLY_PREFIX = process.env.PI_SITE_REPLY_PREFIX || `${SITE_NAME}`;
const HEARTBEAT_MS = Number(process.env.PI_SITE_HEARTBEAT_MS || "2000");

if (!INBOX_PATH || !REPLIES_PATH || !STATE_DIR) {
  console.error("framed-site-runtime missing required env: PI_SITE_INBOX_FILE / PI_SITE_REPLIES_FILE / PI_SITE_STATE_DIR");
  process.exit(1);
}

function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true });
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
  if (!trimmed) return `${REPLY_PREFIX}: received an empty message.`;
  if (/hello/i.test(trimmed)) return `Hello from ${REPLY_PREFIX}. You said: ${trimmed}`;
  if (/status/i.test(trimmed)) return `${REPLY_PREFIX}: runtime is up and accepting framed browser messages.`;
  return `${REPLY_PREFIX}: ${trimmed}`;
}

function processInbox(): void {
  ensureStateDir();
  const inbox = readQueue(INBOX_PATH);
  if (inbox.length === 0) return;

  const replies = readQueue(REPLIES_PATH);
  for (const message of inbox) {
    console.log(`[framed-site-runtime:${SITE_NAME}] received ${message.id}: ${message.content}`);
    replies.push(createReply(formatReply(message.content)));
  }

  writeQueue(REPLIES_PATH, replies);
  writeQueue(INBOX_PATH, []);
}

console.log(`[framed-site-runtime:${SITE_NAME}] started`);
console.log(`[framed-site-runtime:${SITE_NAME}] structured reply framing active`);

setInterval(() => {
  processInbox();
  console.log(`[framed-site-runtime:${SITE_NAME}] heartbeat ${new Date().toISOString()}`);
}, HEARTBEAT_MS);
