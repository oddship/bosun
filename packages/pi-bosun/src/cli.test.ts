import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStartSessionName } from "./cli.ts";
import { createTempDir } from "./test-temp-dir";

describe("getStartSessionName", () => {
  it("uses the configured default agent name for downstream projects", () => {
    const projectDir = createTempDir("bosun-cli-test-");

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

  it("still resolves default agent when backend is zmux", () => {
    const projectDir = createTempDir("bosun-cli-test-");

    try {
      mkdirSync(join(projectDir, ".pi", "agents"), { recursive: true });
      mkdirSync(join(projectDir, "workspace"), { recursive: true });

      writeFileSync(
        join(projectDir, ".pi", "agents.json"),
        JSON.stringify({
          defaultAgent: "zero",
          backend: {
            type: "zmux",
            state_dir: "state/zmux",
          },
        }, null, 2) + "\n",
      );

      writeFileSync(
        join(projectDir, ".pi", "agents", "zero.md"),
        [
          "---",
          "name: zero",
          "model: high",
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
