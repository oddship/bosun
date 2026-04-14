import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessBackend, SpawnDetachedOptions, SpawnDetachedResult } from "../src/backend";
import { spawnAgent } from "../src/spawn";
import { createTempDir } from "./temp-dir";

function writeAgentFixture(dir: string): void {
  mkdirSync(join(dir, ".pi", "agents"), { recursive: true });

  writeFileSync(
    join(dir, ".pi", "agents.json"),
    JSON.stringify({
      defaultAgent: "worker",
      models: {
        lite: "openai-codex/gpt-5.4-mini",
      },
      backend: {
        type: "tmux",
      },
    }, null, 2),
  );

  writeFileSync(
    join(dir, ".pi", "agents", "worker.md"),
    [
      "---",
      "name: worker",
      "model: lite",
      "extensions: []",
      "---",
      "Worker",
      "",
    ].join("\n"),
  );
}

function createBackendStub(overrides: Partial<ProcessBackend> = {}): ProcessBackend {
  return {
    type: "tmux",
    capabilities: {
      detachedSpawn: true,
      list: true,
      exists: true,
      attach: true,
      sendText: true,
      sendKey: true,
      multilineSafeSendText: "buffer",
      captureTail: true,
      kill: true,
      identity: true,
      metadata: true,
      awaitReady: true,
      reconnectSemantics: "name_scoped",
    },
    policy: {
      defaultTimeoutMs: 1000,
      retry: { attempts: 1, backoffMs: 0, retryableCodes: [] },
    },
    isInteractiveContext: () => true,
    currentSessionName: () => "bosun",
    list: async () => ({ sessions: [], windows: [], panes: [] }),
    listSessionNames: async () => [],
    hasSession: async () => false,
    hasWindow: async () => false,
    spawnDetached: async () => ({
      sessionName: "bosun",
      windowName: "worker",
      target: "bosun:worker",
    }),
    startServer: async () => {},
    attachSession: async () => ({ stdout: "", stderr: "", code: 0 }),
    sendText: async () => {},
    sendKey: async () => {},
    captureTail: async () => ({ text: "" }),
    killTarget: async () => {},
    killSession: async () => {},
    killServer: async () => {},
    sessionPids: async () => [],
    awaitReady: async () => {},
    readIdentity: async () => null,
    renameIdentity: async () => {},
    readMetadata: async () => null,
    writeMetadata: async () => {},
    resolvePaneTargetForSession: async () => null,
    ...overrides,
  };
}

describe("spawnAgent backend contract integration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("spawns using tmux backend contract and forwards backend metadata/env", async () => {
    const tempDir = createTempDir("spawn-agent-test-");
    tempDirs.push(tempDir);
    writeAgentFixture(tempDir);

    const spawned: SpawnDetachedOptions[] = [];
    const metadataWrites: Array<{ key: string; value: string }> = [];

    const backend = createBackendStub({
      type: "tmux",
      currentSessionName: () => "parent-session",
      spawnDetached: async (options) => {
        spawned.push(options);
        return {
          sessionName: options.sessionName,
          windowName: options.windowName,
          target: `${options.sessionName}:${options.windowName}`,
          paneId: "%42",
        } satisfies SpawnDetachedResult;
      },
      writeMetadata: async (key, value) => {
        metadataWrites.push({ key, value });
      },
    });

    const result = await spawnAgent({
      agent: "worker",
      cwd: tempDir,
      backendContract: backend,
    });

    expect(result.success).toBe(true);
    expect(result.sessionName).toBe("parent-session");
    expect(spawned).toHaveLength(1);
    expect(spawned[0].createSession).toBe(false);
    expect(spawned[0].env?.PI_RUNTIME_BACKEND).toBe("tmux");
    expect(spawned[0].env?.PI_BACKEND_SESSION).toBe("parent-session");
    expect(spawned[0].env?.PI_BACKEND_TARGET).toBe("worker");
    expect(metadataWrites).toContainEqual({
      key: "bosun.identity.worker.target",
      value: "%42",
    });
  });

  test("spawns using zmux backend contract with explicit session mode", async () => {
    const tempDir = createTempDir("spawn-agent-test-");
    tempDirs.push(tempDir);
    writeAgentFixture(tempDir);

    const spawned: SpawnDetachedOptions[] = [];
    const metadataWrites: Array<{ key: string; value: string }> = [];
    const backend = createBackendStub({
      type: "zmux",
      currentSessionName: () => null,
      spawnDetached: async (options) => {
        spawned.push(options);
        return {
          sessionName: options.sessionName,
          windowName: options.windowName,
          target: "pane_7",
          paneId: "pane_7",
        } satisfies SpawnDetachedResult;
      },
      writeMetadata: async (key, value) => {
        metadataWrites.push({ key, value });
      },
    });

    const result = await spawnAgent({
      agent: "worker",
      name: "helpers",
      session: true,
      cwd: tempDir,
      backendContract: backend,
    });

    expect(result.success).toBe(true);
    expect(result.sessionName).toBe("helpers");
    expect(spawned).toHaveLength(1);
    expect(spawned[0].createSession).toBe(true);
    expect(spawned[0].sessionName).toBe("helpers");
    expect(spawned[0].windowName).toBe("helpers");
    expect(spawned[0].env?.PI_RUNTIME_BACKEND).toBe("zmux");
    expect(spawned[0].env?.PI_BACKEND_SESSION).toBe("helpers");
    expect(spawned[0].env?.PI_BACKEND_TARGET).toBe("helpers");
    expect(metadataWrites).toContainEqual({
      key: "bosun.identity.helpers.target",
      value: "pane_7",
    });
  });
});
