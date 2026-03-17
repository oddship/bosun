import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  executeMemoryGet,
  executeMemoryMultiGet,
  executeMemorySearch,
  executeMemoryStatus,
} from "../src/tools.js";
import { resetMemoryRuntime } from "../src/store.js";

const tempDirs: string[] = [];

function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-memory-tools-"));
  tempDirs.push(cwd);

  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(join(cwd, "workspace", "users", "demo", "plans"), { recursive: true });
  mkdirSync(join(cwd, "docs"), { recursive: true });

  writeFileSync(join(cwd, ".pi", "pi-memory.json"), JSON.stringify({
    enabled: true,
    dbPath: ".cache/memory.sqlite",
    autoUpdateOnOpen: true,
    defaultMode: "keyword",
    defaultLimit: 5,
    collections: {
      sessions: {
        path: "workspace/users",
        pattern: "**/*.md",
        includeByDefault: true,
      },
      docs: {
        path: "docs",
        pattern: "**/*.md",
        includeByDefault: true,
      },
    },
  }, null, 2));

  writeFileSync(
    join(cwd, "workspace", "users", "demo", "plans", "memory-plan.md"),
    `---\ntitle: Memory Plan\n---\n\n# Memory Plan\n\nWe should build a memory package backed by qmd and index curated markdown collections.\n`,
  );

  writeFileSync(
    join(cwd, "docs", "architecture.md"),
    `# Architecture\n\nThe memory subsystem should use qmd as a library and avoid MCP.\n`,
  );

  return cwd;
}

afterEach(async () => {
  await resetMemoryRuntime();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("pi-memory tools", () => {
  it("searches indexed markdown memory", async () => {
    const cwd = makeRepo();
    const result = await executeMemorySearch(cwd, {
      query: "memory qmd",
      mode: "keyword",
      collections: ["sessions", "docs"],
      limit: 5,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some((item) => item.title.includes("Memory Plan") || item.file.includes("architecture"))).toBe(true);
  });

  it("retrieves a single document after search", async () => {
    const cwd = makeRepo();
    const search = await executeMemorySearch(cwd, {
      query: "memory package",
      mode: "keyword",
      limit: 1,
    });

    expect(search.results.length).toBeGreaterThan(0);
    const doc = await executeMemoryGet(cwd, { id: search.results[0].docid });

    expect("content" in doc).toBe(true);
    if ("content" in doc) {
      expect(doc.content).toContain("memory package backed by qmd");
    }
  });

  it("retrieves multiple documents", async () => {
    const cwd = makeRepo();
    const result = await executeMemoryMultiGet(cwd, {
      pattern: "**/*.md",
    });

    expect(result.docs.length).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it("reports memory status", async () => {
    const cwd = makeRepo();
    const status = await executeMemoryStatus(cwd);

    expect(status.enabled).toBe(true);
    expect(status.collections.some((collection) => collection.name === "sessions")).toBe(true);
    expect(status.totalDocuments).toBeGreaterThanOrEqual(2);
  });
});
