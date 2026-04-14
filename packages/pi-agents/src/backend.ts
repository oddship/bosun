/**
 * Backend contract for Bosun runtime operations.
 *
 * Provides a backend-neutral surface over tmux and zmux for:
 * spawn/list/exists/attach/send/capture/kill/identity/metadata/readiness.
 */

import { execFileSync } from "node:child_process";
import {
  capturePane,
  getTmuxSessionSync,
  getTmuxSocket,
  getWindowName,
  isInTmux,
  newSession,
  newWindow,
  renameWindow,
  sessionExists,
  tmuxExec,
  tmuxExecSync,
  windowExists,
} from "../../pi-tmux/core.ts";
import type { BackendConfig, ZmuxBackendConfig } from "./config.js";

export type BackendType = "tmux" | "zmux";

export type BackendErrorCode =
  | "backend_invalid_config"
  | "backend_unavailable"
  | "target_not_found"
  | "target_ambiguous"
  | "name_conflict"
  | "timeout"
  | "unsupported"
  | "transport"
  | "protocol"
  | "runtime"
  | "unknown";

export class BackendError extends Error {
  readonly backend: BackendType;
  readonly code: BackendErrorCode;
  readonly backendCode?: string;
  readonly retryable: boolean;

  constructor(options: {
    backend: BackendType;
    code: BackendErrorCode;
    message: string;
    backendCode?: string;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = "BackendError";
    this.backend = options.backend;
    this.code = options.code;
    this.backendCode = options.backendCode;
    this.retryable = options.retryable ?? false;
  }
}

export interface BackendCapabilities {
  detachedSpawn: true;
  list: true;
  exists: true;
  attach: true;
  sendText: true;
  sendKey: true;
  multilineSafeSendText: "buffer" | "native";
  captureTail: true;
  kill: true;
  identity: true;
  metadata: true;
  awaitReady: true;
  reconnectSemantics: "name_scoped" | "durable_id";
}

export interface BackendPolicy {
  defaultTimeoutMs: number;
  retry: {
    attempts: number;
    backoffMs: number;
    retryableCodes: BackendErrorCode[];
  };
}

export type BackendEntityKind = "session" | "window" | "pane";

export interface BackendEntity {
  id: string;
  kind: BackendEntityKind;
  displayName: string;
  runtimeState?: string;
  sessionId?: string;
  windowId?: string;
}

export interface BackendListResult {
  sessions: BackendEntity[];
  windows: BackendEntity[];
  panes: BackendEntity[];
}

export interface SpawnDetachedOptions {
  createSession: boolean;
  sessionName: string;
  windowName: string;
  paneName?: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface SpawnDetachedResult {
  sessionName: string;
  windowName: string;
  target: string;
  sessionId?: string;
  windowId?: string;
  paneId?: string;
  runtimeState?: string;
}

export interface CaptureTailResult {
  text: string;
  cursor?: number | string;
  revision?: number | string;
}

export interface BackendCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ProcessBackend {
  readonly type: BackendType;
  readonly capabilities: BackendCapabilities;
  readonly policy: BackendPolicy;

  isInteractiveContext(): boolean;
  currentSessionName(): string | null;

  list(): Promise<BackendListResult>;
  listSessionNames(): Promise<string[]>;
  hasSession(name: string): Promise<boolean>;
  hasWindow(name: string, options?: { sessionName?: string }): Promise<boolean>;

  spawnDetached(options: SpawnDetachedOptions): Promise<SpawnDetachedResult>;
  startServer(): Promise<void>;

  attachSession(name: string, options?: { stdio?: "inherit" | "pipe" }): Promise<BackendCommandResult>;
  sendText(target: string, text: string): Promise<void>;
  sendKey(target: string, key: string): Promise<void>;
  captureTail(target: string, options?: { lines?: number; maxBytes?: number }): Promise<CaptureTailResult>;

  killTarget(target: string): Promise<void>;
  killSession(name: string): Promise<void>;
  killServer(): Promise<void>;
  sessionPids(): Promise<string[]>;

  awaitReady(target: string, options?: { timeoutMs?: number; pollMs?: number }): Promise<void>;

  readIdentity(options?: { target?: string; kind?: BackendEntityKind }): Promise<string | null>;
  renameIdentity(name: string, options?: { target?: string; kind?: BackendEntityKind }): Promise<void>;

  readMetadata(key: string): Promise<string | null>;
  writeMetadata(key: string, value: string): Promise<void>;

