import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStartSessionName } from "./cli.ts";

describe("getStartSessionName", () => {
  it("uses the configured default agent name for downstream projects", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bosun-cli-test-"));

    try {
      mkdirSync(join(projectDir, ".pi", "agents"), { recursive: true });
      mkdirSync(join(projectDir, "workspace"), { recursive: true });

      writeFileSync(
        join(projectDir, ".pi", "agents.json"),
        JSON.stringify({
          models: {
            high: "openai-codex/gpt-5.4",
          },
          defaultAgent: "zero",
          agentPaths: ["./.pi/agents"],
          backend: {
            type: "tmux",
          },
        }, null, 2) + "\n",
      );

      writeFileSync(
        join(projectDir, ".pi", "agents", "zero.md"),
        [
          "---",
          'name: zero',
          'model: high',
          'thinking: medium',
          "---",
          "Zero",
        ].join("\n"),
      );

      expect(getStartSessionName(projectDir)).toBe("zero");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
