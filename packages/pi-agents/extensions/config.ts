/**
 * pi-agents configuration loading.
 *
 * Reads `.pi/agents.json` for model tier mappings, agent paths,
 * and spawn backend config. Works with sensible defaults when
 * no config file exists.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface BackendConfig {
  /** Terminal multiplexer type. Only "tmux" supported today. */
  type: "tmux";
  /** Tmux socket path (for `tmux -S`). Relative to cwd. Omit to auto-detect from $TMUX. */
  socket?: string;
  /** Command prefix that wraps spawned pi processes (e.g., "scripts/sandbox.sh"). */
  command_prefix?: string;
}

export interface AgentsConfig {
  /** Map of tier names to actual model strings. e.g. { "lite": "claude-haiku-4-5-20251001" } */
  models: Record<string, string>;
  /** Default agent name when PI_AGENT is not set. */
  defaultAgent: string;
  /** Extra directories to scan for agent .md files (relative to cwd or absolute). */
  agentPaths: string[];
  /** Backend config for spawn_agent. */
  backend: BackendConfig;
}

const DEFAULTS: AgentsConfig = {
  models: {},
  defaultAgent: "bosun",
  agentPaths: [],
  backend: {
    type: "tmux",
  },
};

/**
 * Load agents config from `.pi/agents.json` in the given directory.
 * Returns sensible defaults if the file doesn't exist or is invalid.
 */
export function loadConfig(cwd: string): AgentsConfig {
  const configPath = path.join(cwd, ".pi", "agents.json");

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULTS, backend: { ...DEFAULTS.backend } };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      models: raw.models && typeof raw.models === "object" ? raw.models : DEFAULTS.models,
      defaultAgent: typeof raw.defaultAgent === "string" ? raw.defaultAgent : DEFAULTS.defaultAgent,
      agentPaths: Array.isArray(raw.agentPaths) ? raw.agentPaths : DEFAULTS.agentPaths,
      backend: {
        type: raw.backend?.type === "tmux" ? "tmux" : DEFAULTS.backend.type,
        socket: typeof raw.backend?.socket === "string" ? raw.backend.socket : undefined,
        command_prefix: typeof raw.backend?.command_prefix === "string" ? raw.backend.command_prefix : undefined,
      },
    };
  } catch {
    return { ...DEFAULTS, backend: { ...DEFAULTS.backend } };
  }
}
