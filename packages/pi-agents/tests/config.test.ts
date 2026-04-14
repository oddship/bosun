import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../src/config.js";
import { createTempDir } from "./temp-dir";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir("pi-agents-test-");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns built-in defaults when no config file exists", () => {
    const config = loadConfig(tmpDir);
    expect(config.models).toEqual({
      lite: "openai-codex/gpt-5.4-mini",
      medium: "openai-codex/gpt-5.3-codex",
      high: "openai-codex/gpt-5.4",
      oracle: "openai-codex/gpt-5.4",
    });
    expect(config.defaultAgent).toBe("bosun");
    expect(config.agentPaths).toEqual([]);
    expect(config.backend.type).toBe("tmux");
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
          socket: ".home/tmux.sock", // ignored — kept for backward compat test
          command_prefix: "scripts/sandbox.sh",
        },
      }),
    );

    const config = loadConfig(tmpDir);
    expect(config.models).toEqual({
      lite: "haiku-123",
      medium: "openai-codex/gpt-5.3-codex",
      high: "opus-456",
      oracle: "openai-codex/gpt-5.4",
    });
    expect(config.defaultAgent).toBe("myagent");
    expect(config.agentPaths).toEqual(["extra/agents"]);
    expect(config.backend.type).toBe("tmux");
    // socket field is silently ignored (tmux concern, auto-detected from $TMUX)
    expect((config.backend as any).socket).toBeUndefined();
    expect(config.backend.command_prefix).toBe("scripts/sandbox.sh");
  });

  it("parses zmux backend selection with transport options", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "agents.json"),
      JSON.stringify({
        backend: {
          type: "zmux",
          binary: "zmux",
          state_dir: "state/zmux",
          transport: "tcp-tls",
          tcp_host: "127.0.0.1",
          tcp_port: 18888,
          tls_server_name: "zmux.local",
          command_prefix: "scripts/sandbox.sh",
        },
      }),
    );

    const config = loadConfig(tmpDir);
    expect(config.backend.type).toBe("zmux");
    if (config.backend.type !== "zmux") throw new Error("expected zmux backend");
    expect(config.backend.binary).toBe("zmux");
    expect(config.backend.state_dir).toBe("state/zmux");
    expect(config.backend.transport).toBe("tcp-tls");
    expect(config.backend.tcp_host).toBe("127.0.0.1");
    expect(config.backend.tcp_port).toBe(18888);
    expect(config.backend.tls_server_name).toBe("zmux.local");
    expect(config.backend.command_prefix).toBe("scripts/sandbox.sh");
  });

  it("fails closed on invalid explicit backend.type", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "agents.json"),
      JSON.stringify({
        backend: {
          type: "screen",
        },
      }),
    );

    expect(() => loadConfig(tmpDir)).toThrow("Invalid backend.type");
  });

  it("handles malformed JSON gracefully", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(path.join(piDir, "agents.json"), "not json{{{");

    const config = loadConfig(tmpDir);
    expect(config.models).toEqual({
      lite: "openai-codex/gpt-5.4-mini",
      medium: "openai-codex/gpt-5.3-codex",
      high: "openai-codex/gpt-5.4",
      oracle: "openai-codex/gpt-5.4",
    });
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
    expect(config.models).toEqual({
      lite: "fast-model",
      medium: "openai-codex/gpt-5.3-codex",
      high: "openai-codex/gpt-5.4",
      oracle: "openai-codex/gpt-5.4",
    });
    expect(config.defaultAgent).toBe("bosun");
    expect(config.agentPaths).toEqual([]);
    expect(config.backend.type).toBe("tmux");
  });
});
