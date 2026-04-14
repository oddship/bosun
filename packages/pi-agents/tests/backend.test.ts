import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  BackendError,
  commandWithEnvAndCwd,
  createBackendContract,
} from "../src/backend";
import { createTempDir } from "./temp-dir";

type FakeZmuxState = {
  sessions: Array<{ id: string; display_name: string }>;
  windows: Array<{ id: string; display_name: string; session_id: string }>;
  panes: Array<{ id: string; display_name: string; session_id: string; window_id: string }>;
  metadata: Record<string, string>;
  captureText: string;
  calls: Array<{ command: string; args: string[]; json: boolean }>;
};

const originalEnv = {
  PI_BACKEND_TARGET: process.env.PI_BACKEND_TARGET,
  PI_BACKEND_SESSION: process.env.PI_BACKEND_SESSION,
  PI_AGENT_NAME: process.env.PI_AGENT_NAME,
};

function fakeStateFilePath(stateDir: string): string {
  return join(stateDir, "fake-zmux-state.json");
}

function writeFakeZmuxBinary(tempDir: string, stateDir: string): string {
  const stateFile = fakeStateFilePath(stateDir);
  const scriptPath = join(tempDir, "fake-zmux.mjs");
  const script = [
    "#!/usr/bin/env bun",
    "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "",
    "const globalArgsWithValue = new Set([",
    "  '--socket-path', '--transport',",
    "  '--ssh-host', '--ssh-user', '--ssh-port', '--ssh-command', '--ssh-bootstrap-timeout-ms',",
    "  '--tcp-host', '--tcp-port', '--tls-server-name', '--tls-ca-cert', '--tls-client-cert', '--tls-client-key', '--tls-transport-version',",
    "]);",
    "",
    "const rawArgs = process.argv.slice(2);",
    "let json = false;",
    "let stateDir = '';",
    "const args = [];",
    "for (let i = 0; i < rawArgs.length; i += 1) {",
    "  const arg = rawArgs[i];",
    "  if (arg === '--json') { json = true; continue; }",
    "  if (arg === '--state-dir') { stateDir = rawArgs[i + 1] || ''; i += 1; continue; }",
    "  if (globalArgsWithValue.has(arg)) { i += 1; continue; }",
    "  args.push(arg);",
    "}",
    "",
    "if (!stateDir) {",
    "  console.error('missing --state-dir');",
    "  process.exit(2);",
    "}",
    "",
    "const stateFile = stateDir.endsWith('/') ? stateDir + 'fake-zmux-state.json' : stateDir + '/fake-zmux-state.json';",
    "",
    "function loadState() {",
    "  if (!existsSync(stateFile)) {",
    "    return { sessions: [], windows: [], panes: [], metadata: {}, captureText: '', calls: [] };",
    "  }",
    "  return JSON.parse(readFileSync(stateFile, 'utf-8'));",
    "}",
    "",
    "function saveState(state) {",
    "  writeFileSync(stateFile, JSON.stringify(state, null, 2));",
    "}",
    "",
    "function ok(result) {",
    "  console.log(JSON.stringify({ ok: true, result }));",
    "  process.exit(0);",
    "}",
    "",
    "function fail(code, message, exitCode = 1) {",
    "  console.log(JSON.stringify({ ok: false, error: { code, message } }));",
    "  process.exit(exitCode);",
    "}",
    "",
    "const command = args[0] || '';",
    "const commandArgs = args.slice(1);",
    "const state = loadState();",
    "state.calls.push({ command, args: commandArgs, json });",
    "",
    "const findEntity = (collection, target) => collection.find((entity) => entity.id === target || entity.display_name === target);",
    "",
    "if (command === 'list') {",
    "  saveState(state);",
    "  ok({ sessions: state.sessions, windows: state.windows, panes: state.panes });",
    "}",
    "",
    "if (command === 'exists') {",
    "  const target = commandArgs[0];",
    "  const session = findEntity(state.sessions, target);",
    "  saveState(state);",
    "  ok({ exists: Boolean(session), resolved_kind: session ? 'session' : 'unknown' });",
    "}",
    "",
    "if (command === 'attach') {",
    "  saveState(state);",
    "  process.stdout.write('attached:' + (commandArgs[0] || ''));",
    "  process.exit(0);",
    "}",
    "",
    "if (command === 'send-text' || command === 'send-key' || command === 'kill' || command === 'await-ready') {",
    "  saveState(state);",
    "  ok({});",
    "}",
    "",
    "if (command === 'capture-tail') {",
    "  saveState(state);",
    "  ok({ text: state.captureText || '', cursor: 1, revision: state.calls.length });",
    "}",
    "",
    "if (command === 'rename') {",
    "  const target = commandArgs[0];",
    "  const newName = commandArgs[1];",
    "  const kindFlagIndex = commandArgs.indexOf('--kind');",
    "  const kind = kindFlagIndex >= 0 ? commandArgs[kindFlagIndex + 1] : 'pane';",
    "",
    "  const collection = kind === 'session'",
    "    ? state.sessions",
    "    : kind === 'window'",
    "      ? state.windows",
    "      : state.panes;",
    "",
    "  const entity = findEntity(collection, target);",
    "  if (!entity) {",
    "    saveState(state);",
    "    fail('ERR_TARGET_NOT_FOUND', 'target not found', 3);",
    "  }",
    "",
    "  entity.display_name = newName;",
    "  saveState(state);",
    "  ok({});",
    "}",
    "",
    "if (command === 'read-metadata') {",
    "  const key = commandArgs[0];",
    "  saveState(state);",
    "  ok({ value: Object.prototype.hasOwnProperty.call(state.metadata, key) ? state.metadata[key] : null });",
    "}",
    "",
    "if (command === 'write-metadata') {",
    "  const key = commandArgs[0];",
    "  const value = commandArgs[1] || '';",
    "  state.metadata[key] = value;",
    "  saveState(state);",
    "  ok({});",
    "}",
    "",
    "saveState(state);",
    "fail('ERR_USAGE', 'unsupported command: ' + command, 1);",
  ].join("\n");

  writeFileSync(scriptPath, script, "utf-8");
  chmodSync(scriptPath, 0o755);

  writeFileSync(stateFile, JSON.stringify({
    sessions: [{ id: "session_1", display_name: "deckhand-zmux-session" }],
    windows: [{ id: "window_1", display_name: "deckhand-zmux-old", session_id: "session_1" }],
    panes: [{ id: "pane_1", display_name: "deckhand-zmux-old", session_id: "session_1", window_id: "window_1" }],
    metadata: {
      "bosun.identity.deckhand-zmux-old.target": "pane_1",
    },
    captureText: "capture:tail",
    calls: [],
  } satisfies FakeZmuxState, null, 2));

  return scriptPath;
}

