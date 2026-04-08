import { join } from "node:path";
import { createMemoryFixtureRoot, readJson, runInit } from "./memory-harness";

interface CheckResult {
  name: string;
  details: string;
}

async function run(): Promise<void> {
  const fixture = createMemoryFixtureRoot("bosun-memory-init-e2e");
  const results: CheckResult[] = [];

  try {
    await runInit(fixture.root, fixture.home);

    const memory = await readJson<Record<string, unknown>>(fixture.root, ".pi/pi-memory.json");
    const settings = await readJson<{ packages: string[] }>(fixture.root, ".pi/settings.json");

    if (memory.enabled !== true) {
      throw new Error("expected memory to be enabled in generated .pi/pi-memory.json");
    }
    if (memory.defaultMode !== "keyword") {
      throw new Error(`expected defaultMode=keyword, got ${String(memory.defaultMode)}`);
    }
    if (memory.allowHybridSearch !== true) {
      throw new Error(`expected allowHybridSearch=true, got ${String(memory.allowHybridSearch)}`);
    }
    if (typeof memory.dbPath !== "string" || !String(memory.dbPath).includes(".bosun-home/.cache/qmd/index.sqlite")) {
      throw new Error(`unexpected dbPath: ${String(memory.dbPath)}`);
    }

    const collections = memory.collections as Record<string, Record<string, unknown>>;
    if (!collections.sessions || collections.sessions.includeByDefault !== true) {
      throw new Error("expected sessions collection with includeByDefault=true");
    }
    if ("include_by_default" in collections.sessions) {
      throw new Error("generated pi-memory.json should not contain include_by_default snake_case keys");
    }
    if ((collections.skills?.includeByDefault as boolean | undefined) !== false) {
      throw new Error("expected skills collection includeByDefault=false");
    }
    results.push({
      name: "init generates camelCase pi-memory config",
      details: JSON.stringify({
        dbPath: memory.dbPath,
        allowHybridSearch: memory.allowHybridSearch,
        sessions: collections.sessions,
      }),
    });

    if (!settings.packages.includes("../packages/pi-memory")) {
      throw new Error("settings.json did not include ../packages/pi-memory");
    }
    results.push({
      name: "settings.json includes pi-memory package",
      details: settings.packages.filter((pkg) => pkg.includes("pi-memory")).join(", "),
    });

    const generatedPath = join(fixture.root, ".pi", "pi-memory.json");
    results.push({
      name: "generated config path exists",
      details: generatedPath,
    });

    console.log("E2E memory init checks passed:\n");
    for (const result of results) {
      console.log(`- ${result.name}: ${result.details}`);
    }
  } finally {
    fixture.cleanup();
  }
}

await run();
