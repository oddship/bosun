/**
 * Input validator — skip embedding if memory is disabled.
 *
 * The actual "no docs need embedding" check happens inside embed.ts after
 * store.update(), since we can't cheaply check without loading qmd.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const BOSUN_ROOT = process.env.BOSUN_ROOT || process.cwd();

// Check if memory is enabled
const configPath = join(BOSUN_ROOT, ".pi", "pi-memory.json");
if (existsSync(configPath)) {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    if (raw.enabled === false) {
      console.error("Memory disabled in pi-memory.json");
      process.exit(1);
    }
  } catch {}
}

// Check if DB exists and has documents needing embedding
const dbPath = (() => {
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      const p = raw.dbPath || ".bosun-home/.cache/qmd/index.sqlite";
      return isAbsolute(p) ? p : resolve(BOSUN_ROOT, p);
    } catch {}
  }
  return resolve(BOSUN_ROOT, ".bosun-home/.cache/qmd/index.sqlite");
})();

if (!existsSync(dbPath)) {
  // No DB yet — update() will create it, so proceed
  console.log("No index DB yet, will create during embed");
  process.exit(0);
}

// DB exists — always proceed. The embed script handles the needsEmbedding check
// efficiently after update(). We can't cheaply check from here without loading qmd.
process.exit(0);
