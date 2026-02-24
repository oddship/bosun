import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig } from "../extensions/config.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agents-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(tmpDir);
    expect(config.models).toEqual({});
    expect(config.defaultAgent).toBe("bosun");
    expect(config.agentPaths).toEqual([]);
    expect(config.backend.type).toBe("tmux");
    expect(config.backend.socket).toBeUndefined();
    expect(config.backend.command_prefix).toBeUndefined();
  });

  it("loads config from .pi/agents.json", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "agents.json"),
      JSON.stringify({
        models: { lite: "haiku-123", high: "opus-456" },
        defaultAgent: "myagent",
        agentPaths: ["extra/agents"],
        backend: {
          type: "tmux",
          socket: ".home/tmux.sock",
          command_prefix: "scripts/sandbox.sh",
        },
      }),
    );

    const config = loadConfig(tmpDir);
    expect(config.models).toEqual({ lite: "haiku-123", high: "opus-456" });
    expect(config.defaultAgent).toBe("myagent");
    expect(config.agentPaths).toEqual(["extra/agents"]);
    expect(config.backend.type).toBe("tmux");
    expect(config.backend.socket).toBe(".home/tmux.sock");
    expect(config.backend.command_prefix).toBe("scripts/sandbox.sh");
  });

  it("handles malformed JSON gracefully", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(path.join(piDir, "agents.json"), "not json{{{");

    const config = loadConfig(tmpDir);
    expect(config.models).toEqual({});
    expect(config.defaultAgent).toBe("bosun");
  });

  it("handles partial config with defaults for missing fields", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "agents.json"),
      JSON.stringify({ models: { lite: "fast-model" } }),
    );

    const config = loadConfig(tmpDir);
    expect(config.models).toEqual({ lite: "fast-model" });
    expect(config.defaultAgent).toBe("bosun");
    expect(config.agentPaths).toEqual([]);
    expect(config.backend.type).toBe("tmux");
  });
});
