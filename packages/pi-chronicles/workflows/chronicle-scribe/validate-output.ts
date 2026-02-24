/**
 * Output validator for chronicle-scribe.
 *
 * Checks: did the agent write chronicle markdown files?
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const user = process.env.USER || process.env.LOGNAME || "unknown";
const bosunRoot = process.env.BOSUN_ROOT || process.cwd();
const date = process.env.WORKFLOW_DATE || new Date().toISOString().split("T")[0];
const yearMonth = date.slice(0, 7);

const chroniclesDir = join(bosunRoot, "workspace", "users", user, "public", "chronicles", yearMonth);

if (!existsSync(chroniclesDir)) {
  console.error(`Chronicles directory not created: ${chroniclesDir}`);
  process.exit(1);
}

const files = readdirSync(chroniclesDir).filter(f => f.endsWith(".md") && f.startsWith(date.slice(8)));

if (files.length === 0) {
  console.error(`No chronicle files created for ${date} in ${chroniclesDir}`);
  process.exit(1);
}

// Check each chronicle has valid frontmatter
for (const file of files) {
  const content = readFileSync(join(chroniclesDir, file), "utf-8");

  if (!content.startsWith("---")) {
    console.error(`Chronicle ${file} missing frontmatter (must start with ---)`);
    process.exit(1);
  }

  if (!content.includes("title:")) {
    console.error(`Chronicle ${file} missing title in frontmatter`);
    process.exit(1);
  }

  if (content.length < 200) {
    console.error(`Chronicle ${file} too short (${content.length} chars). Write a substantive narrative.`);
    process.exit(1);
  }
}

console.log(`Valid chronicles: ${files.length} file(s) in ${chroniclesDir}`);
process.exit(0);
