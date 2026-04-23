import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const WORKTREE_ROOT = join(import.meta.dir, "..");
const INIT_SCRIPT = join(import.meta.dir, "init.ts");
const BOSUN_AGENT_DIR = join(WORKTREE_ROOT, "packages", "pi-bosun", "agents");

describe("scripts/init.ts", () => {
  it("infers provider/model/thinking defaults from an absolute agent path with unqualified model tiers", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bosun-init-test-"));

    try {
      writeFileSync(
        join(projectDir, "package.json"),
        JSON.stringify({
          name: "bosun-init-test",
          version: "0.0.0",
          dependencies: {},
        }, null, 2) + "\n",
      );

      writeFileSync(
        join(projectDir, "config.toml"),
        [
          "[models]",
          'lite = "gpt-5.4-mini"',
          'medium = "gpt-5.3-codex"',
          'high = "gpt-5.4"',
          'oracle = "gpt-5.4"',
          "",
          "[workspace]",
          'path = "workspace"',
          "",
          "[agents]",
          'default_agent = "bosun"',
          `extra_paths = ["${BOSUN_AGENT_DIR}"]`,
          "",
          "[backend]",
          'type = "tmux"',
          'command_prefix = "node_modules/bosun/scripts/sandbox.sh"',
          "",
          "[daemon]",
          "enabled = false",
          "",
          "[mesh]",
          "auto_register = false",
          "",
          "[memory]",
          "enabled = false",
          "",
        ].join("\n"),
      );

      mkdirSync(join(projectDir, "workspace"), { recursive: true });

      execFileSync("bun", [INIT_SCRIPT], {
        cwd: projectDir,
        env: {
          ...process.env,
          BOSUN_PKG: WORKTREE_ROOT,
          USER: process.env.USER || "rhnvrm",
        },
        stdio: "pipe",
      });

      const settings = JSON.parse(readFileSync(join(projectDir, ".pi", "settings.json"), "utf-8"));
      expect(settings.defaultProvider).toBe("openai-codex");
      expect(settings.defaultModel).toBe("gpt-5.4");
      expect(settings.defaultThinkingLevel).toBe("xhigh");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid memory config when hybrid is disabled but default mode is hybrid", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bosun-init-test-"));

    try {
      writeFileSync(
        join(projectDir, "package.json"),
        JSON.stringify({
          name: "bosun-init-test",
          version: "0.0.0",
          dependencies: {},
        }, null, 2) + "\n",
      );

      writeFileSync(
        join(projectDir, "config.toml"),
        [
          "[models]",
          'lite = "gpt-5.4-mini"',
          'medium = "gpt-5.3-codex"',
          'high = "gpt-5.4"',
          'oracle = "gpt-5.4"',
          "",
          "[workspace]",
          'path = "workspace"',
          "",
          "[agents]",
          'default_agent = "bosun"',
          `extra_paths = ["${BOSUN_AGENT_DIR}"]`,
          "",
          "[backend]",
          'type = "tmux"',
          'command_prefix = "node_modules/bosun/scripts/sandbox.sh"',
          "",
          "[daemon]",
          "enabled = false",
          "",
          "[mesh]",
          "auto_register = false",
          "",
          "[memory]",
          "enabled = true",
          "allow_hybrid_search = false",
          'default_mode = "hybrid"',
          "",
        ].join("\n"),
      );

      mkdirSync(join(projectDir, "workspace"), { recursive: true });

      expect(() => execFileSync("bun", [INIT_SCRIPT], {
        cwd: projectDir,
        env: {
          ...process.env,
          BOSUN_PKG: WORKTREE_ROOT,
          USER: process.env.USER || "rhnvrm",
        },
        stdio: "pipe",
      })).toThrow("Invalid memory config: default_mode='hybrid' requires allow_hybrid_search=true. Set default_mode='keyword' or enable memory.allow_hybrid_search.");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
