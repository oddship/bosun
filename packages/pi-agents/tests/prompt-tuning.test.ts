import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolvePromptTuningProvider,
  resolveProviderPromptTuning,
} from "../src/prompt-tuning.js";
import { createTempDir } from "./temp-dir";

describe("prompt tuning", () => {
  let tmpDir: string;
  let packageRoot: string;

  beforeEach(() => {
    tmpDir = createTempDir("pi-prompt-tuning-test-");
    packageRoot = path.join(tmpDir, "pkg");
    fs.mkdirSync(path.join(packageRoot, "prompt-tuning", "providers"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves provider from ctx.model when available", () => {
    expect(resolvePromptTuningProvider({ provider: "openai-codex" }, "anthropic/claude-sonnet-4-5"))
      .toBe("openai-codex");
  });

  it("falls back to resolved provider-qualified model id", () => {
    expect(resolvePromptTuningProvider(undefined, "openai-codex/gpt-5.4")).toBe("openai-codex");
  });

  it("returns empty when no provider tuning exists", () => {
    expect(resolveProviderPromptTuning({ cwd: tmpDir, provider: "missing", packageRoot })).toBe("");
  });

  it("loads package default provider tuning", () => {
    fs.writeFileSync(
      path.join(packageRoot, "prompt-tuning", "providers", "openai-codex.md"),
      "Package tuning.",
    );

    const result = resolveProviderPromptTuning({
      cwd: tmpDir,
      provider: "openai-codex",
      packageRoot,
    });

    expect(result).toBe("Package tuning.");
  });

  it("prefers project override over package default", () => {
    fs.writeFileSync(
      path.join(packageRoot, "prompt-tuning", "providers", "openai-codex.md"),
      "Package tuning.",
    );

    const overrideDir = path.join(tmpDir, ".pi", "prompt-tuning", "providers");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(path.join(overrideDir, "openai-codex.md"), "Project tuning.");

    const result = resolveProviderPromptTuning({
      cwd: tmpDir,
      provider: "openai-codex",
      packageRoot,
    });

    expect(result).toBe("Project tuning.");
  });
});