  resolvePaneTargetForSession(sessionName: string): Promise<string | null>;
}

export interface BackendFactoryOptions {
  cwd: string;
  backend: BackendConfig;
  tmuxSocket?: string | null;
}

interface CommandExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    stdio?: "inherit" | "pipe";
    timeoutMs?: number;
  },
): CommandExecResult {
  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf-8",
      stdio: options?.stdio ?? "pipe",
      cwd: options?.cwd,
      timeout: options?.timeoutMs,
    });
    return {
      stdout: typeof stdout === "string" ? stdout.trim() : "",
      stderr: "",
      code: 0,
    };
  } catch (error) {
    const e = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      message?: string;
      status?: number;
      signal?: string;
    };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout.trim() : e.stdout?.toString("utf-8").trim() || "",
      stderr: typeof e.stderr === "string" ? e.stderr.trim() : e.stderr?.toString("utf-8").trim() || e.message || "",
      code: typeof e.status === "number" ? e.status : 1,
    };
  }
}

async function withRetry<T>(
  policy: BackendPolicy,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.retry.attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const backendError = error instanceof BackendError ? error : null;
      const retryable = backendError && policy.retry.retryableCodes.includes(backendError.code) && backendError.retryable;
      if (!retryable || attempt >= policy.retry.attempts) {
        throw error;
      }
      if (policy.retry.backoffMs > 0) {
        await sleep(policy.retry.backoffMs);
      }
    }
  }

  throw lastError;
}

function normalizeListEntity(value: unknown, kind: BackendEntityKind): BackendEntity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const displayName = typeof record.display_name === "string"
    ? record.display_name
    : (typeof record.name === "string" ? record.name : id);
  if (!id || !displayName) return null;

  return {
    id,
    kind,
    displayName,
    runtimeState: typeof record.runtime_state === "string" ? record.runtime_state : undefined,
    sessionId: typeof record.session_id === "string" ? record.session_id : undefined,
    windowId: typeof record.window_id === "string" ? record.window_id : undefined,
  };
}

function mapZmuxError(code: string | undefined): { code: BackendErrorCode; retryable: boolean } {
  switch (code) {
    case "ERR_TARGET_NOT_FOUND":
      return { code: "target_not_found", retryable: false };
    case "ERR_TARGET_AMBIGUOUS":
      return { code: "target_ambiguous", retryable: false };
    case "ERR_NAME_CONFLICT":
      return { code: "name_conflict", retryable: false };
    case "ERR_TIMEOUT":
      return { code: "timeout", retryable: true };
    case "ERR_USAGE":
      return { code: "backend_invalid_config", retryable: false };
    case "ERR_TRANSPORT_UNSUPPORTED":
    case "ERR_UNSUPPORTED_METHOD":
    case "ERR_CAPABILITY_UNAVAILABLE":
      return { code: "unsupported", retryable: false };
    case "ERR_TRANSPORT_UNAVAILABLE":
      return { code: "transport", retryable: true };
    case "ERR_TRANSPORT_VERSION_MISMATCH":
    case "ERR_TRANSPORT_CERT_INVALID":
    case "ERR_TRANSPORT_IDENTITY_MISMATCH":
      return { code: "transport", retryable: false };
    case "ERR_PROTOCOL":
      return { code: "protocol", retryable: false };
    case "ERR_RUNTIME":
      return { code: "runtime", retryable: false };
    default:
      return { code: "unknown", retryable: false };
  }
}

function tmuxCommand(
  socket: string | null | undefined,
  args: string[],
  options?: { stdio?: "inherit" | "pipe"; timeoutMs?: number },
): CommandExecResult {
  const fullArgs = socket ? ["-S", socket, ...args] : args;
  return runCommand("tmux", fullArgs, {
    stdio: options?.stdio,
    timeoutMs: options?.timeoutMs,
  });
}

