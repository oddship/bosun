import { describe, it, expect } from "bun:test";
import { resolveModel } from "../src/models.js";

const models: Record<string, string> = {
  lite: "claude-haiku-4-5",
  medium: "claude-sonnet-4",
  high: "claude-opus-4",
  cheap: "gemini-flash",
};

describe("resolveModel", () => {
  it("returns fallback when no tier and no default", () => {
    expect(resolveModel(undefined, {})).toBe("claude-haiku-4-5");
  });

  it("returns fallback when unknown tier and no default", () => {
    expect(resolveModel("nonexistent", {})).toBe("claude-haiku-4-5");
  });

  it("resolves tier names from models map", () => {
    expect(resolveModel("lite", models)).toBe("claude-haiku-4-5");
    expect(resolveModel("medium", models)).toBe("claude-sonnet-4");
    expect(resolveModel("cheap", models)).toBe("gemini-flash");
  });

  it("passes through model IDs with hyphens", () => {
    expect(resolveModel("claude-haiku-4-5", models)).toBe("claude-haiku-4-5");
    expect(resolveModel("gpt-4o-mini", models)).toBe("gpt-4o-mini");
  });

  it("passes through model IDs with slashes", () => {
    expect(resolveModel("ollama/llama3", models)).toBe("ollama/llama3");
    expect(resolveModel("openai/gpt-4", models)).toBe("openai/gpt-4");
  });

  it("uses defaultModel when tier is undefined", () => {
    // defaultModel is a tier name that resolves via the map
    expect(resolveModel(undefined, models, "cheap")).toBe("gemini-flash");
  });

  it("uses defaultModel when tier is unknown", () => {
    expect(resolveModel("nonexistent", models, "medium")).toBe("claude-sonnet-4");
  });

  it("uses defaultModel as literal if it looks like a model ID", () => {
    expect(resolveModel(undefined, {}, "gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("falls back to hardcoded default when defaultModel tier also not found", () => {
    expect(resolveModel(undefined, {}, "missing-tier")).toBe("missing-tier");
  });
});
