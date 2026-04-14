import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const validatorPath = join(import.meta.dir, "validate-output.ts");
const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "catchup-output-validator-"));
  tempRoots.push(root);
  return root;
}

function writeSummary(root: string, relativePath: string, title = "Valid summary") {
  const fullPath = join(root, "workspace", "users", "tester", "sessions", relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(
    fullPath,
    `---
title: "${title}"
session_file: 2026-03-30T07-16-33-237Z_example.jsonl
date: 2026-03-30
time: "07:16"
message_count: 10
user_message_count: 5
tags: [automation]
files_touched:
  - packages/example.ts
---

# Session: ${title}
`,
  );
}

function writeIndex(root: string, relativePath: string, content: string) {
  const fullPath = join(root, "workspace", "users", "tester", "sessions", relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content);
}

function runValidator(root: string, agentExitCode = "0") {
  return Bun.spawnSync(["bun", validatorPath], {
    cwd: root,
    env: {
      ...process.env,
      BOSUN_ROOT: root,
      USER: "tester",
      AGENT_EXIT_CODE: agentExitCode,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("catchup-sessions validate-output", () => {
  it("passes for well-formed summaries and index links", () => {
    const root = createTempRoot();
    writeSummary(root, "2026-03/2026-03-30-valid-summary.md");
    writeIndex(
      root,
      "2026-03/_index.md",
      "| Date | Session | Tags |\n|------|---------|------|\n| 2026-03-30 | [Valid summary](./2026-03-30-valid-summary.md) | `automation` |\n",
    );

    const result = runValidator(root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("validated");
  });

  it("fails when a session summary lives at sessions root", () => {
    const root = createTempRoot();
    writeSummary(root, "-.md");

    const result = runValidator(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("must not live at sessions root");
  });

  it("fails when a session summary filename has an empty slug", () => {
    const root = createTempRoot();
    writeSummary(root, "2026-03-28/2026-03-28-.md");

    const result = runValidator(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("empty slug");
  });

  it("fails when an index link contains unsafe characters", () => {
    const root = createTempRoot();
    writeSummary(root, "2026-03/2026-03-30-valid-summary.md");
    writeIndex(
      root,
      "2026-03/_index.md",
      "| Date | Session | Tags |\n|------|---------|------|\n| 2026-03-30 | [Broken](./2026-03-30-bad\nname.md) | `automation` |\n",
    );

    const result = runValidator(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("index link contains unsafe characters");
  });

  it("fails when the agent exits non-zero", () => {
    const root = createTempRoot();
    writeSummary(root, "2026-03/2026-03-30-valid-summary.md");

    const result = runValidator(root, "7");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("exited with code 7");
  });
});