function buildZmuxBaseArgs(config: ZmuxBackendConfig): string[] {
  const args: string[] = [];

  if (config.state_dir) args.push("--state-dir", config.state_dir);
  if (config.socket_path) args.push("--socket-path", config.socket_path);
  if (config.transport) args.push("--transport", config.transport);

  if (config.ssh_host) args.push("--ssh-host", config.ssh_host);
  if (config.ssh_user) args.push("--ssh-user", config.ssh_user);
  if (typeof config.ssh_port === "number") args.push("--ssh-port", String(config.ssh_port));
  if (config.ssh_command) args.push("--ssh-command", config.ssh_command);
  if (typeof config.ssh_bootstrap_timeout_ms === "number") {
    args.push("--ssh-bootstrap-timeout-ms", String(config.ssh_bootstrap_timeout_ms));
  }

  if (config.tcp_host) args.push("--tcp-host", config.tcp_host);
  if (typeof config.tcp_port === "number") args.push("--tcp-port", String(config.tcp_port));
  if (config.tls_server_name) args.push("--tls-server-name", config.tls_server_name);
  if (config.tls_ca_cert) args.push("--tls-ca-cert", config.tls_ca_cert);
  if (config.tls_client_cert) args.push("--tls-client-cert", config.tls_client_cert);
  if (config.tls_client_key) args.push("--tls-client-key", config.tls_client_key);
  if (typeof config.tls_transport_version === "number") {
    args.push("--tls-transport-version", String(config.tls_transport_version));
  }

  return args;
}

function validateZmuxConfig(config: ZmuxBackendConfig): void {
  const missingDiscovery = !config.state_dir && !config.socket_path;
  if (missingDiscovery) {
    throw new BackendError({
      backend: "zmux",
      code: "backend_invalid_config",
      message: "Backend 'zmux' requires backend.state_dir or backend.socket_path (fail-closed discovery).",
    });
  }

  if (config.transport === "ssh" && !config.ssh_host) {
    throw new BackendError({
      backend: "zmux",
      code: "backend_invalid_config",
      message: "Backend 'zmux' with transport=ssh requires backend.ssh_host.",
    });
  }

  if (config.transport === "tcp-tls") {
    const missing = [
      !config.tcp_host ? "backend.tcp_host" : "",
      typeof config.tcp_port !== "number" ? "backend.tcp_port" : "",
      !config.tls_server_name ? "backend.tls_server_name" : "",
      !config.tls_ca_cert ? "backend.tls_ca_cert" : "",
      !config.tls_client_cert ? "backend.tls_client_cert" : "",
      !config.tls_client_key ? "backend.tls_client_key" : "",
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new BackendError({
        backend: "zmux",
        code: "backend_invalid_config",
        message: `Backend 'zmux' with transport=tcp-tls is missing required fields: ${missing.join(", ")}`,
      });
    }
  }
}

