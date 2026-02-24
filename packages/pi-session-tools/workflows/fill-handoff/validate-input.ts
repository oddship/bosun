/**
 * Input validator for fill-handoff.
 *
 * Checks: are there handoff files with status: pending?
 * Exits 0 to proceed, 1 to skip.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const user = process.env.USER || process.env.LOGNAME || "unknown";
const bosunRoot = process.env.BOSUN_ROOT || process.cwd();

const handoffsDir = join(bosunRoot, "workspace", "users", user, "handoffs");

if (!existsSync(handoffsDir)) {
  console.error("No handoffs directory found");
  process.exit(1);
}

// Recursively find .md files with status: pending
function findPending(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        count += findPending(fullPath);
      } else if (entry.endsWith(".md")) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          // Check frontmatter for status: pending
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch && fmMatch[1].includes("status: pending")) {
            count++;
          }
        } catch {}
      }
    }
  } catch {}
  return count;
}

const pendingCount = findPending(handoffsDir);

if (pendingCount === 0) {
  console.error("No pending handoffs found");
  process.exit(1);
}

console.log(`Found ${pendingCount} pending handoff(s), proceeding`);
process.exit(0);
