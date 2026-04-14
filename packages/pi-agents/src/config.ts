/**
 * pi-agents configuration loading.
 *
 * Reads `.pi/agents.json` for model tier mappings, agent paths,
 * and backend config. Works with sensible defaults when no config
 * file exists.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface BackendConfigBase {
  /** Command prefix that wraps spawned pi processes (e.g., "scripts/sandbox.sh"). */
  command_prefix?: string;
}

export interface TmuxBackendConfig extends BackendConfigBase {
  type: "tmux";
}

export interface ZmuxBackendConfig extends BackendConfigBase {
  type: "zmux";
  binary?: string;
  state_dir?: string;
  socket_path?: string;
  transport?: "local" | "ssh" | "tcp-tls";

  ssh_host?: string;
  ssh_user?: string;
  ssh_port?: number;
  ssh_command?: string;
  ssh_bootstrap_timeout_ms?: number;

  tcp_host?: string;
  tcp_port?: number;
  tls_server_name?: string;
  tls_ca_cert?: string;
  tls_client_cert?: string;
  tls_client_key?: string;
  tls_transport_version?: number;
}

export type BackendConfig = TmuxBackendConfig | ZmuxBackendConfig;

export interface AgentsConfig {
  /** Map of tier names to actual model strings. e.g. { "lite": "openai-codex/gpt-5.4-mini" } */
  models: Record<string, string>;
  /** Default agent name when PI_AGENT is not set. */
  defaultAgent: string;
  /** Extra directories to scan for agent .md files (relative to cwd or absolute). */
  agentPaths: string[];
  /** Backend config for spawn_agent and Bosun backend routing. */
  backend: BackendConfig;
}

const DEFAULT_MODEL_TIERS: Record<string, string> = {
  lite: "openai-codex/gpt-5.4-mini",
  medium: "openai-codex/gpt-5.3-codex",
  high: "openai-codex/gpt-5.4",
  oracle: "openai-codex/gpt-5.4",
};

const DEFAULT_BACKEND: TmuxBackendConfig = {
  type: "tmux",
};

const DEFAULTS: AgentsConfig = {
  models: DEFAULT_MODEL_TIERS,
  defaultAgent: "bosun",
  agentPaths: [],
  backend: DEFAULT_BACKEND,
};

export class AgentsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentsConfigError";
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseTransport(value: unknown): ZmuxBackendConfig["transport"] | undefined {
  if (value === "local" || value === "ssh" || value === "tcp-tls") return value;
  if (value === "tcp" || value === "tls") return "tcp-tls";
  return undefined;
}

function parseBackend(rawBackend: unknown): BackendConfig {
  if (rawBackend === undefined || rawBackend === null) {
    return { ...DEFAULT_BACKEND };
  }

  if (typeof rawBackend !== "object") {
    throw new AgentsConfigError("Invalid .pi/agents.json: backend must be an object when provided.");
  }

  const backend = rawBackend as Record<string, unknown>;
  const commandPrefix = asString(backend.command_prefix);

  if (backend.type === undefined) {
    return {
      type: "tmux",
      command_prefix: commandPrefix,
    };
  }

  if (backend.type !== "tmux" && backend.type !== "zmux") {
    throw new AgentsConfigError(
      `Invalid backend.type '${String(backend.type)}'. Expected one of: tmux, zmux.`,
    );
  }

  if (backend.type === "tmux") {
    return {
      type: "tmux",
      command_prefix: commandPrefix,
    };
  }

  return {
    type: "zmux",
    command_prefix: commandPrefix,
    binary: asString(backend.binary),
    state_dir: asString(backend.state_dir),
    socket_path: asString(backend.socket_path),
    transport: parseTransport(backend.transport),

    ssh_host: asString(backend.ssh_host),
    ssh_user: asString(backend.ssh_user),
    ssh_port: asNumber(backend.ssh_port),
    ssh_command: asString(backend.ssh_command),
    ssh_bootstrap_timeout_ms: asNumber(backend.ssh_bootstrap_timeout_ms),

    tcp_host: asString(backend.tcp_host),
    tcp_port: asNumber(backend.tcp_port),
    tls_server_name: asString(backend.tls_server_name),
    tls_ca_cert: asString(backend.tls_ca_cert),
    tls_client_cert: asString(backend.tls_client_cert),
    tls_client_key: asString(backend.tls_client_key),
    tls_transport_version: asNumber(backend.tls_transport_version),
  };
}

/**
 * Load agents config from `.pi/agents.json` in the given directory.
 * Returns defaults if the file doesn't exist or is malformed JSON.
 * Throws for explicit invalid backend selections.
 */
export function loadConfig(cwd: string): AgentsConfig {
  const configPath = path.join(cwd, ".pi", "agents.json");

  if (!fs.existsSync(configPath)) {
    return {
      ...DEFAULTS,
      models: { ...DEFAULTS.models },
      backend: { ...DEFAULT_BACKEND },
    };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return {
      ...DEFAULTS,
      models: { ...DEFAULTS.models },
      backend: { ...DEFAULT_BACKEND },
    };
  }

  return {
    models: raw.models && typeof raw.models === "object"
      ? { ...DEFAULTS.models, ...(raw.models as Record<string, string>) }
      : { ...DEFAULTS.models },
    defaultAgent: typeof raw.defaultAgent === "string" ? raw.defaultAgent : DEFAULTS.defaultAgent,
    agentPaths: Array.isArray(raw.agentPaths)
      ? raw.agentPaths.filter((value): value is string => typeof value === "string")
      : [...DEFAULTS.agentPaths],
    backend: parseBackend(raw.backend),
  };
}
