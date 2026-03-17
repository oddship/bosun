#!/usr/bin/env bun

import {
  executeMemoryGet,
  executeMemoryMultiGet,
  executeMemorySearch,
  executeMemoryStatus,
} from "../packages/pi-memory/src/tools.js";
import { resetMemoryRuntime } from "../packages/pi-memory/src/store.js";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();

  try {
    if (!command || command === "help" || command === "--help") {
      console.log(`Usage:
  bun scripts/memory.ts status
  bun scripts/memory.ts search <query>
  bun scripts/memory.ts get <id> [maxLines]
  bun scripts/memory.ts multi-get <pattern> [maxBytes]`);
      return;
    }

    let result: unknown;

    if (command === "status") {
      result = await executeMemoryStatus(cwd);
    } else if (command === "search") {
      const query = rest.join(" ").trim();
      if (!query) throw new Error("search requires a query");
      result = await executeMemorySearch(cwd, { query, mode: "keyword" });
    } else if (command === "get") {
      const id = rest[0];
      if (!id) throw new Error("get requires a docid or path");
      const maxLines = rest[1] ? Number(rest[1]) : undefined;
      result = await executeMemoryGet(cwd, { id, maxLines });
    } else if (command === "multi-get") {
      const pattern = rest[0];
      if (!pattern) throw new Error("multi-get requires a pattern");
      const maxBytes = rest[1] ? Number(rest[1]) : undefined;
      result = await executeMemoryMultiGet(cwd, { pattern, maxBytes });
    } else {
      throw new Error(`Unknown command: ${command}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await resetMemoryRuntime();
  }
}

await main();
