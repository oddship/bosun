/**
 * Output validator for chronicle-analyzer.
 *
 * Checks: did the agent write valid analysis JSON?
 * Exits 0 for pass, 1 for retry (stderr = feedback to agent).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const user = process.env.USER || process.env.LOGNAME || "unknown";
const bosunRoot = process.env.BOSUN_ROOT || process.cwd();
const date = process.env.WORKFLOW_DATE || new Date().toISOString().split("T")[0];

const analysisPath = join(bosunRoot, "workspace", "users", user, "chronicles", "analysis", `${date}.json`);

// Check file exists
if (!existsSync(analysisPath)) {
  console.error(`Analysis file not created: ${analysisPath}. Write the JSON analysis to this path.`);
  process.exit(1);
}

// Check valid JSON
let data: any;
try {
  data = JSON.parse(readFileSync(analysisPath, "utf-8"));
} catch (err) {
  console.error(`Invalid JSON in ${analysisPath}: ${err}. Ensure the file contains valid JSON.`);
  process.exit(1);
}

// Check required fields
if (!data.date) {
  console.error('Missing "date" field in analysis JSON.');
  process.exit(1);
}

if (!Array.isArray(data.journeys)) {
  console.error('Missing or invalid "journeys" array in analysis JSON.');
  process.exit(1);
}

// Check journeys have required structure
for (let i = 0; i < data.journeys.length; i++) {
  const j = data.journeys[i];
  if (!j.title || !j.slug) {
    console.error(`Journey ${i + 1} missing title or slug.`);
    process.exit(1);
  }
  if (!Array.isArray(j.sessions) || j.sessions.length === 0) {
    console.error(`Journey "${j.title}" has no sessions.`);
    process.exit(1);
  }
  // Check sessions have summaries (not just filenames)
  for (const s of j.sessions) {
    if (!s.summary || s.summary.length < 20) {
      console.error(`Session "${s.title || s.file}" in journey "${j.title}" has insufficient summary. Extract rich 3-5 sentence summaries.`);
      process.exit(1);
    }
  }
}

console.log(`Valid analysis: ${data.journeys.length} journeys, ${data.total_sessions} sessions`);
process.exit(0);
