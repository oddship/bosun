/**
 * Input validator for catchup-sessions.
 *
 * Checks: are there session JSONL files without corresponding summaries?
 * Summaries use slug-based filenames, so we grep frontmatter for session_file
 * rather than matching by filename.
 *
 * Exits 0 to proceed, 1 to skip.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const user = process.env.USER || process.env.LOGNAME || "unknown";
const bosunRoot = process.env.BOSUN_ROOT || process.cwd();

const sessionsJsonlRoot = join(bosunRoot, ".bosun-home", ".pi", "agent", "sessions");
const summariesRoot = join(bosunRoot, "workspace", "users", user, "sessions");

if (!existsSync(sessionsJsonlRoot)) {
  console.error(`No sessions directory: ${sessionsJsonlRoot}`);
  process.exit(1);
}

// Build a set of JSONL filenames that already have summaries
// by scanning all summary .md files for session_file in frontmatter
const summarizedJsonls = new Set<string>();

if (existsSync(summariesRoot)) {
  for (const monthDir of readdirSync(summariesRoot)) {
    const monthPath = join(summariesRoot, monthDir);
    if (!statSync(monthPath).isDirectory()) continue;

    for (const file of readdirSync(monthPath)) {
      if (!file.endsWith(".md") || file === "_index.md") continue;
      try {
        // Read just the first 500 bytes — frontmatter is at the top
        const content = readFileSync(join(monthPath, file), "utf-8").slice(0, 500);
        const match = content.match(/session_file:\s*(.+\.jsonl)/);
        if (match) {
          summarizedJsonls.add(match[1].trim());
        }
      } catch {}
    }
  }
}

// Scan JSONL files and count unsummarized
const projectDirs = readdirSync(sessionsJsonlRoot).filter((d) => {
  const p = join(sessionsJsonlRoot, d);
  return statSync(p).isDirectory();
});

let unsummarized = 0;
const MIN_SIZE = 5000; // Skip tiny sessions (< 5KB)
const MIN_AGE_MS = 5 * 60 * 1000; // Skip sessions modified in last 5 minutes
const now = Date.now();

for (const dir of projectDirs) {
  const projectDir = join(sessionsJsonlRoot, dir);
  const jsonlFiles = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));

  for (const file of jsonlFiles) {
    const filePath = join(projectDir, file);
    const stat = statSync(filePath);

    if (stat.size < MIN_SIZE) continue;
    if (now - stat.mtime.getTime() < MIN_AGE_MS) continue;

    if (!summarizedJsonls.has(file)) {
      unsummarized++;
    }
  }
}

if (unsummarized === 0) {
  console.error("All sessions are summarized");
  process.exit(1);
}

console.log(`Found ${unsummarized} unsummarized session(s), proceeding`);
process.exit(0);
