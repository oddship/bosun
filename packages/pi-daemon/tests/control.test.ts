import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initControl, startControl, stopControl } from "../src/control.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe("control reload", () => {
  let stateDir: string;
  let logFile: string;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "pi-daemon-control-"));
    logFile = join(stateDir, "daemon.log");
    mkdirSync(join(stateDir, "control"), { recursive: true });
    mkdirSync(join(stateDir, "responses"), { recursive: true });
    writeFileSync(logFile, "");
    initControl(
      stateDir,
      logFile,
      () => ({
        running: true,
        pid: 123,
        started_at: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
        watchers: [],
        stats: { handlers_run: 0, errors: 0 },
      }),
      async () => ({ success: true, message: "reloaded", workflows: 3, watchers: 1, rules: 2 }),
    );
    startControl();
    await sleep(50);
  });

  afterEach(() => {
    stopControl();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("delegates reload commands to the injected reload handler", async () => {
    const id = `reload-${Date.now()}`;
    const commandPath = join(stateDir, "control", `${id}.json`);
    const responsePath = join(stateDir, "responses", `${id}.json`);

    writeFileSync(commandPath, JSON.stringify({ action: "reload" }));
    await waitForFile(responsePath);

    const response = JSON.parse(readFileSync(responsePath, "utf-8")) as Record<string, unknown>;
    expect(response.success).toBe(true);
    expect(response.message).toBe("reloaded");
    expect(response.workflows).toBe(3);
    expect(response.watchers).toBe(1);
    expect(response.rules).toBe(2);
  });
});
