/**
 * Input validator for chronicle-analyzer.
 *
 * Checks: are there session summaries for today?
 * Exits 0 to proceed, 1 to skip.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const user = process.env.USER || process.env.LOGNAME || "unknown";
const bosunRoot = process.env.BOSUN_ROOT || process.cwd();
const date = process.env.WORKFLOW_DATE || new Date().toISOString().split("T")[0];
const yearMonth = date.slice(0, 7);

const sessionsDir = join(bosunRoot, "workspace", "users", user, "sessions", yearMonth);

if (!existsSync(sessionsDir)) {
  console.error(`No sessions directory: ${sessionsDir}`);
  process.exit(1);
}

// Count session files that match the target date
const files = readdirSync(sessionsDir).filter(f => f.endsWith(".md") && f !== "_index.md");

let matchCount = 0;
for (const file of files) {
  try {
    const content = readFileSync(join(sessionsDir, file), "utf-8");
    if (content.includes(`date: ${date}`) || content.includes(`date: "${date}"`)) {
      matchCount++;
    }
  } catch {}
}

if (matchCount === 0) {
  console.error(`No session summaries found for ${date}`);
  process.exit(1);
}

// Check if analysis already exists for today
const analysisPath = join(bosunRoot, "workspace", "users", user, "chronicles", "analysis", `${date}.json`);
if (existsSync(analysisPath)) {
  // Check if we have newer sessions than the analysis
  const { statSync } = await import("fs");
  const analysisMtime = statSync(analysisPath).mtime.getTime();

  let hasNewer = false;
  for (const file of files) {
    try {
      const mtime = statSync(join(sessionsDir, file)).mtime.getTime();
      if (mtime > analysisMtime) {
        hasNewer = true;
        break;
      }
    } catch {}
  }

  if (!hasNewer) {
    console.error(`Analysis already up-to-date for ${date}`);
    process.exit(1);
  }
}

console.log(`Found ${matchCount} session(s) for ${date}, proceeding`);
process.exit(0);
