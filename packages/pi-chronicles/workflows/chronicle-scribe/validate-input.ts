/**
 * Input validator for chronicle-scribe.
 *
 * Checks: are there analysis JSONs without corresponding chronicle markdowns?
 * Exits 0 to proceed, 1 to skip.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const user = process.env.USER || process.env.LOGNAME || "unknown";
const bosunRoot = process.env.BOSUN_ROOT || process.cwd();

const analysisDir = join(bosunRoot, "workspace", "users", user, "chronicles", "analysis");

if (!existsSync(analysisDir)) {
  console.error("No analysis directory found");
  process.exit(1);
}

const analysisFiles = readdirSync(analysisDir).filter((f) => f.endsWith(".json"));

if (analysisFiles.length === 0) {
  console.error("No analysis files found");
  process.exit(1);
}

// Check each analysis for unprocessed journeys
let unprocessedCount = 0;

for (const file of analysisFiles) {
  const date = file.replace(".json", ""); // e.g., "2026-02-24"
  const yearMonth = date.slice(0, 7); // e.g., "2026-02"
  const day = date.slice(8, 10); // e.g., "24" (always zero-padded from ISO date)

  try {
    const analysis = JSON.parse(readFileSync(join(analysisDir, file), "utf-8"));
    const chroniclesDir = join(bosunRoot, "workspace", "users", user, "public", "chronicles", yearMonth);

    if (!existsSync(chroniclesDir)) {
      unprocessedCount += analysis.journeys?.length || 1;
      continue;
    }

    const existingChronicles = readdirSync(chroniclesDir).filter(
      (f) => f.endsWith(".md") && f.startsWith(day + "-"),
    );

    // Compare journey count to chronicle count for this date
    const journeyCount = analysis.journeys?.length || 0;
    if (existingChronicles.length < journeyCount) {
      unprocessedCount += journeyCount - existingChronicles.length;
    }
  } catch {
    // If we can't parse, assume it needs processing
    unprocessedCount++;
  }
}

if (unprocessedCount === 0) {
  console.error("All analyses already have chronicles");
  process.exit(1);
}

console.log(`Found ${unprocessedCount} unprocessed journey(s), proceeding`);
process.exit(0);
