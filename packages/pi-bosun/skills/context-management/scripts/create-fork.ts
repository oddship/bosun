#!/usr/bin/env bun
import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { dirname, join, basename } from "path";
import { existsSync } from "fs";

const sessionPath = process.argv[2];
const reason = process.argv.slice(3).join(" ") || "explore alternative";

// Find latest session if no path provided
async function findLatestSession(): Promise<string | null> {
  const sessionsBase = "..bosun-home/.pi/agent/sessions";
  if (!existsSync(sessionsBase)) return null;
  
  const cwdDirs = await readdir(sessionsBase);
  if (cwdDirs.length === 0) return null;
  
  const allSessions: { path: string; mtime: number }[] = [];
  for (const cwdDir of cwdDirs) {
    const cwdPath = join(sessionsBase, cwdDir);
    const files = await readdir(cwdPath);
    for (const f of files) {
      if (f.endsWith('.jsonl')) {
        const fullPath = join(cwdPath, f);
        const stat = await Bun.file(fullPath).stat();
        allSessions.push({ path: fullPath, mtime: stat?.mtime?.getTime() || 0 });
      }
    }
  }
  
  if (allSessions.length === 0) return null;
  allSessions.sort((a, b) => b.mtime - a.mtime);
  return allSessions[0].path;
}

// Parse Pi session JSONL
async function parseSession(path: string) {
  const content = await readFile(path, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const events = lines.map(line => JSON.parse(line));
  
  const sessionEvent = events.find(e => e.type === "session");
  const modelEvent = events.find(e => e.type === "model_change");
  const messages = events.filter(e => e.type === "message");
  
  // Extract files modified from tool calls
  const filesModified = new Set<string>();
  for (const msg of messages) {
    if (msg.message?.role === "assistant") {
      for (const part of msg.message.content || []) {
        if (part.type === "toolCall" && (part.name === "write" || part.name === "edit")) {
          const filePath = part.arguments?.path;
          if (filePath) filesModified.add(filePath);
        }
      }
    }
  }
  
  // Extract first user prompt as title hint
  const firstUserMsg = messages.find(m => m.message?.role === "user");
  const titleHint = firstUserMsg?.message?.content?.[0]?.text?.slice(0, 50) || "Session";
  
  return {
    id: sessionEvent?.id || basename(path, '.jsonl'),
    cwd: sessionEvent?.cwd || process.cwd(),
    model: modelEvent?.modelId || "unknown",
    titleHint,
    filesModified: [...filesModified],
  };
}

// Main
let targetPath = sessionPath;
if (!targetPath) {
  targetPath = await findLatestSession() || "";
  if (!targetPath) {
    console.error("No sessions found. Usage: create-fork.ts [session.jsonl] <reason>");
    process.exit(1);
  }
  console.error(`Using latest session: ${targetPath}`);
}

if (!existsSync(targetPath)) {
  console.error(`Session not found: ${targetPath}`);
  process.exit(1);
}

const session = await parseSession(targetPath);

const USER = process.env.USER || process.env.LOGNAME || "unknown";
const now = new Date();
const dateFolder = now.toISOString().slice(0, 7); // YYYY-MM
const day = now.getDate().toString().padStart(2, "0");
const hour = now.getHours().toString().padStart(2, "0");
const minute = now.getMinutes().toString().padStart(2, "0");
const timePrefix = `${day}-${hour}-${minute}`;

const slug = reason
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 50);

const outputPath = `workspace/users/${USER}/forks/${dateFolder}/${timePrefix}-${slug}.md`;
await mkdir(dirname(outputPath), { recursive: true });

const filesModifiedYaml =
  session.filesModified.map((f) => `  - ${f}`).join("\n") || "  []";

const content = `---
type: fork
status: pending
created: ${now.toISOString()}
picked_up_at: null
title: "${reason}"
branching_reason: experiment
session_file: ${targetPath}
session_id: ${session.id}
original_session_title: "${session.titleHint}"
model: ${session.model}
files_at_fork:
${filesModifiedYaml}
---

# Fork: ${reason}

## Branching Point
[Describe what was figured out / current state when creating this fork]

From session: ${session.titleHint}

## Exploration Direction
${reason}

## What to Try
1. [First thing to explore]
2. [Second thing to explore]

## Success Criteria
- [How will we know this direction is better/worse?]

## Notes
[Any relevant context for this exploration]

---
*Fork from session: ${session.id}*
*Session file: ${targetPath}*
*Continue with: /pickup ${outputPath}*
`;

await writeFile(outputPath, content);
console.log(outputPath);
