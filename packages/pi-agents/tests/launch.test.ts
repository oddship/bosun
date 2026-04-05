import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildLaunchSpec } from "../src/launch.js";

describe("buildLaunchSpec", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-launch-spec-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "agents"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves the default agent via agents.json and maps its model tier", () => {
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents.json"), JSON.stringify({
      defaultAgent: "captain",
      models: { high: "openai-codex/gpt-5.4" },
      agentPaths: [],
      backend: { type: "tmux" },
    }));
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents", "captain.md"), `---\nmodel: high\nthinking: medium\n---\nCaptain`);

    const spec = buildLaunchSpec(tmpDir);
    expect(spec.agentName).toBe("captain");
    expect(spec.model).toBe("openai-codex/gpt-5.4");
    expect(spec.thinking).toBe("medium");
    expect(spec.agentFile).toContain(path.join(".pi", "agents", "captain.md"));
  });

  it("allows overriding the agent name for child launches", () => {
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents.json"), JSON.stringify({
      defaultAgent: "captain",
      models: { lite: "openai-codex/gpt-5.4-mini" },
      agentPaths: [],
      backend: { type: "tmux" },
    }));
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents", "captain.md"), `---\nmodel: lite\n---\nCaptain`);
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents", "scout.md"), `---\nmodel: openai-codex/gpt-5.3-codex\n---\nScout`);

    const spec = buildLaunchSpec(tmpDir, { agentName: "scout" });
    expect(spec.agentName).toBe("scout");
    expect(spec.model).toBe("openai-codex/gpt-5.3-codex");
  });

  it("falls back to package-provided agents when no .pi/agents.json is present", () => {
    fs.mkdirSync(path.join(tmpDir, "packages", "pi-bosun", "agents"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "packages", "pi-bosun", "agents", "bosun.md"), `---\nmodel: lite\nthinking: high\n---\nBosun`);

    const spec = buildLaunchSpec(tmpDir);
    expect(spec.agentName).toBe("bosun");
    expect(spec.model).toBe("openai-codex/gpt-5.4-mini");
    expect(spec.thinking).toBe("high");
    expect(spec.agentFile).toContain(path.join("packages", "pi-bosun", "agents", "bosun.md"));
  });

  it("throws when the requested agent does not exist", () => {
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents.json"), JSON.stringify({
      defaultAgent: "missing",
      models: {},
      agentPaths: [],
      backend: { type: "tmux" },
    }));

    expect(() => buildLaunchSpec(tmpDir)).toThrow("Agent 'missing' not found");
  });
});
