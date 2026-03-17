import { createMemoryFixtureRoot, runInFixture, runInit } from "./memory-harness";

interface CheckResult {
  name: string;
  details: string;
}

async function run(): Promise<void> {
  const fixture = createMemoryFixtureRoot("bosun-memory-cli-e2e");
  const results: CheckResult[] = [];

  try {
    await runInit(fixture.root, fixture.home);

    const status = JSON.parse(await runInFixture(fixture.root, fixture.home, "bun scripts/memory.ts status")) as Record<string, unknown>;
    if ((status.enabled as boolean | undefined) !== true) {
      throw new Error("memory status should report enabled=true");
    }
    if (typeof status.totalDocuments !== "number" || Number(status.totalDocuments) < 2) {
      throw new Error(`expected at least 2 indexed docs, got ${String(status.totalDocuments)}`);
    }
    results.push({
      name: "memory status indexes fixture content",
      details: `totalDocuments=${String(status.totalDocuments)}`,
    });

    // This query should match the seeded plan and architecture fixture docs.
    const search = JSON.parse(await runInFixture(fixture.root, fixture.home, "bun scripts/memory.ts search 'memory qmd'")) as {
      results: Array<{ docid: string; title: string; file: string }>;
    };
    if (!Array.isArray(search.results) || search.results.length === 0) {
      throw new Error("memory search returned no results");
    }
    const first = search.results[0];
    results.push({
      name: "memory search returns ranked results",
      details: `${first.docid} ${first.title} ${first.file}`,
    });

    const single = JSON.parse(await runInFixture(fixture.root, fixture.home, `bun scripts/memory.ts get '${first.docid}'`)) as Record<string, unknown>;
    if (typeof single.content !== "string" || !String(single.content).includes("memory")) {
      throw new Error("memory get did not return document content");
    }
    results.push({
      name: "memory get retrieves full document",
      details: `${String(single.docid)} ${String(single.title)}`,
    });

    const multi = JSON.parse(await runInFixture(fixture.root, fixture.home, "bun scripts/memory.ts multi-get '**/*.md'")) as {
      docs: Array<{ file: string }>;
      errors: string[];
    };
    if (!Array.isArray(multi.docs) || multi.docs.length < 4) {
      throw new Error(`expected multi-get to return at least 4 docs, got ${multi.docs?.length ?? 0}`);
    }
    if (multi.errors.length > 0) {
      throw new Error(`multi-get returned errors: ${multi.errors.join(", ")}`);
    }
    results.push({
      name: "memory multi-get returns multiple documents",
      details: `${multi.docs.length} docs`,
    });

    const justStatus = JSON.parse(await runInFixture(fixture.root, fixture.home, "just --justfile justfile memory-status")) as Record<string, unknown>;
    if ((justStatus.enabled as boolean | undefined) !== true) {
      throw new Error("just memory-status should return enabled=true");
    }
    results.push({
      name: "just memory-status works end-to-end",
      details: `defaultMode=${String(justStatus.defaultMode)}`,
    });

    console.log("E2E memory CLI flow checks passed:\n");
    for (const result of results) {
      console.log(`- ${result.name}: ${result.details}`);
    }
  } finally {
    fixture.cleanup();
  }
}

await run();
