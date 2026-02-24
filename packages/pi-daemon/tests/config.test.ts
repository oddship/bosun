import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadDaemonConfig } from "../src/config.js";

describe("loadDaemonConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-daemon-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadDaemonConfig(tmpDir);
    expect(config.enabled).toBe(false);
    expect(config.handlers_dir).toBe("scripts/daemon/handlers");
    expect(config.heartbeat_interval_seconds).toBe(60);
    expect(config.state_dir).toBe(".bosun-daemon");
    expect(config.log_level).toBe("info");
    expect(config.watchers).toEqual([]);
    expect(config.rules).toEqual([]);
  });

  it("loads full config from .pi/daemon.json", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "daemon.json"),
      JSON.stringify({
        enabled: true,
        handlers_dir: "my/handlers",
        heartbeat_interval_seconds: 30,
        state_dir: ".my-daemon",
        log_level: "debug",
        watchers: [
          { name: "w1", pattern: "**/*.jsonl", debounce_ms: 3000 },
        ],
        rules: [
          { name: "r1", trigger: "w1", handler: "my-handler", stale_minutes: 2 },
          { name: "r2", schedule: "hourly", handler: "another-handler" },
        ],
      }),
    );

    const config = loadDaemonConfig(tmpDir);
    expect(config.enabled).toBe(true);
    expect(config.handlers_dir).toBe("my/handlers");
    expect(config.heartbeat_interval_seconds).toBe(30);
    expect(config.state_dir).toBe(".my-daemon");
    expect(config.log_level).toBe("debug");
    expect(config.watchers).toHaveLength(1);
    expect(config.watchers[0].name).toBe("w1");
    expect(config.watchers[0].debounce_ms).toBe(3000);
    expect(config.rules).toHaveLength(2);
    expect(config.rules[0].trigger).toBe("w1");
    expect(config.rules[0].stale_minutes).toBe(2);
    expect(config.rules[1].schedule).toBe("hourly");
  });

  it("handles malformed JSON gracefully", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(path.join(piDir, "daemon.json"), "broken{{{");

    const config = loadDaemonConfig(tmpDir);
    expect(config.enabled).toBe(false);
    expect(config.watchers).toEqual([]);
  });

  it("filters invalid watchers and rules", () => {
    const piDir = path.join(tmpDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "daemon.json"),
      JSON.stringify({
        watchers: [
          { name: "valid", pattern: "*.txt" },
          { name: "no-pattern" },
          "not-an-object",
          null,
        ],
        rules: [
          { name: "valid", handler: "h1" },
          { name: "no-handler" },
          42,
        ],
      }),
    );

    const config = loadDaemonConfig(tmpDir);
    expect(config.watchers).toHaveLength(1);
    expect(config.watchers[0].name).toBe("valid");
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].name).toBe("valid");
  });
});