function readFakeState(stateFile: string): FakeZmuxState {
  return JSON.parse(readFileSync(stateFile, "utf-8")) as FakeZmuxState;
}

describe("backend contract", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    process.env.PI_BACKEND_TARGET = originalEnv.PI_BACKEND_TARGET;
    process.env.PI_BACKEND_SESSION = originalEnv.PI_BACKEND_SESSION;
    process.env.PI_AGENT_NAME = originalEnv.PI_AGENT_NAME;

    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates tmux backend by default and exposes required capability flags", () => {
    const backend = createBackendContract({
      cwd: process.cwd(),
      backend: { type: "tmux" },
    });

    expect(backend.type).toBe("tmux");
    expect(backend.capabilities.detachedSpawn).toBe(true);
    expect(backend.capabilities.awaitReady).toBe(true);
    expect(backend.capabilities.identity).toBe(true);
    expect(backend.capabilities.metadata).toBe(true);
  });

  test("fails closed for zmux backend when discovery config is missing", () => {
    expect(() => createBackendContract({
      cwd: process.cwd(),
      backend: { type: "zmux" },
    })).toThrow(BackendError);

    try {
      createBackendContract({ cwd: process.cwd(), backend: { type: "zmux" } });
    } catch (error) {
      const backendError = error as BackendError;
      expect(backendError.code).toBe("backend_invalid_config");
      expect(backendError.message).toContain("requires backend.state_dir or backend.socket_path");
    }
  });

  test("creates zmux backend when fail-closed discovery config is present", () => {
    const tempDir = createTempDir("zmux-backend-contract-");
    tempDirs.push(tempDir);
    const stateDir = join(tempDir, "state");
    mkdirSync(stateDir, { recursive: true });

    const backend = createBackendContract({
      cwd: tempDir,
      backend: {
        type: "zmux",
        binary: "zmux",
        state_dir: stateDir,
      },
    });

    expect(backend.type).toBe("zmux");
    expect(backend.capabilities.detachedSpawn).toBe(true);
    expect(backend.capabilities.list).toBe(true);
    expect(backend.capabilities.exists).toBe(true);
    expect(backend.capabilities.sendText).toBe(true);
    expect(backend.capabilities.sendKey).toBe(true);
    expect(backend.capabilities.captureTail).toBe(true);
    expect(backend.capabilities.kill).toBe(true);
    expect(backend.capabilities.attach).toBe(true);
    expect(backend.capabilities.identity).toBe(true);
    expect(backend.capabilities.awaitReady).toBe(true);
  });

  test("exercises zmux parity subset via executable adapter methods", async () => {
    const tempDir = createTempDir("zmux-backend-exec-");
    tempDirs.push(tempDir);

    const stateDir = join(tempDir, "state");
    mkdirSync(stateDir, { recursive: true });

    const fakeBinary = writeFakeZmuxBinary(tempDir, stateDir);
    const stateFile = fakeStateFilePath(stateDir);

    process.env.PI_BACKEND_TARGET = "deckhand-zmux-old";
    process.env.PI_BACKEND_SESSION = "deckhand-zmux-session";
    process.env.PI_AGENT_NAME = "deckhand-zmux-old";

    const backend = createBackendContract({
      cwd: tempDir,
      backend: {
        type: "zmux",
        binary: fakeBinary,
        state_dir: stateDir,
      },
    });

    const listed = await backend.list();
    expect(listed.sessions.map((session) => session.displayName)).toEqual(["deckhand-zmux-session"]);
    expect(await backend.hasSession("deckhand-zmux-session")).toBe(true);
    expect(await backend.hasSession("missing-session")).toBe(false);

    const attached = await backend.attachSession("deckhand-zmux-session", { stdio: "pipe" });
    expect(attached.stdout).toContain("attached:pane_1");

    await backend.sendText("pane_1", "hello world");
    await backend.sendKey("pane_1", "Enter");

    const capture = await backend.captureTail("pane_1", { lines: 80, maxBytes: 4096 });
    expect(capture.text).toBe("capture:tail");

    await backend.awaitReady("pane_1", { timeoutMs: 50 });

    const initialIdentity = await backend.readIdentity({ kind: "pane", target: "deckhand-zmux-old" });
    expect(initialIdentity).toBe("deckhand-zmux-old");

    await backend.renameIdentity("deckhand-zmux-next", { kind: "pane", target: "deckhand-zmux-old" });
    const nextIdentity = await backend.readIdentity({ kind: "pane", target: "deckhand-zmux-old" });
    expect(nextIdentity).toBe("deckhand-zmux-next");

    await backend.renameIdentity("deckhand-zmux-final", { kind: "pane", target: "deckhand-zmux-old" });
    const finalIdentity = await backend.readIdentity({ kind: "pane", target: "deckhand-zmux-old" });
    expect(finalIdentity).toBe("deckhand-zmux-final");
    expect(process.env.PI_BACKEND_TARGET).toBe("pane_1");

    await backend.writeMetadata("route.deckhand", "pane_1");
    expect(await backend.readMetadata("route.deckhand")).toBe("pane_1");

    await backend.killTarget("pane_1");

    const fakeState = readFakeState(stateFile);
    const commands = fakeState.calls.map((call) => call.command);

    expect(commands).toContain("list");
    expect(commands).toContain("exists");
    expect(commands).toContain("attach");
    expect(commands).toContain("send-text");
    expect(commands).toContain("send-key");
    expect(commands).toContain("capture-tail");
    expect(commands).toContain("await-ready");
    expect(commands).toContain("rename");
    expect(commands).toContain("write-metadata");
    expect(commands).toContain("read-metadata");
    expect(commands).toContain("kill");
  });

  test("falls back from stale name target to PI_BACKEND_SESSION pane resolution", async () => {
    const tempDir = createTempDir("zmux-backend-fallback-");
    tempDirs.push(tempDir);

    const stateDir = join(tempDir, "state");
    mkdirSync(stateDir, { recursive: true });

    const fakeBinary = writeFakeZmuxBinary(tempDir, stateDir);
    const stateFile = fakeStateFilePath(stateDir);

    const initialState = readFakeState(stateFile);
    initialState.metadata = {};
    writeFileSync(stateFile, JSON.stringify(initialState, null, 2), "utf-8");

    process.env.PI_BACKEND_TARGET = "stale-name";
    process.env.PI_BACKEND_SESSION = "deckhand-zmux-session";
    process.env.PI_AGENT_NAME = "stale-name";

    const backend = createBackendContract({
      cwd: tempDir,
      backend: {
        type: "zmux",
        binary: fakeBinary,
        state_dir: stateDir,
      },
    });

    const before = await backend.readIdentity({ kind: "pane", target: "stale-name" });
    expect(before).toBe("deckhand-zmux-old");

    await backend.renameIdentity("deckhand-zmux-session-fallback", { kind: "pane", target: "stale-name" });

    const after = await backend.readIdentity({ kind: "pane", target: "stale-name" });
    expect(after).toBe("deckhand-zmux-session-fallback");
    expect(process.env.PI_BACKEND_TARGET).toBe("pane_1");
  });

  test("builds shell-safe command wrappers for backend spawn execution", () => {
    const command = commandWithEnvAndCwd({
      cwd: "/workspace/project",
      env: {
        FOO: "bar baz",
        TOKEN: "a'b",
      },
      command: "pi --session state.jsonl",
    });

    expect(command).toContain("cd '/workspace/project'");
    expect(command).toContain("FOO='bar baz'");
    expect(command).toContain("TOKEN='a'\\''b'");
    expect(command).toContain("pi --session state.jsonl");
  });
});
