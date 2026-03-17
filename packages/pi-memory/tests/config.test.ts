import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMemoryConfig } from "../src/config.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-memory-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadMemoryConfig", () => {
  it("returns defaults when .pi/pi-memory.json is missing", () => {
    const cwd = makeTempDir();
    const config = loadMemoryConfig(cwd);

    expect(config.enabled).toBe(true);
    expect(config.defaultMode).toBe("keyword");
    expect(config.collections.sessions.path).toBe("workspace/users");
    expect(config.resolvedDbPath).toBe(join(cwd, ".bosun-home", ".cache", "qmd", "index.sqlite"));
    expect(config.qmdConfig.collections.docs.path).toBe(join(cwd, "docs"));
  });

  it("loads custom config and resolves relative paths", () => {
    const cwd = makeTempDir();
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "pi-memory.json"), JSON.stringify({
      enabled: true,
      dbPath: ".cache/custom-memory.sqlite",
      defaultMode: "hybrid",
      defaultLimit: 9,
      autoUpdateOnOpen: false,
      collections: {
        notes: {
          path: "notes",
          pattern: "**/*.md",
          includeByDefault: true,
        },
      },
    }, null, 2));

    const config = loadMemoryConfig(cwd);
    expect(config.defaultMode).toBe("hybrid");
    expect(config.defaultLimit).toBe(9);
    expect(config.autoUpdateOnOpen).toBe(false);
    expect(config.resolvedDbPath).toBe(join(cwd, ".cache", "custom-memory.sqlite"));
    expect(config.resolvedCollections.notes.path).toBe(join(cwd, "notes"));
    expect(config.qmdConfig.collections.notes.includeByDefault).toBe(true);
  });
});
