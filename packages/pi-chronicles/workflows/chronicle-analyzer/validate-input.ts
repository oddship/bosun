/**
 * Input validator for chronicle-analyzer.
 *
 * Checks: are there session summaries for today, and is the analysis stale
 * relative to today's sessions or today's top-level plans?
 * Exits 0 to proceed, 1 to skip.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const user = process.env.USER || process.env.LOGNAME || "unknown";
const bosunRoot = process.env.BOSUN_ROOT || process.cwd();
const date = process.env.WORKFLOW_DATE || new Date().toISOString().split("T")[0];
const yearMonth = date.slice(0, 7);
const dayPrefix = `${date.slice(8, 10)}-`;

const sessionsDir = join(bosunRoot, "workspace", "users", user, "sessions", yearMonth);
const plansDir = join(bosunRoot, "workspace", "users", user, "plans", yearMonth);

if (!existsSync(sessionsDir)) {
  console.error(`No sessions directory: ${sessionsDir}`);
  process.exit(1);
}

function sessionMatchesDate(file: string, content: string): boolean {
  return file.startsWith(`${date}-`)
    || content.includes(`date: ${date}`)
    || content.includes(`date: "${date}"`);
}

function planMatchesDate(file: string, content: string): boolean {
  return file.startsWith(dayPrefix)
    || content.includes(`Date: ${date}`)
    || content.includes(`date: ${date}`)
    || content.includes(`date: "${date}"`);
}

function matchingFiles(dir: string, matcher: (file: string, content: string) => boolean): string[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith(".md") && f !== "_index.md");
  const matches: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      if (matcher(file, content)) matches.push(file);
    } catch {}
  }

  return matches;
}

const sessionFiles = matchingFiles(sessionsDir, sessionMatchesDate);
const planFiles = matchingFiles(plansDir, planMatchesDate);

if (sessionFiles.length === 0) {
  console.error(`No session summaries found for ${date}`);
  process.exit(1);
}

const analysisPath = join(bosunRoot, "workspace", "users", user, "chronicles", "analysis", `${date}.json`);
if (existsSync(analysisPath)) {
  const analysisMtime = statSync(analysisPath).mtime.getTime();
  const pathsToCheck = [
    ...sessionFiles.map(file => join(sessionsDir, file)),
    ...planFiles.map(file => join(plansDir, file)),
  ];

  const hasNewerInputs = pathsToCheck.some(file => {
    try {
      return statSync(file).mtime.getTime() > analysisMtime;
    } catch {
      return false;
    }
  });

  if (!hasNewerInputs) {
    console.error(`Analysis already up-to-date for ${date}`);
    process.exit(1);
  }
}

console.log(`Found ${sessionFiles.length} session(s) and ${planFiles.length} plan(s) for ${date}, proceeding`);
process.exit(0);
