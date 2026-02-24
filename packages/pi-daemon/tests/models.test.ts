import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadModelConfig, resolveModel, getModelMap } from "../src/models.js";

describe("model tier resolution", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-daemon-models-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns default model when no config exists", () => {
    loadModelConfig(tmpDir);
    expect(resolveModel(undefined)).toBe("claude-haiku-4-5");
    expect(resolveModel("nonexistent")).toBe("claude-haiku-4-5");
  });

  it("resolves tier names from config.toml", () => {
    fs.writeFileSync(
      path.join(tmpDir, "config.toml"),
      `[models]
lite = "claude-haiku-4-5"
medium = "claude-sonnet-4"
cheap = "gemini-flash"
`,
    );

    loadModelConfig(tmpDir);
    expect(resolveModel("lite")).toBe("claude-haiku-4-5");
    expect(resolveModel("medium")).toBe("claude-sonnet-4");
    expect(resolveModel("cheap")).toBe("gemini-flash");
  });

  it("passes through model IDs with hyphens", () => {
    loadModelConfig(tmpDir);
    expect(resolveModel("claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(resolveModel("gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("passes through model IDs with slashes", () => {
    loadModelConfig(tmpDir);
    expect(resolveModel("ollama/llama3")).toBe("ollama/llama3");
    expect(resolveModel("openai/gpt-4")).toBe("openai/gpt-4");
  });

  it("returns model map", () => {
    fs.writeFileSync(
      path.join(tmpDir, "config.toml"),
      `[models]
lite = "haiku"
high = "opus"
`,
    );

    loadModelConfig(tmpDir);
    const map = getModelMap();
    expect(map.lite).toBe("haiku");
    expect(map.high).toBe("opus");
  });

  it("reads default_model from [daemon] section", () => {
    fs.writeFileSync(
      path.join(tmpDir, "config.toml"),
      `[models]
lite = "haiku"
fast = "flash"

[daemon]
default_model = "fast"
`,
    );

    loadModelConfig(tmpDir);
    // undefined resolves to default_model -> "fast" tier -> "flash"
    expect(resolveModel(undefined)).toBe("flash");
  });
});