function createTmuxBackend(options: BackendFactoryOptions): ProcessBackend {
  const socket = options.tmuxSocket ?? getTmuxSocket();

  const policy: BackendPolicy = {
    defaultTimeoutMs: 5000,
    retry: {
      attempts: 1,
      backoffMs: 0,
      retryableCodes: [],
    },
  };

  const capabilities: BackendCapabilities = {
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
  };

  return {
    type: "tmux",
    capabilities,
    policy,

    isInteractiveContext(): boolean {
      return isInTmux();
    },

    currentSessionName(): string | null {
      return getTmuxSessionSync({ socket });
    },

    async list(): Promise<BackendListResult> {
      const sessionsRaw = tmuxCommand(socket, ["list-sessions", "-F", "#{session_name}"]);
      const windowsRaw = tmuxCommand(socket, ["list-windows", "-a", "-F", "#{session_name}|#{window_name}"]);
      const panesRaw = tmuxCommand(socket, ["list-panes", "-a", "-F", "#{pane_id}|#{session_name}|#{window_name}"]);

      const sessions = sessionsRaw.code === 0
        ? sessionsRaw.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((name) => ({
            id: name,
            kind: "session" as const,
            displayName: name,
            runtimeState: "running",
          }))
        : [];

      const windows = windowsRaw.code === 0
        ? windowsRaw.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
            const [sessionName = "", windowName = ""] = line.split("|");
            const id = `${sessionName}:${windowName}`;
            return {
              id,
              kind: "window" as const,
              displayName: windowName,
              sessionId: sessionName,
              runtimeState: "running",
            };
          })
        : [];

      const panes = panesRaw.code === 0
        ? panesRaw.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
            const [paneId = "", sessionName = "", windowName = ""] = line.split("|");
            return {
              id: paneId,
              kind: "pane" as const,
              displayName: paneId,
              sessionId: sessionName,
              windowId: `${sessionName}:${windowName}`,
              runtimeState: "running",
            };
          })
        : [];

      return { sessions, windows, panes };
    },

    async listSessionNames(): Promise<string[]> {
      const listed = await this.list();
      return listed.sessions.map((session) => session.displayName);
    },

    async hasSession(name: string): Promise<boolean> {
      return sessionExists(name, { socket });
    },

    async hasWindow(name: string, options?: { sessionName?: string }): Promise<boolean> {
      const session = options?.sessionName ?? this.currentSessionName();
      return windowExists(name, { socket, session });
    },

    async spawnDetached(spawn: SpawnDetachedOptions): Promise<SpawnDetachedResult> {
      const env = spawn.env || {};
      const result = spawn.createSession
        ? await newSession({
            name: spawn.sessionName,
            windowName: spawn.windowName,
            command: spawn.command,
            cwd: spawn.cwd,
            env,
            socket,
          })
        : await newWindow({
            name: spawn.windowName,
            command: spawn.command,
            cwd: spawn.cwd,
            env,
            socket,
            session: spawn.sessionName,
            background: true,
          });

      if (result.code !== 0) {
        throw new BackendError({
          backend: "tmux",
          code: result.stderr.includes("duplicate") ? "name_conflict" : "runtime",
          message: result.stderr || result.stdout || "tmux spawn failed",
        });
      }

      return {
        sessionName: spawn.sessionName,
        windowName: spawn.windowName,
        target: spawn.createSession ? spawn.sessionName : `${spawn.sessionName}:${spawn.windowName}`,
        runtimeState: "running",
      };
    },

    async startServer(): Promise<void> {
      tmuxCommand(socket, ["start-server"]);
    },

    async attachSession(name: string, options?: { stdio?: "inherit" | "pipe" }): Promise<BackendCommandResult> {
      const result = tmuxCommand(socket, ["attach", "-t", name], { stdio: options?.stdio ?? "pipe" });
      if (result.code !== 0) {
        throw new BackendError({
          backend: "tmux",
          code: "target_not_found",
          message: result.stderr || `Session '${name}' not found`,
        });
      }
      return result;
    },

    async sendText(target: string, text: string): Promise<void> {
      const bufferName = `bosun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const setBuffer = tmuxCommand(socket, ["set-buffer", "-b", bufferName, "--", text]);
      if (setBuffer.code !== 0) {
        throw new BackendError({
          backend: "tmux",
          code: "runtime",
          message: setBuffer.stderr || "Failed to set tmux buffer",
        });
      }

      const pasteBuffer = tmuxCommand(socket, ["paste-buffer", "-t", target, "-b", bufferName]);
      tmuxCommand(socket, ["delete-buffer", "-b", bufferName]);

      if (pasteBuffer.code !== 0) {
        throw new BackendError({
          backend: "tmux",
          code: "target_not_found",
          message: pasteBuffer.stderr || "Failed to paste tmux buffer",
        });
      }
    },

    async sendKey(target: string, key: string): Promise<void> {
      const result = await tmuxExec(["send-keys", "-t", target, key], { socket });
      if (result.code !== 0) {
        throw new BackendError({
          backend: "tmux",
          code: "target_not_found",
          message: result.stderr || result.stdout || "Failed to send key",
        });
      }
    },

    async captureTail(target: string, options?: { lines?: number; maxBytes?: number }): Promise<CaptureTailResult> {
      const capture = await capturePane(target, {
        socket,
        lines: options?.lines,
      });

      if (capture.code !== 0) {
        throw new BackendError({
          backend: "tmux",
          code: "target_not_found",
          message: capture.stderr || capture.stdout || "Failed to capture pane",
        });
      }

      let text = capture.stdout;
      if (typeof options?.maxBytes === "number" && options.maxBytes > 0 && text.length > options.maxBytes) {
        text = text.slice(-options.maxBytes);
      }

      return { text };
    },

    async killTarget(target: string): Promise<void> {
      const asSession = tmuxCommand(socket, ["kill-session", "-t", target]);
      if (asSession.code === 0) return;

      const asWindow = tmuxCommand(socket, ["kill-window", "-t", target]);
      if (asWindow.code === 0) return;

      throw new BackendError({
        backend: "tmux",
        code: "target_not_found",
        message: asWindow.stderr || asSession.stderr || `No tmux target '${target}'`,
      });
    },

    async killSession(name: string): Promise<void> {
      const result = tmuxCommand(socket, ["kill-session", "-t", name]);
      if (result.code !== 0) {
        throw new BackendError({
          backend: "tmux",
          code: "target_not_found",
          message: result.stderr || `Session '${name}' not found`,
        });
      }
    },

    async killServer(): Promise<void> {
      tmuxCommand(socket, ["kill-server"]);
    },

    async sessionPids(): Promise<string[]> {
      const result = tmuxCommand(socket, ["list-panes", "-a", "-F", "#{pane_pid}"]);
      if (result.code !== 0 || !result.stdout) return [];
      return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    },

    async awaitReady(target: string, options?: { timeoutMs?: number; pollMs?: number }): Promise<void> {
      const timeoutMs = options?.timeoutMs ?? 15_000;
      const pollMs = options?.pollMs ?? 250;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const exists = tmuxExecSync(["has-session", "-t", target], { socket });
        if (exists !== null) return;
        await sleep(pollMs);
      }

      throw new BackendError({
        backend: "tmux",
        code: "timeout",
        message: `Timed out waiting for tmux target '${target}'`,
      });
    },

    async readIdentity(options?: { target?: string; kind?: BackendEntityKind }): Promise<string | null> {
      if (options?.target) {
        const format = options.kind === "session" ? "#{session_name}" : "#{window_name}";
        const display = tmuxCommand(socket, ["display-message", "-t", options.target, "-p", format]);
        if (display.code === 0 && display.stdout) return display.stdout;
        return null;
      }
      return await getWindowName({ socket });
    },

    async renameIdentity(name: string, options?: { target?: string; kind?: BackendEntityKind }): Promise<void> {
      if (options?.target) {
        const cmd = options.kind === "session" ? "rename-session" : "rename-window";
        const result = tmuxCommand(socket, [cmd, "-t", options.target, name]);
        if (result.code !== 0) {
          throw new BackendError({
            backend: "tmux",
            code: "runtime",
            message: result.stderr || result.stdout || "Failed to rename tmux identity",
          });
        }
        return;
      }

      const renamed = await renameWindow(name, { socket });
      if (!renamed) {
        throw new BackendError({
          backend: "tmux",
          code: "runtime",
          message: "Failed to rename tmux window",
        });
      }
    },

    async readMetadata(key: string): Promise<string | null> {
      const result = tmuxCommand(socket, ["show-environment", "-g", key]);
      if (result.code !== 0 || !result.stdout) return null;
      return result.stdout.includes("=") ? result.stdout.split("=").slice(1).join("=") : null;
    },

    async writeMetadata(key: string, value: string): Promise<void> {
      const result = tmuxCommand(socket, ["set-environment", "-g", key, value]);
      if (result.code !== 0) {
        throw new BackendError({
          backend: "tmux",
          code: "runtime",
          message: result.stderr || result.stdout || `Failed to set tmux metadata key '${key}'`,
        });
      }
    },

    async resolvePaneTargetForSession(sessionName: string): Promise<string | null> {
      return sessionName;
    },
  };
}

type ZmuxEnvelope = {
  ok?: boolean;
  command?: string;
  result?: Record<string, unknown>;
  error?: {
    code?: string;
    class?: string;
    message?: string;
    exit_code?: number;
  };
};

function createZmuxBackend(options: BackendFactoryOptions): ProcessBackend {
  if (options.backend.type !== "zmux") {
    throw new BackendError({
      backend: "zmux",
      code: "backend_invalid_config",
      message: "Internal error: invalid zmux backend config",
    });
  }

  validateZmuxConfig(options.backend);

  const binary = options.backend.binary || process.env.BOSUN_ZMUX_BIN || "zmux";
  const baseArgs = buildZmuxBaseArgs(options.backend);

  const policy: BackendPolicy = {
    defaultTimeoutMs: 10_000,
    retry: {
      attempts: 2,
      backoffMs: 60,
      retryableCodes: ["transport", "timeout"],
    },
  };

  const capabilities: BackendCapabilities = {
    detachedSpawn: true,
    list: true,
    exists: true,
    attach: true,
    sendText: true,
    sendKey: true,
    multilineSafeSendText: "native",
    captureTail: true,
    kill: true,
    identity: true,
    metadata: true,
    awaitReady: true,
    reconnectSemantics: "durable_id",
  };

  const runZmuxJson = async (
    args: string[],
    timeoutMs?: number,
  ): Promise<ZmuxEnvelope> => {
    const result = runCommand(binary, ["--json", ...baseArgs, ...args], {
      cwd: options.cwd,
      timeoutMs: timeoutMs ?? policy.defaultTimeoutMs,
      stdio: "pipe",
    });

    let envelope: ZmuxEnvelope | null = null;
    if (result.stdout) {
      try {
        envelope = JSON.parse(result.stdout) as ZmuxEnvelope;
      } catch {
        envelope = null;
      }
    }

    if (!envelope) {
      const mappedFromExit = result.code === 4
        ? { code: "timeout" as const, retryable: true }
        : result.code === 3
          ? { code: "target_not_found" as const, retryable: false }
          : result.code === 5
            ? { code: "unsupported" as const, retryable: false }
            : result.code === 6
              ? { code: "transport" as const, retryable: true }
              : { code: "protocol" as const, retryable: false };

      throw new BackendError({
        backend: "zmux",
        code: mappedFromExit.code,
        retryable: mappedFromExit.retryable,
        message: result.stderr || result.stdout || `zmux command failed: ${args.join(" ")}`,
      });
    }

    if (!envelope.ok) {
      const mapped = mapZmuxError(envelope.error?.code);
      throw new BackendError({
        backend: "zmux",
        code: mapped.code,
        retryable: mapped.retryable,
        backendCode: envelope.error?.code,
        message: envelope.error?.message || `zmux ${args[0]} failed`,
      });
    }

    return envelope;
  };

  const runWithPolicy = async <T>(fn: () => Promise<T>): Promise<T> => withRetry(policy, fn);

  const list = async (): Promise<BackendListResult> => {
    const envelope = await runWithPolicy(() => runZmuxJson(["list"]));
    const result = envelope.result || {};

    const sessionsRaw = Array.isArray(result.sessions) ? result.sessions : [];
    const windowsRaw = Array.isArray(result.windows) ? result.windows : [];
    const panesRaw = Array.isArray(result.panes) ? result.panes : [];

    const sessions = sessionsRaw
      .map((value) => normalizeListEntity(value, "session"))
      .filter((value): value is BackendEntity => Boolean(value));
    const windows = windowsRaw
      .map((value) => normalizeListEntity(value, "window"))
      .filter((value): value is BackendEntity => Boolean(value));
    const panes = panesRaw
      .map((value) => normalizeListEntity(value, "pane"))
      .filter((value): value is BackendEntity => Boolean(value));

    return { sessions, windows, panes };
  };

  const resolvePaneTargetForSession = async (
    sessionName: string,
    snapshotOverride?: BackendListResult,
  ): Promise<string | null> => {
    const snapshot = snapshotOverride || await list();
    const bySession = snapshot.panes.find((pane) => pane.sessionId === sessionName);
    if (bySession) return bySession.id;

    const session = snapshot.sessions.find((candidate) => candidate.displayName === sessionName || candidate.id === sessionName);
    if (!session) return null;

    const firstPane = snapshot.panes.find((pane) => pane.sessionId === session.id);
    return firstPane?.id || null;
  };

  const normalizeTarget = (value: string | undefined | null): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  const metadataTargetKey = (hint: string): string => `bosun.identity.${hint}.target`;

  const readMetadataValue = async (key: string): Promise<string | null> => {
    try {
      const envelope = await runWithPolicy(() => runZmuxJson(["read-metadata", key]));
      const result = envelope.result || {};
      const value = result.value;
      return typeof value === "string" && value.trim() ? value : null;
    } catch {
      return null;
    }
  };

  const resolveIdentityTarget = async (
    kind: BackendEntityKind,
    targetHint?: string,
  ): Promise<string | null> => {
    const explicitTarget = normalizeTarget(targetHint);
    const envTarget = normalizeTarget(process.env.PI_BACKEND_TARGET);
    const envAgentName = normalizeTarget(process.env.PI_AGENT_NAME);
    const envSession = normalizeTarget(process.env.PI_BACKEND_SESSION);

    const hints = Array.from(new Set([explicitTarget, envTarget, envAgentName].filter((value): value is string => Boolean(value))));
    const snapshot = await list();

    const entities = kind === "session"
      ? snapshot.sessions
      : kind === "window"
        ? snapshot.windows
        : snapshot.panes;

    for (const hint of hints) {
      const matched = entities.find((entity) => entity.id === hint || entity.displayName === hint);
      if (matched) return matched.id;
    }

    if (kind === "pane") {
      for (const hint of hints) {
        const mappedTarget = await readMetadataValue(metadataTargetKey(hint));
        if (!mappedTarget) continue;

        const matchedPane = snapshot.panes.find((pane) => pane.id === mappedTarget || pane.displayName === mappedTarget);
        if (matchedPane) return matchedPane.id;
        return mappedTarget;
      }

      const sessionHints: string[] = [];
      for (const hint of hints) {
        const matchedSession = snapshot.sessions.find((session) => session.id === hint || session.displayName === hint);
        if (!matchedSession) continue;
        sessionHints.push(matchedSession.id, matchedSession.displayName);
      }
      if (envSession) sessionHints.push(envSession);

      for (const sessionHint of Array.from(new Set(sessionHints.filter(Boolean)))) {
        const resolvedPane = await resolvePaneTargetForSession(sessionHint, snapshot);
        if (resolvedPane) return resolvedPane;
      }
    }

    if (kind === "session" && envSession) {
      const matchedSession = snapshot.sessions.find((session) => session.id === envSession || session.displayName === envSession);
      if (matchedSession) return matchedSession.id;
    }

    return hints[0] || null;
  };

  return {
    type: "zmux",
    capabilities,
    policy,

    isInteractiveContext(): boolean {
      return true;
    },

    currentSessionName(): string | null {
      return process.env.PI_BACKEND_SESSION || process.env.PI_AGENT_NAME || null;
    },

    async list(): Promise<BackendListResult> {
      return list();
    },

    async listSessionNames(): Promise<string[]> {
      const snapshot = await list();
      return snapshot.sessions.map((session) => session.displayName);
    },

    async hasSession(name: string): Promise<boolean> {
      const envelope = await runWithPolicy(() => runZmuxJson(["exists", name]));
      const result = envelope.result || {};
      if (result.exists === true && result.resolved_kind === "session") return true;

      const snapshot = await list();
      return snapshot.sessions.some((session) => session.displayName === name || session.id === name);
    },

    async hasWindow(name: string, options?: { sessionName?: string }): Promise<boolean> {
      const snapshot = await list();
      return snapshot.windows.some((window) => {
        if (window.displayName !== name && window.id !== name) return false;
        if (!options?.sessionName) return true;
        return window.sessionId === options.sessionName;
      });
    },

    async spawnDetached(spawn: SpawnDetachedOptions): Promise<SpawnDetachedResult> {
      const env = Object.entries(spawn.env || {}).map(([key, value]) => `${key}=${shellEscape(value)}`);
      let runtimeCommand = spawn.command;
      if (spawn.cwd) {
        runtimeCommand = `cd ${shellEscape(spawn.cwd)} && ${runtimeCommand}`;
      }
      if (env.length > 0) {
        runtimeCommand = `${env.join(" ")} ${runtimeCommand}`;
      }

      const paneName = spawn.paneName || spawn.windowName;
      const envelope = await runWithPolicy(() => runZmuxJson([
        "create",
        "--session",
        spawn.sessionName,
        "--window",
        spawn.windowName,
        "--pane",
        paneName,
        "--",
        "/bin/sh",
        "-lc",
        runtimeCommand,
      ], 30_000));

      const result = envelope.result || {};
      const paneId = typeof result.pane_id === "string" ? result.pane_id : paneName;

      if (spawn.metadata) {
        for (const [key, value] of Object.entries(spawn.metadata)) {
          await this.writeMetadata(key, value);
        }
      }

      return {
        sessionName: spawn.sessionName,
        windowName: spawn.windowName,
        target: paneId,
        sessionId: typeof result.session_id === "string" ? result.session_id : undefined,
        windowId: typeof result.window_id === "string" ? result.window_id : undefined,
        paneId: typeof result.pane_id === "string" ? result.pane_id : undefined,
        runtimeState: typeof result.runtime_state === "string" ? result.runtime_state : undefined,
      };
    },

    async startServer(): Promise<void> {
      // zmux client reconnect/bootstrap is transport-managed.
    },

    async attachSession(name: string, options?: { stdio?: "inherit" | "pipe" }): Promise<BackendCommandResult> {
      const target = await resolvePaneTargetForSession(name);
      if (!target) {
        throw new BackendError({
          backend: "zmux",
          code: "target_not_found",
          message: `No pane target resolved for session '${name}'.`,
        });
      }

      // For interactive CLI attach, we intentionally do not force --json.
      const result = runCommand(binary, [...baseArgs, "attach", target], {
        stdio: options?.stdio ?? "pipe",
      });

      if (result.code !== 0) {
        throw new BackendError({
          backend: "zmux",
          code: "runtime",
          message: result.stderr || result.stdout || `Failed to attach to '${name}'`,
        });
      }

      return result;
    },

    async sendText(target: string, text: string): Promise<void> {
      await runWithPolicy(() => runZmuxJson(["send-text", target, text], 20_000));
    },

    async sendKey(target: string, key: string): Promise<void> {
      await runWithPolicy(() => runZmuxJson(["send-key", target, key], 20_000));
    },

    async captureTail(target: string, options?: { lines?: number; maxBytes?: number }): Promise<CaptureTailResult> {
      const maxBytes = options?.maxBytes || Math.max(1024, (options?.lines || 200) * 200);
      const envelope = await runWithPolicy(() => runZmuxJson(["capture-tail", target, "--max-bytes", String(maxBytes)]));
      const result = envelope.result || {};
      return {
        text: typeof result.text === "string" ? result.text : "",
        cursor: typeof result.cursor === "number" || typeof result.cursor === "string" ? result.cursor : undefined,
        revision: typeof result.revision === "number" || typeof result.revision === "string" ? result.revision : undefined,
      };
    },

    async killTarget(target: string): Promise<void> {
      await runWithPolicy(() => runZmuxJson(["kill", target], 15_000));
    },

    async killSession(name: string): Promise<void> {
      const target = await resolvePaneTargetForSession(name);
      if (!target) {
        throw new BackendError({
          backend: "zmux",
          code: "target_not_found",
          message: `No pane target resolved for session '${name}'.`,
        });
      }
      await this.killTarget(target);
    },

    async killServer(): Promise<void> {
      throw new BackendError({
        backend: "zmux",
        code: "unsupported",
        message: "killServer is unsupported for zmux in dual-backend mode.",
      });
    },

    async sessionPids(): Promise<string[]> {
      return [];
    },

    async awaitReady(target: string, options?: { timeoutMs?: number; pollMs?: number }): Promise<void> {
      const timeoutMs = options?.timeoutMs ?? 15_000;
      await runWithPolicy(() => runZmuxJson(["await-ready", target, "--timeout-ms", String(timeoutMs)], timeoutMs + 3_000));
    },

    async readIdentity(options?: { target?: string; kind?: BackendEntityKind }): Promise<string | null> {
      const kind = options?.kind || "pane";
      const target = await resolveIdentityTarget(kind, options?.target);
      if (!target) return null;

      const snapshot = await list();
      const candidates = kind === "session"
        ? snapshot.sessions
        : kind === "window"
          ? snapshot.windows
          : snapshot.panes;
      const entity = candidates.find((candidate) => candidate.id === target || candidate.displayName === target);

      if (kind === "pane" && entity?.id) {
        process.env.PI_BACKEND_TARGET = entity.id;
      }

      return entity?.displayName || null;
    },

    async renameIdentity(name: string, options?: { target?: string; kind?: BackendEntityKind }): Promise<void> {
      const kind = options?.kind || "pane";
      const target = await resolveIdentityTarget(kind, options?.target);
      if (!target) {
        throw new BackendError({
          backend: "zmux",
          code: "backend_invalid_config",
          message: "No backend target available for zmux identity rename.",
        });
      }

      await runWithPolicy(() => runZmuxJson(["rename", target, name, "--kind", kind]));
      if (kind === "pane") {
        process.env.PI_BACKEND_TARGET = target;
      }
    },

    async readMetadata(key: string): Promise<string | null> {
      return readMetadataValue(key);
    },

    async writeMetadata(key: string, value: string): Promise<void> {
      await runWithPolicy(() => runZmuxJson(["write-metadata", key, value]));
    },

    async resolvePaneTargetForSession(sessionName: string): Promise<string | null> {
      return resolvePaneTargetForSession(sessionName);
    },
  };
}

export function createBackendContract(options: BackendFactoryOptions): ProcessBackend {
  if (options.backend.type === "tmux") return createTmuxBackend(options);
  return createZmuxBackend(options);
}

export function commandWithEnvAndCwd(options: {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}): string {
  const env = Object.entries(options.env || {}).map(([key, value]) => `${key}=${shellEscape(value)}`);
  const withEnv = env.length > 0 ? `${env.join(" ")} ${options.command}` : options.command;
  return options.cwd ? `cd ${shellEscape(options.cwd)} && ${withEnv}` : withEnv;
}
