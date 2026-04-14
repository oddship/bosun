/**
 * Output validator for catchup-sessions.
 *
 * Checks:
 * 1. Agent exited successfully
 * 2. Session summary markdown paths do not contain malformed filenames or unsafe path characters
 * 3. Session index links do not point at malformed summary paths
 *
 * Exits 0 for pass, 1 for retry.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

const user = process.env.USER || process.env.LOGNAME || "unknown";
const bosunRoot = process.env.BOSUN_ROOT || process.cwd();
const summariesRoot = join(bosunRoot, "workspace", "users", user, "sessions");
const agentExitCode = Number(process.env.AGENT_EXIT_CODE || "0");

if (agentExitCode !== 0) {
  console.error(`catchup-sessions agent exited with code ${agentExitCode}`);
  process.exit(1);
}

if (!existsSync(summariesRoot)) {
  console.log(`No summaries directory yet: ${summariesRoot}`);
  process.exit(0);
}

function listMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function readFrontmatter(filePath: string): string | null {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : null;
}

function isSessionSummary(filePath: string): boolean {
  const frontmatter = readFrontmatter(filePath);
  return frontmatter ? /^session_file:\s*/m.test(frontmatter) : false;
}

function hasUnsafePathSegment(pathValue: string): boolean {
  return pathValue.split(sep).some((segment) => /[\r\n"]/.test(segment));
}

function hasEmptySlug(fileName: string): boolean {
  return fileName === "-.md" || /^\d{4}-\d{2}-\d{2}-(?:-\d+)?\.md$/.test(fileName);
}

const problems: string[] = [];

for (const filePath of listMarkdownFiles(summariesRoot)) {
  if (!isSessionSummary(filePath)) continue;

  const relPath = relative(summariesRoot, filePath);
  const fileName = basename(filePath);
  const parentDir = relative(summariesRoot, join(filePath, ".."));

  if (parentDir === "") {
    problems.push(`session summary must not live at sessions root: ${relPath}`);
  }
  if (hasUnsafePathSegment(relPath)) {
    problems.push(`session summary path contains unsafe characters: ${JSON.stringify(relPath)}`);
  }
  if (hasEmptySlug(fileName)) {
    problems.push(`session summary filename has an empty slug: ${relPath}`);
  }
}

for (const filePath of listMarkdownFiles(summariesRoot)) {
  if (basename(filePath) !== "_index.md") continue;

  const relPath = relative(summariesRoot, filePath);
  const content = readFileSync(filePath, "utf-8");
  const links = content.matchAll(/\]\(\.\/([\s\S]*?)\)/g);

  for (const match of links) {
    const target = match[1];
    const targetName = basename(target);
    if (/[\r\n"]/.test(target)) {
      problems.push(`index link contains unsafe characters: ${relPath} -> ${JSON.stringify(target)}`);
    }
    if (hasEmptySlug(targetName)) {
      problems.push(`index link points at malformed summary filename: ${relPath} -> ${target}`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log("catchup-sessions output validated");
process.exit(0);
