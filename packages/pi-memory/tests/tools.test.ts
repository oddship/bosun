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
import { getMemoryRuntime, resetMemoryRuntime } from "../src/store.js";

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
    allowHybridSearch: true,
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

async function seedIndex(cwd: string): Promise<void> {
  const runtime = await getMemoryRuntime(cwd);
  await runtime.store.update();
}

afterEach(async () => {
  await resetMemoryRuntime();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("pi-memory tools", () => {
  it("does not auto-index on search", async () => {
    const cwd = makeRepo();

    const before = await executeMemorySearch(cwd, {
      query: "memory qmd",
      mode: "keyword",
      collections: ["sessions", "docs"],
      limit: 5,
    });

    expect(before.results).toEqual([]);

    await seedIndex(cwd);

    const after = await executeMemorySearch(cwd, {
      query: "memory qmd",
      mode: "keyword",
      collections: ["sessions", "docs"],
      limit: 5,
    });

    expect(after.results.length).toBeGreaterThan(0);
    expect(after.results.some((item) => item.title.includes("Memory Plan") || item.file.includes("architecture"))).toBe(true);
  });

  it("retrieves a single document after explicit indexing", async () => {
    const cwd = makeRepo();
    await seedIndex(cwd);

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

  it("retrieves multiple documents after explicit indexing", async () => {
    const cwd = makeRepo();
    await seedIndex(cwd);

    const result = await executeMemoryMultiGet(cwd, {
      pattern: "**/*.md",
    });

    expect(result.docs.length).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it("rejects hybrid search when disabled by config", async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, ".pi", "pi-memory.json"), JSON.stringify({
      enabled: true,
      dbPath: ".cache/memory.sqlite",
      allowHybridSearch: false,
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

    await expect(executeMemorySearch(cwd, {
      query: "memory qmd",
      mode: "hybrid",
      limit: 5,
    })).rejects.toThrow(
      "Hybrid memory search is disabled by project config (memory.allow_hybrid_search=false). Available options: use mode='keyword', omit mode to use the default ('keyword'), or enable memory.allow_hybrid_search=true in config.toml.",
    );
  });

  it("reports status without auto-refreshing the index", async () => {
    const cwd = makeRepo();

    const before = await executeMemoryStatus(cwd);
    expect(before.enabled).toBe(true);
    expect(before.allowHybridSearch).toBe(true);
    expect(before.totalDocuments).toBe(0);

    await seedIndex(cwd);

    const after = await executeMemoryStatus(cwd);
    expect(after.collections.some((collection) => collection.name === "sessions")).toBe(true);
    expect(after.totalDocuments).toBeGreaterThanOrEqual(2);
  });
});
